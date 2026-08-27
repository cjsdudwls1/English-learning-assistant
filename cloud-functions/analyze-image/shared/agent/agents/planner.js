/**
 * 맞춤 학습플랜 에이전트
 *
 * 컨설턴트는 읽기만 한다. 플래너는 **행동한다** — 문제가 모자라면 만든다. 그래서 이건
 * "보고서를 쓰는 LLM"이 아니라 진짜 루프다: 약점 확인 → 기존 문제 조회 → 부족분 판단 →
 * 생성 → 자가점검 → 모자라면 다시. 어디서 멈출지는 관측 결과가 정한다.
 *
 * ── 돈이 걸린 결정 세 가지 (건드리기 전에 읽을 것) ────────────────────
 * 1) **생성 상한은 코드가 지킨다.** 프롬프트에도 적지만 프롬프트는 지키라는 부탁일 뿐이다.
 *    ctx.budget의 카운터가 실제 상한이고, 런타임의 (도구,args) 중복 차단은 count를 1씩 바꾸는
 *    호출을 못 막으므로 그것만 믿을 수 없다.
 * 2) **쓰기 클라이언트는 이 파일 밖으로 안 나간다.** 도구는 ctx.generateProblems 클로저만
 *    받고, userId·language는 여기서 JWT 값으로 고정된다. 모델 출력이 그 자리에 들어갈 경로가
 *    구조적으로 없다.
 * 3) **과제 배포는 도구가 아니다.** final의 assignmentDraft는 초안일 뿐이고, 실제
 *    shared_assignments 생성은 사용자가 화면에서 [배포]를 눌러야 일어난다. 에세이 채점의
 *    "AI 판정은 제안일 뿐" 선례를 그대로 따른다.
 *
 * ── 왜 생성만 service-role인가 ─────────────────────────────────────
 * generated_problems는 supabase/migrations/에 없다(리포 밖에서 만들어진 테이블이라 RLS를
 * 소스로 확인할 수 없다). 이미 도는 generate-all 경로도 같은 이유로 service-role로 쓴다.
 * 조회는 전부 호출자 JWT(ctx.db)이므로 "볼 수 있는가"의 판정은 여전히 RLS가 한다.
 */

import { runAgent } from '../runtime.js';
import { drilldownTool, profileTool } from '../tools/consultantTools.js';
import {
  PLANNER_MAX_GENERATE_CALLS, PLANNER_MAX_PROBLEMS,
  plannerReadTools, plannerWriteTools,
} from '../tools/plannerTools.js';
import { generateAllProblemTypes } from '../../generateProblems.js';

export const PLANNER_MODEL = 'gemini-2.5-flash';
// 계획서가 정한 값. 조사(드릴다운·기존문제 조회) → 생성 → 자가점검 → final이 최소 5스텝이고,
// 생성 호출 3회를 다 쓰는 경우까지 여유를 둔 상한이다.
export const PLANNER_MAX_STEPS = 8;
export const PLANNER_DEFAULT_DAYS = 7;

function buildSystemPrompt({ language, days }) {
  const isEnglish = language === 'en';

  if (isEnglish) {
    return `
You build a personalized study plan for one student, and you actually assemble the material for it.
You work in steps: inspect, gather, generate only what is missing, verify, then write the plan in English.

[How to work]
The input already contains the authoritative aggregate numbers and per-category accuracy — do not recompute them.
1. Pick 2-3 weak areas worth practising (low accuracy AND enough items to be meaningful; 0% on 2 items is noise).
   If the input carries weakNodes from a previous diagnosis, start from those.
2. Narrow each one with stats.drilldown until you have a concrete node path.
3. For each node, call problems.findExisting FIRST. Reusing an existing item is always better than making a new one.
4. Only if a node is still short of items, call problems.generate for the missing count.
   Generating costs money: the whole run is capped at ${PLANNER_MAX_PROBLEMS} items and ${PLANNER_MAX_GENERATE_CALLS} generate calls.
   Ask for the shortfall, not a round number.
5. Call profile.get once so the workload and tone fit the student's grade.
6. Before writing the final plan, call plan.coverageCheck with every problem id you intend to use.
   Drop anything it reports as missing or already solved.

[Final output]
{"thought":"...","final":{"summary":"...","weeklyPlan":[{"day":1,"focus":"...","nodePath":"...","problemIds":["..."],"activity":"..."}],"problemIds":["..."],"assignmentDraft":{"title":"...","description":"..."}}}

- summary: 3-5 sentences in Markdown. Why this plan targets these areas, grounded only in the data you actually saw.
- weeklyPlan: exactly ${days} entries, day 1..${days}. Every problemIds entry must be an id a tool returned — never invent one.
  A rest or review day is fine; give it an empty problemIds and say what to review.
- problemIds: the union of every id used in weeklyPlan.
- assignmentDraft: a title and one-line description for the teacher. It is a DRAFT — nothing is published until the user acts.

[Constraints]
- Never state a number no tool returned.
- "Unclassified" is not a study area — it is the bucket of items with no taxonomy label. Never plan against it.
- If there simply are not enough items for a day, say so in the activity rather than padding with invented ids.
`.trim();
  }

  return `
당신은 한 학생을 위한 맞춤 학습 계획을 세우고, 그 계획에 쓸 문제까지 실제로 준비합니다.
단계적으로 일합니다 — 확인하고, 모으고, **모자란 것만** 만들고, 점검한 뒤, 한국어로 계획을 씁니다.

[일하는 방법]
입력에는 이미 기준이 되는 종합 수치와 카테고리별 정답률이 들어 있습니다. 다시 계산하지 마세요.
1. 연습할 가치가 있는 취약 영역을 2~3개 고릅니다(정답률이 낮으면서 **문항 수가 의미 있을 만큼** 있어야 합니다. 2문항 중 0문항은 노이즈입니다).
   입력에 이전 진단의 weakNodes가 있다면 거기서 출발하세요.
2. stats.drilldown으로 각 영역을 구체적인 노드 경로까지 좁힙니다.
3. 각 노드마다 **problems.findExisting을 먼저** 부릅니다. 이미 있는 문제를 쓰는 쪽이 새로 만드는 쪽보다 항상 낫습니다.
4. 그래도 문항이 모자랄 때만 problems.generate로 **부족한 개수만큼만** 요청합니다.
   생성은 비용이 듭니다. 런 전체 상한은 ${PLANNER_MAX_PROBLEMS}문항·생성 호출 ${PLANNER_MAX_GENERATE_CALLS}회입니다. 어림수가 아니라 부족분을 요청하세요.
5. profile.get을 한 번 불러 학년에 맞는 분량과 어투를 맞춥니다.
6. 최종 계획을 쓰기 전에, 쓸 문제 id 전부를 plan.coverageCheck로 확인합니다.
   없는 문제(missing)나 이미 푼 문제(alreadySolved)로 나온 id는 계획에서 뺍니다.

[최종 출력]
{"thought":"...","final":{"summary":"...","weeklyPlan":[{"day":1,"focus":"...","nodePath":"...","problemIds":["..."],"activity":"..."}],"problemIds":["..."],"assignmentDraft":{"title":"...","description":"..."}}}

- summary: 마크다운 3~5문장. 왜 이 영역들을 겨냥했는지를, **실제로 본 데이터에만** 근거해 설명합니다.
- weeklyPlan: 정확히 ${days}개 항목(day 1~${days}). problemIds의 모든 id는 도구가 돌려준 id여야 합니다 — 지어내지 마세요.
  복습·휴식일을 둬도 됩니다. 그럴 땐 problemIds를 비우고 무엇을 복습할지 적으세요.
- problemIds: weeklyPlan에 쓴 모든 id의 합집합.
- assignmentDraft: 교사용 제목과 한 줄 설명. **초안일 뿐**이며, 사용자가 직접 배포를 눌러야 실제로 나갑니다.

[제약]
- 도구가 돌려주지 않은 숫자를 말하지 마세요.
- '미분류'는 학습 영역이 아니라 분류 라벨이 없는 문항 묶음입니다. 계획의 대상으로 삼지 마세요.
- 하루치 문항이 정말 모자라면, 없는 id로 채우지 말고 activity에 그 사실을 적으세요.
`.trim();
}

/**
 * @param {object} opts
 * @param {object} opts.ai         AI 클라이언트(BYOK 또는 시스템 Gemini)
 * @param {object} opts.supabase   service-role — 추적 기록 + **문제 생성 쓰기**(위 주석 참조)
 * @param {object} opts.userClient 호출자 JWT — 모든 조회 도구
 * @param {string} opts.runId
 * @param {string} opts.userId     JWT에서 온 값. 모델 출력이 여기 닿지 않는다
 * @param {object} opts.input      { language, scopeLabel, stats, byCategory, weakNodes?, days? }
 */
export async function runPlannerAgent({ ai, supabase, userClient, runId, userId, input }) {
  const language = input?.language === 'en' ? 'en' : 'ko';
  const days = clampDays(input?.days);

  const budget = {
    maxProblems: PLANNER_MAX_PROBLEMS,
    maxCalls: PLANNER_MAX_GENERATE_CALLS,
    generated: 0,
    calls: 0,
    createdIds: new Set(),
  };

  /**
   * 도구에 넘기는 유일한 쓰기 통로.
   * 부수효과 주의: generateAllProblemTypes는 problem_generation_status를 upsert하므로,
   * 플래너가 도는 동안 프론트의 기존 "문제 생성 중" 표시(useProblemGeneration)가 함께 켜진다.
   * 실제로 생성 중이라 틀린 표시는 아니지만, 그 UI를 건드릴 때 여기가 호출원임을 알아야 한다.
   */
  const generateProblems = async ({ classification, problemType, count }) => generateAllProblemTypes(
    supabase,
    ai,
    {
      userId,
      language,
      classification,
      types: [{ problemType, problemCount: count }],
      ...pickAiOptions(input),
    },
    `agent-plan-${runId}`,
  );

  const outcome = await runAgent({
    ai,
    supabase,
    runId,
    agentType: 'planner',
    tools: [drilldownTool, profileTool, ...plannerReadTools, ...plannerWriteTools],
    systemPrompt: buildSystemPrompt({ language, days }),
    input: { ...input, days },
    model: PLANNER_MODEL,
    maxSteps: PLANNER_MAX_STEPS,
    toolCtx: { db: userClient, userId, input, cache: new Map(), budget, generateProblems },
    // 이 에이전트만 쓰기를 연다. 런타임이 쓰기 도구와 이 플래그의 짝을 시작 시점에 검사한다.
    allowWrites: true,
  });

  const result = outcome.result ?? {};
  const weeklyPlan = normalizePlan(result.weeklyPlan, days);

  if (weeklyPlan.length === 0) {
    const err = new Error(language === 'en' ? 'The agent returned an empty plan.' : '에이전트가 빈 학습 계획을 반환했습니다.');
    err.stopReason = outcome.stopReason;
    err.totalTokens = outcome.totalTokens;
    err.modelCalls = outcome.modelCalls;
    throw err;
  }

  // 계획에 실제로 쓰인 id만 최종 목록으로 삼는다. 모델이 problemIds에 따로 적어 낸 값은
  // weeklyPlan과 어긋날 수 있고, 그 어긋남이 그대로 과제 배포로 이어진다.
  const usedIds = [...new Set(weeklyPlan.flatMap((d) => d.problemIds))];

  return {
    ...outcome,
    result: {
      summary: typeof result.summary === 'string' ? result.summary.trim() : '',
      weeklyPlan,
      problemIds: usedIds,
      generatedCount: budget.generated,
      // 화면에서 "이번에 새로 만든 문제"를 구분해 보여주기 위한 값. 예산 카운터가 원본이다.
      createdProblemIds: [...budget.createdIds],
      assignmentDraft: normalizeDraft(result.assignmentDraft),
    },
  };
}

function clampDays(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return PLANNER_DEFAULT_DAYS;
  return Math.min(Math.max(Math.trunc(n), 1), 14);
}

/** 문제 생성 옵션은 프론트가 보낸 것만 통과시킨다 — 모델이 정할 수 있는 값이 아니다. */
function pickAiOptions(input) {
  const out = {};
  if (typeof input?.difficulty === 'string') out.difficulty = input.difficulty;
  if (typeof input?.difficultyLevel === 'number') out.difficultyLevel = input.difficultyLevel;
  if (typeof input?.vocabLevel === 'string') out.vocabLevel = input.vocabLevel;
  return out;
}

/** 모델 출력의 형태를 프론트가 믿을 수 있는 수준으로 고정한다. */
function normalizePlan(raw, days) {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, days).map((entry, i) => ({
    day: Number.isFinite(Number(entry?.day)) ? Math.trunc(Number(entry.day)) : i + 1,
    focus: String(entry?.focus ?? '').trim(),
    nodePath: String(entry?.nodePath ?? '').trim(),
    activity: String(entry?.activity ?? '').trim(),
    problemIds: Array.isArray(entry?.problemIds)
      ? [...new Set(entry.problemIds.filter((id) => typeof id === 'string' && id))]
      : [],
  }));
}

function normalizeDraft(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const title = String(raw.title ?? '').trim();
  if (!title) return null;
  return { title, description: String(raw.description ?? '').trim() };
}
