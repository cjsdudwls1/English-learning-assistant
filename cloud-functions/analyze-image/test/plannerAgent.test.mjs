/**
 * 플래너 에이전트의 **출력 정규화** 계약.
 *
 * 도구 쪽(plannerTools.test.mjs)이 "돈을 얼마나 쓰는가"를 고정한다면, 여기서 고정하는 건
 * **이미 쓴 돈이 사용자에게 도달하는가**다. 이 경계에서 나던 사고는 둘 다 조용했다:
 *   - 계획이 비었다고 던져 버리면, 그 런이 만들어 둔 문제는 DB에만 남고 화면엔 실패만 뜬다.
 *   - 모델이 준 day 번호·문제 id를 그대로 믿으면, "1일차"가 셋인 계획이나 열리지 않는
 *     문제 목록이 그대로 렌더된다. 어느 쪽도 예외를 던지지 않는다.
 *
 * 모델·DB는 목이라 네트워크 없이 `node --test`로 돈다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { runPlannerAgent, PLANNER_DEFAULT_DAYS } from '../shared/agent/agents/planner.js';

const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

/** 호출 순서대로 응답을 소비하고, 모자라면 마지막 것을 계속 준다. */
function mockAi(responses) {
  const calls = [];
  return {
    calls,
    models: {
      generateContent: async (req) => {
        calls.push(req);
        const r = responses[Math.min(calls.length - 1, responses.length - 1)];
        return { text: typeof r === 'string' ? r : JSON.stringify(r) };
      },
    },
  };
}

/** agent_runs/agent_steps 기록만 받아 적는 service-role 스텁. */
function mockTrace() {
  return {
    from: () => ({
      insert: async () => ({ error: null }),
      update: () => ({ eq: async () => ({ error: null }) }),
    }),
  };
}

/** 도구를 하나도 안 부르고 곧장 final을 내는 런. 조회 클라이언트는 손대지 않는다. */
async function runWithFinal(finalPayload, input = {}) {
  return runPlannerAgent({
    ai: mockAi([JSON.stringify({ thought: 't', final: finalPayload })]),
    supabase: mockTrace(),
    userClient: {},
    runId: '00000000-0000-4000-8000-0000000000ff',
    userId: 'u1',
    input: { language: 'ko', ...input },
  });
}

const day = (over = {}) => ({ day: 1, focus: 'f', nodePath: '문법 > 시제', activity: 'a', problemIds: [], ...over });

// ── 이미 쓴 돈을 버리지 않는다 ──────────────────────────────────────────

test('계획이 비어도 요약이 있으면 런을 실패로 만들지 않는다', async () => {
  // 던지면 이 런의 요약도, 만들어 둔 문제도 사용자에겐 통째로 사라진다.
  const outcome = await runWithFinal({ summary: '시제가 약합니다.', weeklyPlan: [] });

  assert.equal(outcome.result.summary, '시제가 약합니다.');
  assert.deepEqual(outcome.result.weeklyPlan, []);
  assert.deepEqual(outcome.result.problemIds, []);
});

test('아무것도 못 건진 런만 실패로 확정한다', async () => {
  // 계획도 요약도 만든 문제도 없다 = 진짜 아무것도 없다. 이때만 던진다.
  await assert.rejects(runWithFinal({ weeklyPlan: [] }), /빈 학습 계획/);
});

// ── 모델이 준 형태를 그대로 믿지 않는다 ─────────────────────────────────

test('day 번호는 모델이 아니라 배열 순서가 정한다', async () => {
  // 실제로 모델이 내는 실수: 전부 day:1로 주거나, 기간(7일) 밖 번호를 준다.
  // 화면은 그걸 그대로 "1일차가 셋인 계획"으로 그린다.
  const outcome = await runWithFinal({
    summary: 's',
    weeklyPlan: [day({ day: 3 }), day({ day: 3 }), day({ day: 99 })],
  });

  assert.deepEqual(outcome.result.weeklyPlan.map((d) => d.day), [1, 2, 3]);
});

test('지어낸 문제 id는 서버 밖으로 나가지 않는다', async () => {
  // id는 uuid 컬럼이다. 비-uuid가 프론트까지 가면 조회가 22P02(400)로 죽어
  // "계획은 있는데 문제는 안 열리는" 상태가 된다.
  const outcome = await runWithFinal({
    summary: 's',
    weeklyPlan: [day({ problemIds: [uuid(1), '지어낸-id', 'problem-2'] })],
    problemIds: ['모델이-따로-적은-값'],
  });

  assert.deepEqual(outcome.result.weeklyPlan[0].problemIds, [uuid(1)]);
  // 최종 목록은 모델이 따로 적어 낸 problemIds가 아니라 weeklyPlan에서 다시 모은다.
  assert.deepEqual(outcome.result.problemIds, [uuid(1)]);
});

test('계획 길이는 요청한 기간을 넘지 못한다', async () => {
  const outcome = await runWithFinal({
    summary: 's',
    weeklyPlan: Array.from({ length: 20 }, () => day()),
  });

  assert.equal(outcome.result.weeklyPlan.length, PLANNER_DEFAULT_DAYS);
});

test('generatedCount는 실제로 만들어진 문항 수다', async () => {
  // 생성이 없었으면 0이어야 한다. budget.generated는 실패한 호출의 예약분을 안고 있어
  // 사용자에게 보여줄 숫자로 쓰면 부풀려진다.
  const outcome = await runWithFinal({ summary: 's', weeklyPlan: [day()] });

  assert.equal(outcome.result.generatedCount, 0);
  assert.deepEqual(outcome.result.createdProblemIds, []);
});
