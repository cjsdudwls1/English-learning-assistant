/**
 * 컨설턴트 에이전트의 **스텝 예산 계약**.
 *
 * plannerAgent.test.mjs가 플래너에 대해 고정한 것과 같은 계약이다. 플래너엔 있고 컨설턴트엔
 * 없었던 것이 이 파일이 생긴 이유다 — 그 비대칭 때문에 컨설턴트는 같은 병을 안고도 초록이었다.
 *
 * 고정하는 것은 둘이고, 어긋나도 **증상이 없다**는 점이 계약을 두는 이유다:
 *   1) 상한이 프롬프트가 시키는 조사량을 담는가
 *   2) 그 상한을 모델이 아는가(런타임은 남은 스텝을 관측에 실어주지 않는다)
 *
 * 넘치면 에러가 아니라 강제 final로 **반쪽 보고서가 조용히 나간다**. 실측 런 ca08dbd1이
 * 상한 8에 정확히 닿았고(8/8 소진), 프롬프트 4번이 시키는 stats.timeseries를 못 쓴 채 끝났다.
 *
 * 모델·DB는 목이라 네트워크 없이 `node --test`로 돈다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { runConsultantAgent, CONSULTANT_MAX_STEPS } from '../shared/agent/agents/consultant.js';

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

/* 프롬프트가 시키는 조사를 **끝까지** 셌을 때의 최대 작업량.
 * 상한이 이보다 작으면 런은 매번 max_steps로 끝나고, 마지막 영역은 진단 없이 남는다.
 * 프롬프트를 늘리거나 상한을 내리면 여기서 잡는다. */
test('스텝 상한이 프롬프트가 시키는 최대 작업량을 감당한다', () => {
  const MAX_AREAS = 3;         // 프롬프트 1번: "가장 취약한 카테고리를 1~3개"
  const INSPECT_PER_AREA = 2;  // 2번 stats.drilldown + 3번 samples.wrong
  const ONE_OFF = 2;           // 4번 stats.timeseries + 5번 profile.get
  // **정상 final도 루프 한 칸을 쓴다** — runtime.js는 for 안에서 final을 만나 return한다.
  // (루프를 다 쓴 뒤의 강제 final만 루프 밖의 별도 호출이다.)
  const FINAL = 1;
  const needed = MAX_AREAS * INSPECT_PER_AREA + ONE_OFF + FINAL;

  assert.ok(
    CONSULTANT_MAX_STEPS >= needed,
    `스텝 상한 ${CONSULTANT_MAX_STEPS}이 프롬프트가 시키는 ${needed}스텝을 못 담는다 — `
    + '런이 max_steps로 끊겨 강제 final로 반쪽 보고서가 나간다(에러는 안 난다).',
  );
});

test('프롬프트가 모델에게 스텝 예산을 알려준다', async () => {
  // 런타임은 "남은 스텝"을 관측에 실어 주지 않는다(runtime.js pushObservation).
  // 그래서 상한을 아는 통로는 프롬프트뿐이고, 모르면 모델은 조사할 영역 수를 조절할 수 없다.
  const ai = mockAi([{ thought: 't', final: { report: '# 1. 기본 통계 요약\n내용', weakNodes: [] } }]);
  await runConsultantAgent({
    ai,
    supabase: mockTrace(),
    userClient: {},
    runId: uuid(910),
    userId: uuid(911),
    input: { language: 'ko', stats: {}, byCategory: [] },
  });

  const prompt = JSON.stringify(ai.calls[0]);
  assert.ok(
    prompt.includes(String(CONSULTANT_MAX_STEPS)),
    '시스템 프롬프트에 스텝 상한이 없다 — 모델이 예산을 모른 채 카테고리를 고르게 된다',
  );
});

test('영어 프롬프트에도 같은 예산이 실린다', async () => {
  // 한쪽 언어만 고치는 사고가 실제로 잦다. 두 프롬프트는 같은 계약을 져야 한다.
  const ai = mockAi([{ thought: 't', final: { report: '# 1. Performance Summary\nbody', weakNodes: [] } }]);
  await runConsultantAgent({
    ai,
    supabase: mockTrace(),
    userClient: {},
    runId: uuid(912),
    userId: uuid(913),
    input: { language: 'en', stats: {}, byCategory: [] },
  });

  assert.ok(
    JSON.stringify(ai.calls[0]).includes(String(CONSULTANT_MAX_STEPS)),
    '영어 시스템 프롬프트에 스텝 상한이 없다',
  );
});
