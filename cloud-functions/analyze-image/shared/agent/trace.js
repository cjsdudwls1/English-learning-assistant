/**
 * agent_runs / agent_steps 기록
 *
 * 두 가지 역할이 겹쳐 있다:
 *   - 감사 로그(무슨 도구를 왜 썼나, 토큰 얼마 썼나)
 *   - **실시간 진행 채널** — 프론트가 agent_steps INSERT를 Realtime으로 구독한다.
 *     즉 appendStep은 "로그 쓰기"가 아니라 "UI 갱신"이다. 스텝 하나 끝날 때마다 즉시 써야 한다.
 *
 * 실패 정책: createRun만 throw한다(runId 없이는 프론트가 구독할 대상이 없으므로 요청 자체가 실패).
 * appendStep/finishRun은 절대 throw하지 않는다 — 기록이 실패했다고 이미 정상인 추론을 죽일 이유가 없다.
 *
 * 쓰기는 service-role 클라이언트로만 한다. agent_runs/agent_steps에는 INSERT 정책이 없어서
 * 사용자 토큰으로는 애초에 쓸 수 없다(위조 경로 차단).
 */

// jsonb 한 칸이 무한정 커지면 Realtime 페이로드와 DB가 같이 상한다.
// 관측은 모델에 되먹인 뒤라 여기선 "사람이 보는 요약"이면 충분하다.
const MAX_JSON_CHARS = 4000;
const MAX_THOUGHT_CHARS = 1500;

/** 감사 기록(input/args/observation) 전용. 넘치면 **모양째** 요약으로 바꾼다. */
function truncateJson(value) {
  if (value === undefined || value === null) return null;
  try {
    const text = JSON.stringify(value);
    if (text.length <= MAX_JSON_CHARS) return value;
    return { _truncated: true, _originalChars: text.length, preview: text.slice(0, MAX_JSON_CHARS) };
  } catch {
    return { _unserializable: true, preview: String(value).slice(0, 500) };
  }
}

/* result는 감사 기록이 아니라 **제품 그 자체**다. 그래서 자를 자가 다르다.
 *
 * index.js는 result를 HTTP 응답에 싣지 않고(:381) 프론트는 agent_runs.result 행에서
 * 읽는다(useAgentRun.applyRun — Realtime UPDATE든 폴링이든 결국 같은 행이다).
 * 그러니 여기서 truncateJson을 쓰면 보고서가 상한을 넘긴 런에서만 result가
 * {_truncated, preview} 로 **바뀌어** report 키가 통째로 사라지고, 사용자는
 * "생성된 보고서가 없습니다"를 본다 — 서버 로그는 stopReason=final로 초록인 채.
 * 2026-08-28 프로덕션 사고가 정확히 이것이었다(보고서 약 6천자 > 상한 4천자).
 * 크기 의존이라 짧은 런에서는 멀쩡해 재현이 들쭉날쭉했다.
 *
 * 상한 자체는 남긴다 — Realtime record 상한(1MB)을 넘기면 페이로드가 통째로 버려진다.
 * 다만 모델 출력은 maxOutputTokens=16384로 이미 묶여 있어(한글 기준 약 2만자)
 * 아래 값에는 한참 못 미친다. 즉 이 상한은 평상시엔 안 걸리는 안전판이고,
 * 걸리더라도 **문자열만 제자리에서** 줄여 최상위 키는 반드시 살린다.
 */
const MAX_RESULT_CHARS = 200_000;
const FIELD_CLIP_STEPS = [20_000, 4_000, 1_000, 200];

/** 객체 모양은 그대로 두고 문자열 값만 limit까지 줄인다. */
function clipStrings(value, limit) {
  if (typeof value === 'string') {
    return value.length <= limit ? value : `${value.slice(0, limit)}…[${value.length}자 중 ${limit}자]`;
  }
  if (Array.isArray(value)) return value.map((v) => clipStrings(v, limit));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, clipStrings(v, limit)]));
  }
  return value;
}

function capResult(value) {
  if (value === undefined || value === null) return null;

  let text;
  try {
    text = JSON.stringify(value);
  } catch {
    return { _unserializable: true, preview: String(value).slice(0, 500) };
  }
  if (text === undefined) return null;              // 함수·undefined 등 직렬화 대상이 아닌 값
  if (text.length <= MAX_RESULT_CHARS) return value;

  console.warn('[agent:trace] result가 상한을 넘어 문자열을 줄인다:', { chars: text.length });

  let clipped = value;
  for (const limit of FIELD_CLIP_STEPS) {
    clipped = clipStrings(value, limit);
    if (JSON.stringify(clipped).length <= MAX_RESULT_CHARS) break;
  }
  // 잘렸다는 사실은 숨기지 않는다. 단 최상위가 객체일 때만 표식을 붙일 수 있다.
  const isPlainObject = clipped && typeof clipped === 'object' && !Array.isArray(clipped);
  return isPlainObject ? { ...clipped, _truncated: true, _originalChars: text.length } : clipped;
}

/**
 * 실행 레코드를 만든다.
 *
 * id는 **프론트가 만들어 보낸다**. 루프가 응답을 끝까지 붙잡고 있어도(=fire-and-forget이 아니어도)
 * 프론트가 POST 전에 그 id로 agent_steps를 미리 구독할 수 있어야 하기 때문이다.
 * 서버가 id를 정하면 구독은 응답이 끝난 뒤에나 가능해져 트레이스가 통째로 사라진다.
 *
 * 같은 id로 두 번 오면(중복 POST·재시도) unique 위반이라 여기서 걸린다 — 그대로 멱등성 가드다.
 */
export async function createRun(supabase, { id, userId, agentType, input }) {
  const row = { user_id: userId, agent_type: agentType, status: 'running', input: truncateJson(input) };
  if (id) row.id = id;

  const { data, error } = await supabase.from('agent_runs').insert(row).select('id').single();

  if (error) {
    const e = new Error(`agent_runs 생성 실패: ${String(error.message ?? error).slice(0, 200)}`);
    e.duplicate = error.code === '23505';
    throw e;
  }
  return data.id;
}

export async function appendStep(supabase, runId, { seq, thought, tool, args, observation, ok = true }) {
  try {
    const { error } = await supabase.from('agent_steps').insert({
      run_id: runId,
      seq,
      thought: thought ? String(thought).slice(0, MAX_THOUGHT_CHARS) : null,
      tool: tool ?? null,
      args: truncateJson(args),
      observation: truncateJson(observation),
      ok,
    });
    if (error) console.error('[agent:trace] 스텝 기록 실패(무시):', { runId, seq, error: String(error.message ?? error).slice(0, 200) });
  } catch (e) {
    console.error('[agent:trace] 스텝 기록 예외(무시):', { runId, seq, message: e?.message });
  }
}

export async function finishRun(supabase, runId, { status, stopReason, result, error, totalTokens, modelCalls }) {
  try {
    const { error: dbError } = await supabase
      .from('agent_runs')
      .update({
        status,
        stop_reason: stopReason ?? null,
        result: capResult(result),          // truncateJson 금지 — 위 주석 참고
        error: error ? String(error).slice(0, 1000) : null,
        total_tokens: totalTokens ?? 0,
        model_calls: modelCalls ?? 0,
        completed_at: new Date().toISOString(),
      })
      .eq('id', runId);
    if (dbError) console.error('[agent:trace] 런 종료 기록 실패(무시):', { runId, error: String(dbError.message ?? dbError).slice(0, 200) });
  } catch (e) {
    console.error('[agent:trace] 런 종료 기록 예외(무시):', { runId, message: e?.message });
  }
}
