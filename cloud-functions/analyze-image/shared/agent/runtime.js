/**
 * 에이전트 루프 (ReAct / JSON 액션 프로토콜)
 *
 * 이 앱의 기존 AI 경로는 전부 단발이다: fetch → LLM 1회 → 렌더.
 * 여기서 바뀌는 건 딱 하나 — **다음에 무엇을 볼지 모델이 정하고, 그 관측이 다음 행동을 바꾼다.**
 *
 *   while (!done) { 모델이 도구 선택 → 실행 → 결과를 대화에 되먹임 }
 *
 * ── 왜 네이티브 function-calling을 안 쓰나 ────────────────────────────
 * BYOK 어댑터(providerClientsNode.js)는 `tools`를 통째로 버린다. 네이티브 tool-calling을
 * 쓰면 사용자 키를 등록한 사람은 첫날부터 깨진다. JSON 액션 프로토콜은 3사 공통으로 도는
 * `responseMimeType:'application/json'` 위에서 동작하고, 기존 재시도·에러 파싱·토큰 로깅을
 * 그대로 재사용한다.
 *
 * ── 왜 parseJsonResponse를 안 쓰나 ──────────────────────────────────
 * aiClient.parseJsonResponse는 파싱 실패 시 `{pages:[{text}]}`로 폴백한다(이미지 추출 경로용).
 * 에이전트가 그걸 삼키면 "빈 액션"이 성공으로 둔갑한다. 여기선 **엄격 파싱 후 실패를 관측으로
 * 되먹여** 모델이 스스로 고치게 한다.
 *
 * ── 안전장치 ────────────────────────────────────────────────────────
 * maxSteps 초과·예산 초과·연속 도구 실패·동일 호출 반복 — 넷 다 **에러가 아니라 강제 final**로
 * 처리한다. 그때까지 모은 관측만으로 답을 쓰게 하는 편이, 사용자에게 아무것도 안 주는 것보다 낫다.
 */

import { generateWithRetry, extractTextFromResponse } from '../aiClient.js';
import { appendStep } from './trace.js';
import { buildRegistry, findTool, validateArgs, toolCatalogForPrompt, toolNames } from './registry.js';

const DEFAULT_MAX_STEPS = 6;
const DEFAULT_BUDGET_MS = 240_000;      // 워치독 470s 한참 안쪽
const DEFAULT_TOOL_TIMEOUT_MS = 15_000;
const FINAL_RESERVE_MS = 45_000;        // 강제 final 한 번 더 부를 여유
const MAX_CONSECUTIVE_TOOL_ERRORS = 3;
const MAX_REPEATS = 2;
const DEFAULT_MAX_OUTPUT_TOKENS = 8192;
const OBSERVATION_CHAR_LIMIT = 6000;    // 되먹이는 관측 크기 상한(스텝마다 재전송되므로 곧 비용)

export const STOP_REASONS = {
  FINAL: 'final',
  MAX_STEPS: 'max_steps',
  BUDGET: 'budget',
  TOOL_ERRORS: 'tool_errors',
  LOOP: 'loop_detected',
};

const PROTOCOL = `
[출력 형식 — 반드시 지킬 것]
매 턴 JSON 객체 **하나만** 출력한다. 마크다운 코드펜스·설명문·앞뒤 텍스트 금지.

도구를 쓸 때:
{"thought":"왜 이 도구가 필요한지 한 문장","action":{"tool":"도구이름","args":{...}}}

답을 낼 때:
{"thought":"근거 요약 한 문장","final":{...}}

규칙:
- 한 턴에 도구는 하나만 부른다.
- 같은 도구를 같은 인자로 두 번 부르지 않는다. 결과는 이미 위 대화에 있다.
- 도구 결과가 비어 있으면 그것도 정보다. 다른 각도로 한 번 더 보거나 final로 간다.
- 관측으로 뒷받침되지 않는 내용을 final에 쓰지 않는다.
`.trim();

function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
}

/** 모델 출력 → 액션 봉투. 실패는 throw하지 않고 사유 문자열로 돌려준다(관측으로 되먹이기 위해). */
export function parseEnvelope(text) {
  const stripped = String(text ?? '').replace(/```json/gi, '').replace(/```/g, '').trim();
  if (!stripped) return { ok: false, error: '빈 응답입니다. JSON 객체 하나를 출력하세요.' };

  let parsed;
  try {
    parsed = JSON.parse(stripped);
  } catch {
    // 모델이 앞뒤에 산문을 붙인 경우가 흔하다 — 가장 바깥 중괄호 구간만 한 번 더 시도한다.
    const first = stripped.indexOf('{');
    const last = stripped.lastIndexOf('}');
    if (first === -1 || last <= first) {
      return { ok: false, error: 'JSON으로 파싱할 수 없습니다. 코드펜스 없이 JSON 객체만 출력하세요.' };
    }
    try {
      parsed = JSON.parse(stripped.slice(first, last + 1));
    } catch {
      return { ok: false, error: 'JSON 구문 오류입니다. 코드펜스 없이 유효한 JSON 객체 하나만 출력하세요.' };
    }
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, error: 'JSON 객체(중괄호)여야 합니다.' };
  }

  const thought = typeof parsed.thought === 'string' ? parsed.thought : null;

  // final이 있으면 종료가 우선이다 — 모델이 둘 다 담았다면 이미 답을 갖고 있다는 뜻.
  if (parsed.final !== undefined && parsed.final !== null) {
    return { ok: true, thought, final: parsed.final };
  }

  const action = parsed.action;
  if (action && typeof action === 'object' && typeof action.tool === 'string') {
    return { ok: true, thought, action: { tool: action.tool, args: action.args ?? {} } };
  }

  return { ok: false, error: '"action":{"tool":...,"args":{...}} 또는 "final":{...} 중 하나가 있어야 합니다.' };
}

function clip(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  if (!text) return '';
  return text.length > OBSERVATION_CHAR_LIMIT
    ? `${text.slice(0, OBSERVATION_CHAR_LIMIT)}\n…(잘림, 원본 ${text.length}자)`
    : text;
}

async function withTimeout(promise, ms, label) {
  let handle;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        handle = setTimeout(() => reject(new Error(`${label} 타임아웃 (${Math.round(ms / 1000)}초)`)), ms);
      }),
    ]);
  } finally {
    clearTimeout(handle);
  }
}

/**
 * @param {object}   opts
 * @param {object}   opts.ai            Gemini 또는 BYOK 어댑터 (models.generateContent)
 * @param {object}   opts.supabase      **service-role** 클라이언트 — 추적 기록 전용
 * @param {string}   opts.runId
 * @param {string}   opts.agentType
 * @param {Array}    opts.tools         defineTool로 만든 배열
 * @param {string}   opts.systemPrompt
 * @param {object}   opts.input         프론트가 계산해 넘긴 입력(전역 통계 등)
 * @param {string}   opts.model
 * @param {object}   opts.toolCtx       도구 핸들러에 넘길 컨텍스트.
 *                                      **여기의 db는 호출자 JWT 클라이언트여야 한다** — 권한 경계는
 *                                      코드가 아니라 RLS가 판정한다. service-role은 절대 넣지 않는다.
 * @param {boolean}  [opts.allowWrites] 쓰기 도구 허용 여부. 기본 false(선언만으로는 못 쓴다)
 * @returns {Promise<{result, stopReason, steps, totalTokens, modelCalls}>}
 */
export async function runAgent({
  ai, supabase, runId, agentType, tools, systemPrompt, input, model,
  toolCtx = {}, allowWrites = false,
  maxSteps = DEFAULT_MAX_STEPS,
  budgetMs = DEFAULT_BUDGET_MS,
  toolTimeoutMs = DEFAULT_TOOL_TIMEOUT_MS,
  maxOutputTokens = DEFAULT_MAX_OUTPUT_TOKENS,
  responseJsonSchema,
  now = () => Date.now(),
}) {
  const registry = buildRegistry(tools);

  // 쓰기 도구는 선언만으로 켜지지 않는다. allowWrites 없이 섞여 들어오면 배포 사고이므로 즉시 중단.
  if (!allowWrites) {
    const writers = [...registry.values()].filter((t) => !t.readOnly).map((t) => t.name);
    if (writers.length) throw new Error(`allowWrites=false인데 쓰기 도구가 있습니다: ${writers.join(', ')}`);
  }

  const startedAt = now();
  const preamble = [
    systemPrompt.trim(),
    '',
    '[사용 가능한 도구]',
    toolCatalogForPrompt(registry) || '(없음)',
    '',
    PROTOCOL,
    '',
    '[입력]',
    JSON.stringify(input),
  ].join('\n');

  /** @type {{raw: string, observation: string}[]} */
  const history = [];
  const seenSignatures = new Set();
  const steps = [];
  let totalTokens = 0;
  let modelCalls = 0;
  let consecutiveToolErrors = 0;
  let repeats = 0;
  let seq = 0;

  const buildContents = (forcedFinalNote) => {
    const contents = [{ role: 'user', parts: [{ text: preamble }] }];
    for (const turn of history) {
      contents.push({ role: 'model', parts: [{ text: turn.raw }] });
      contents.push({ role: 'user', parts: [{ text: turn.observation }] });
    }
    if (forcedFinalNote) {
      contents.push({ role: 'user', parts: [{ text: forcedFinalNote }] });
    }
    return contents;
  };

  const callModel = async (forcedFinalNote) => {
    const { response, usageMetadata } = await generateWithRetry({
      ai,
      model,
      contents: buildContents(forcedFinalNote),
      sessionId: runId,
      maxRetries: 2,
      baseDelayMs: 1500,
      temperature: 0.2,
      maxOutputTokens,
      responseJsonSchema,
      // 전역 THINKING_BUDGET=0(지연 단축 스위치)이 도구 선택 판단까지 죽이는 걸 막는다.
      // null = thinkingConfig 미전송 = 모델 기본 thinking. 문자열 level은 2.5 세대 검증 이력이
      // 없어 일부러 쓰지 않는다.
      thinkingBudget: null,
    });
    modelCalls += 1;
    totalTokens += Number(usageMetadata?.totalTokenCount ?? 0) || 0;
    return extractTextFromResponse(response, model);
  };

  const recordStep = async (row) => {
    seq += 1;
    const step = { seq, ...row };
    steps.push(step);
    await appendStep(supabase, runId, step);
    return step;
  };

  // 관측을 대화에 되먹인다. ok=false면 모델이 자기수정할 재료가 된다.
  const pushObservation = (raw, payload) => {
    history.push({ raw, observation: `[관측]\n${clip(payload)}` });
  };

  let stopReason = null;

  for (let i = 0; i < maxSteps; i += 1) {
    if (now() - startedAt > budgetMs - FINAL_RESERVE_MS) { stopReason = STOP_REASONS.BUDGET; break; }

    let raw;
    try {
      raw = await callModel();
    } catch (e) {
      // 모델 호출 자체가 죽으면 되먹일 것이 없다. 관측이 하나라도 있으면 강제 final로 살려본다.
      const message = String(e?.message ?? e).slice(0, 300);
      await recordStep({ thought: null, tool: null, args: null, observation: { modelError: message }, ok: false });
      if (history.length === 0) throw e;
      stopReason = STOP_REASONS.TOOL_ERRORS;
      break;
    }

    const envelope = parseEnvelope(raw);

    if (!envelope.ok) {
      consecutiveToolErrors += 1;
      await recordStep({ thought: null, tool: null, args: null, observation: { error: envelope.error }, ok: false });
      pushObservation(raw, { error: envelope.error });
      if (consecutiveToolErrors >= MAX_CONSECUTIVE_TOOL_ERRORS) { stopReason = STOP_REASONS.TOOL_ERRORS; break; }
      continue;
    }

    if (envelope.final !== undefined) {
      await recordStep({ thought: envelope.thought, tool: null, args: null, observation: { final: true }, ok: true });
      return { result: envelope.final, stopReason: STOP_REASONS.FINAL, steps, totalTokens, modelCalls };
    }

    const { tool: toolName, args: rawArgs } = envelope.action;
    const tool = findTool(registry, toolName);

    // ① 화이트리스트 밖 도구 → 에러를 관측으로 되돌려 자기수정 유도(런은 계속된다)
    if (!tool) {
      consecutiveToolErrors += 1;
      const error = `'${toolName}'은(는) 없는 도구입니다. 사용 가능: ${toolNames(registry).join(', ')}`;
      await recordStep({ thought: envelope.thought, tool: toolName, args: rawArgs, observation: { error }, ok: false });
      pushObservation(raw, { error });
      if (consecutiveToolErrors >= MAX_CONSECUTIVE_TOOL_ERRORS) { stopReason = STOP_REASONS.TOOL_ERRORS; break; }
      continue;
    }

    // ② 인자 검증 실패도 마찬가지 — 관측으로 되돌린다
    const validated = validateArgs(tool, rawArgs);
    if (!validated.ok) {
      consecutiveToolErrors += 1;
      await recordStep({ thought: envelope.thought, tool: toolName, args: rawArgs, observation: { error: validated.error }, ok: false });
      pushObservation(raw, { error: validated.error });
      if (consecutiveToolErrors >= MAX_CONSECUTIVE_TOOL_ERRORS) { stopReason = STOP_REASONS.TOOL_ERRORS; break; }
      continue;
    }

    // ③ 동일 (도구, 인자) 반복 → 실행하지 않고 되돌린다. 두 번 반복하면 루프로 보고 종료.
    const signature = `${tool.name}:${stableStringify(validated.args)}`;
    if (seenSignatures.has(signature)) {
      repeats += 1;
      const error = `이미 같은 인자로 ${tool.name}을(를) 호출했습니다. 결과는 위 관측에 있습니다. 다른 도구를 쓰거나 final을 내세요.`;
      await recordStep({ thought: envelope.thought, tool: tool.name, args: validated.args, observation: { error }, ok: false });
      pushObservation(raw, { error });
      if (repeats >= MAX_REPEATS) { stopReason = STOP_REASONS.LOOP; break; }
      continue;
    }
    seenSignatures.add(signature);

    // ④ 실제 실행. 도구 실패는 예외로 터뜨리지 않고 관측으로 내려준다.
    let observation;
    let ok = true;
    try {
      const controller = new AbortController();
      const execution = Promise.resolve().then(() => tool.handler(validated.args, { ...toolCtx, signal: controller.signal }));
      observation = await withTimeout(execution, toolTimeoutMs, `도구 ${tool.name}`);
      // supabase-js는 abortSignal을 옵션으로만 받으므로 타임아웃 후 정리는 best-effort다.
      controller.abort();
      consecutiveToolErrors = 0;
    } catch (e) {
      ok = false;
      consecutiveToolErrors += 1;
      observation = { error: String(e?.message ?? e).slice(0, 300) };
    }

    await recordStep({ thought: envelope.thought, tool: tool.name, args: validated.args, observation, ok });
    pushObservation(raw, observation);

    if (!ok && consecutiveToolErrors >= MAX_CONSECUTIVE_TOOL_ERRORS) { stopReason = STOP_REASONS.TOOL_ERRORS; break; }
  }

  if (!stopReason) stopReason = STOP_REASONS.MAX_STEPS;

  // ── 강제 final ──────────────────────────────────────────────────
  // 여기 도달했다는 건 "정상 종료는 못 했지만 관측은 모였다"는 뜻이다. 에러로 끝내지 않고
  // 지금까지의 근거만으로 답을 쓰게 한다. 왜 멈췄는지는 stop_reason으로 남아 UI/운영이 판단한다.
  const note = [
    '[중단 안내]',
    stopReason === STOP_REASONS.BUDGET ? '시간 예산을 다 썼습니다.'
      : stopReason === STOP_REASONS.LOOP ? '같은 조회를 반복했습니다.'
      : stopReason === STOP_REASONS.TOOL_ERRORS ? '도구 호출이 연속으로 실패했습니다.'
      : '허용된 조회 횟수를 다 썼습니다.',
    '더 이상 도구를 호출할 수 없습니다. 지금까지의 관측만으로 "final"을 지금 출력하세요.',
    '관측이 부족한 항목은 지어내지 말고 생략하세요.',
  ].join(' ');

  try {
    const raw = await callModel(note);
    const envelope = parseEnvelope(raw);
    if (envelope.ok && envelope.final !== undefined) {
      await recordStep({ thought: envelope.thought, tool: null, args: null, observation: { final: true, forced: true, stopReason }, ok: true });
      return { result: envelope.final, stopReason, steps, totalTokens, modelCalls };
    }
    throw new Error(envelope.ok ? '강제 final 요청에 도구 호출로 응답했습니다' : envelope.error);
  } catch (e) {
    const message = String(e?.message ?? e).slice(0, 300);
    await recordStep({ thought: null, tool: null, args: null, observation: { error: `강제 final 실패: ${message}` }, ok: false });
    const err = new Error(`에이전트가 결론을 내지 못했습니다 (${stopReason}): ${message}`);
    err.stopReason = stopReason;
    err.totalTokens = totalTokens;
    err.modelCalls = modelCalls;
    throw err;
  }
}
