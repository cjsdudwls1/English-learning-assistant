/**
 * 맞춤 학습플랜 에이전트 도구
 *
 * 컨설턴트와 다른 점은 하나뿐이지만 그 하나가 크다: **여기엔 돈을 쓰는 도구가 있다.**
 * problems.generate는 모델을 호출하고 generated_problems에 행을 남긴다. 그래서 이 파일의
 * 설계는 전부 "모델이 잘못 판단해도 손해가 유한한가"를 기준으로 정해져 있다.
 *
 * ── 지켜야 하는 계약 ──────────────────────────────────────────────
 * 1) **조회는 ctx.db(호출자 JWT), 생성은 ctx.generateProblems(주입된 클로저)만.**
 *    이 파일은 service-role 클라이언트를 아예 보지 않는다. userId·language는 클로저가
 *    JWT에서 온 값으로 고정하며, 모델이 준 args로는 절대 바뀌지 않는다.
 * 2) **예산은 프롬프트가 아니라 카운터가 지킨다.** 런타임의 중복 차단은 (도구, args)가
 *    완전히 같을 때만 걸린다 — count만 1씩 바꿔 부르면 그대로 통과한다. 그래서 상한을
 *    ctx.budget의 숫자로 두고, 초과분은 잘라서 관측으로 알려준다(에러로 런을 죽이지 않는다).
 * 3) **없는 분류로는 생성하지 않는다.** 조회 도구는 0건이면 그만이지만, 생성 도구는 지어낸
 *    분류를 그대로 DB에 박아 넣는다 — 그 문제 묶음은 어느 화면에서도 다시 안 잡힌다.
 */

import { defineTool } from '../registry.js';
import { PROBLEM_TYPES } from '../../problemPrompts.js';
import {
  aliasMap, isKnownNode, isUnclassifiedPath, labelVariants, matchesPath, memo,
  pathToClassification, rows, splitPath,
} from './taxonomy.js';

/** 런 하나가 만들 수 있는 문제 수·생성 호출 수 상한. 계획서의 "생성 문제 수 상한 30" 그대로. */
export const PLANNER_MAX_PROBLEMS = 30;
export const PLANNER_MAX_GENERATE_CALLS = 3;
/** 한 번의 생성 호출로 만들 수 있는 문제 수. generate-all의 항목당 상한(50)보다 훨씬 보수적이다. */
export const PLANNER_MAX_PER_CALL = 10;

const STEM_CLIP = 120;
const COVERAGE_MAX_IDS = 60;
/** 조회 풀. 별칭 접기와 풀이 이력 제외를 JS에서 하므로 넉넉히 받아 두고 자른다. */
const POOL_MULTIPLIER = 5;
const POOL_CAP = 200;

const clip = (s, n = STEM_CLIP) => {
  const t = String(s ?? '').trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
};

/**
 * 이 사용자가 이미 푼 생성 문제 id 집합.
 *
 * 프론트(fetchExistingProblems)는 problem_solving_sessions만 본다. 여기서는 과제 응답까지
 * 함께 뺀다 — 플래너의 결과물은 "앞으로 풀 것"이고, 과제로 이미 답을 낸 문제를 다시 배치하면
 * 계획 자체가 틀린다. 화면에 보이는 통계를 바꾸는 변경이 아니라 선택 대상만 좁히는 것이라
 * 프론트와 숫자가 갈리는 종류의 차이는 생기지 않는다.
 */
async function solvedIds(ctx) {
  return memo(ctx, 'solvedProblemIds', async () => {
    const [solving, assigned] = await Promise.all([
      rows(ctx.db.from('problem_solving_sessions').select('problem_id').eq('user_id', ctx.userId)),
      rows(ctx.db.from('assignment_responses').select('problem_id').eq('student_id', ctx.userId)),
    ]);
    const set = new Set();
    for (const r of [...solving, ...assigned]) if (r.problem_id) set.add(r.problem_id);
    return set;
  });
}

/** nodePath 하위의 미풀이 생성문제를 최신순으로. 별칭 접기는 JS에서 한다(주석: labelVariants). */
async function findByPath(ctx, { segments, problemType, limit }) {
  const [alias, variants] = await Promise.all([aliasMap(ctx), labelVariants(ctx, segments)]);

  let query = ctx.db
    .from('generated_problems')
    .select('id, stem, problem_type, classification, created_at')
    .eq('problem_type', problemType)
    // 생성 실패 자리표시자. 프론트 조회와 같은 제외 조건이다.
    .neq('stem', '__GENERATION_ERROR__')
    .neq('stem', '__TIMEOUT_ERROR__');

  // depth1만 SQL로 좁힌다. PostgREST 필터는 대소문자·ko/en 접기를 못 하므로 원문 후보를 나열하고,
  // depth2 이하는 별칭표를 태워 JS에서 맞춘다.
  if (variants[0]?.length) query = query.in('classification->>depth1', variants[0]);

  const pool = await rows(
    query.order('created_at', { ascending: false }).limit(Math.min(limit * POOL_MULTIPLIER, POOL_CAP)),
  );

  const solved = await solvedIds(ctx);
  return pool
    .filter((p) => !solved.has(p.id) && matchesPath(alias, p.classification, segments))
    .slice(0, limit);
}

export const findExistingTool = defineTool({
  name: 'problems.findExisting',
  description:
    '해당 분류에서 이 학생이 아직 풀지 않은 **기존** 문제를 찾는다. 생성 전에 반드시 먼저 부를 것 — '
    + '이미 있는 문제를 다시 만드는 것은 비용만 늘고 학습에는 아무 이득이 없다.',
  params: {
    nodePath: { type: 'string', required: true, description: "분류 경로. 예: '문법 > 시제'" },
    problemType: { type: 'string', enum: [...PROBLEM_TYPES], default: 'multiple_choice', description: '문제 유형' },
    limit: { type: 'integer', default: 10, min: 1, max: 20, description: '최대 개수' },
  },
  handler: async ({ nodePath, problemType, limit }, ctx) => {
    const segments = splitPath(nodePath);
    if (segments.length === 0) return { error: 'nodePath가 비어 있습니다' };
    if (isUnclassifiedPath(segments)) {
      return { error: "'미분류'는 분류 라벨이 없는 문항 묶음이라 학습 계획의 단위가 될 수 없습니다. 구체적 분류 경로를 쓰세요." };
    }

    const found = await findByPath(ctx, { segments, problemType, limit });
    return {
      nodePath,
      problemType,
      found: found.length,
      problemIds: found.map((p) => p.id),
      problems: found.map((p) => ({ id: p.id, stem: clip(p.stem) })),
    };
  },
});

export const generateTool = defineTool({
  name: 'problems.generate',
  description:
    '기존 문제가 모자랄 때만 새 문제를 만든다. **모델을 호출하므로 비용이 든다** — 부족한 개수만 요청할 것. '
    + `런 전체 상한은 ${PLANNER_MAX_PROBLEMS}문항·생성 호출 ${PLANNER_MAX_GENERATE_CALLS}회이고, 넘으면 남은 만큼만 만들어진다. `
    + 'nodePath는 실제 분류 체계에 있는 경로여야 한다(없으면 만들지 않고 오류를 돌려준다).',
  readOnly: false,
  params: {
    nodePath: { type: 'string', required: true, description: "분류 경로. 예: '문법 > 시제'" },
    problemType: { type: 'string', enum: [...PROBLEM_TYPES], default: 'multiple_choice', description: '문제 유형' },
    count: { type: 'integer', required: true, min: 1, max: PLANNER_MAX_PER_CALL, description: '만들 문항 수' },
  },
  handler: async ({ nodePath, problemType, count }, ctx) => {
    const segments = splitPath(nodePath);
    if (segments.length === 0) return { error: 'nodePath가 비어 있습니다' };
    if (isUnclassifiedPath(segments)) {
      return { error: "'미분류'로는 문제를 만들 수 없습니다. 실제 분류 경로를 지정하세요." };
    }
    if (!(await isKnownNode(ctx, segments))) {
      return {
        error: `분류 체계에 없는 경로입니다: ${nodePath}. stats.drilldown이 돌려준 경로를 그대로 쓰세요.`,
      };
    }

    const budget = ctx.budget;
    if (budget.calls >= budget.maxCalls) {
      return { error: `생성 호출 상한(${budget.maxCalls}회)에 도달했습니다. 이미 확보한 문제로 계획을 마무리하세요.` };
    }
    const remaining = budget.maxProblems - budget.generated;
    if (remaining <= 0) {
      return { error: `문항 상한(${budget.maxProblems})에 도달했습니다. 이미 확보한 문제로 계획을 마무리하세요.` };
    }
    const requested = Math.min(count, remaining);

    // 호출 카운터는 **await 전에** 올린다. 생성이 도중에 터져도 한 번 쓴 것으로 친다 —
    // 실패를 공짜로 보면 모델이 같은 호출을 예산 없이 반복한다(그 사이 모델 호출은 이미 과금됐다).
    budget.calls += 1;

    const classification = pathToClassification(segments);
    const result = await ctx.generateProblems({ classification, problemType, count: requested });
    const ids = Array.isArray(result?.problemIds) ? result.problemIds : [];
    budget.generated += ids.length;
    for (const id of ids) budget.createdIds.add(id);

    return {
      nodePath,
      problemType,
      requested,
      // 유형별 생성은 부분 실패를 허용한다(generateAllProblemTypes가 Promise.allSettled). 요청 수와
      // 실제 수가 다를 수 있으므로 둘 다 돌려준다 — 모델이 계획에 넣을 수 있는 건 실제 id뿐이다.
      generated: ids.length,
      problemIds: ids,
      remainingProblems: budget.maxProblems - budget.generated,
      remainingCalls: budget.maxCalls - budget.calls,
    };
  },
});

export const coverageCheckTool = defineTool({
  name: 'plan.coverageCheck',
  description:
    '계획에 넣을 문제 id들이 실제로 존재하고, 아직 안 푼 문제이며, 어느 분류에 몇 개씩 걸려 있는지 확인한다. '
    + 'final을 쓰기 전에 한 번 불러 빠진 곳을 확인할 것.',
  params: {
    problemIds: { type: 'string[]', required: true, description: `확인할 문제 id 목록 (최대 ${COVERAGE_MAX_IDS}개)` },
  },
  handler: async ({ problemIds }, ctx) => {
    const ids = [...new Set(problemIds)].slice(0, COVERAGE_MAX_IDS);
    if (ids.length === 0) return { error: 'problemIds가 비어 있습니다' };

    const found = await rows(
      ctx.db.from('generated_problems').select('id, problem_type, classification').in('id', ids),
    );
    const foundIds = new Set(found.map((p) => p.id));
    const solved = await solvedIds(ctx);

    const byNode = new Map();
    const byType = new Map();
    for (const p of found) {
      const c = p.classification || {};
      const key = [c.depth1, c.depth2, c.depth3, c.depth4].filter(Boolean).join(' > ') || '(분류 없음)';
      byNode.set(key, (byNode.get(key) || 0) + 1);
      byType.set(p.problem_type, (byType.get(p.problem_type) || 0) + 1);
    }

    return {
      checked: ids.length,
      ok: found.length,
      // 존재하지 않는 id = 모델이 지어냈거나 다른 도구 결과를 잘못 옮긴 것. 계획에서 빼야 한다.
      missing: ids.filter((id) => !foundIds.has(id)),
      alreadySolved: found.filter((p) => solved.has(p.id)).map((p) => p.id),
      byNode: [...byNode].map(([nodePath, count]) => ({ nodePath, count })),
      byType: [...byType].map(([problemType, count]) => ({ problemType, count })),
    };
  },
});

export const plannerWriteTools = [generateTool];
export const plannerReadTools = [findExistingTool, coverageCheckTool];
