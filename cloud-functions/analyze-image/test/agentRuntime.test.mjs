/**
 * 에이전트 루프 계약 테스트.
 *
 * 여기서 고정하는 건 "잘 도는 경우"가 아니라 **비정상 종료가 사용자에게 어떻게 보이는가**다.
 * 단발 호출과 달리 루프는 실패 모드가 여러 개다(없는 도구, 스텝 소진, 같은 조회 반복,
 * 도구 연속 실패). 넷 다 에러가 아니라 **강제 final**로 끝나야 한다 — 관측을 모아 놓고
 * 사용자에게 아무것도 안 주는 게 최악이기 때문이다.
 *
 * AI·DB는 목이라 네트워크 없이 `node --test`로 돈다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { runAgent, parseEnvelope, STOP_REASONS } from '../shared/agent/runtime.js';
import { defineTool } from '../shared/agent/registry.js';

/** 호출 순서대로 응답을 소비하고, 모자라면 마지막 것을 계속 준다. */
function mockAi(responses) {
  const calls = [];
  return {
    calls,
    models: {
      generateContent: async (req) => {
        calls.push(req);
        const r = responses[Math.min(calls.length - 1, responses.length - 1)];
        if (r instanceof Error) throw r;
        return { text: typeof r === 'string' ? r : JSON.stringify(r) };
      },
    },
  };
}

/** agent_steps insert만 받아 적는 service-role 스텁. */
function mockTraceClient() {
  const rows = [];
  return {
    rows,
    from: () => ({
      insert: async (row) => { rows.push(row); return { error: null }; },
      update: () => ({ eq: async () => ({ error: null }) }),
    }),
  };
}

const action = (tool, args) => ({ thought: 't', action: { tool, args } });
const final = (payload) => ({ thought: 't', final: payload });

function makeTool(name, onCall) {
  return defineTool({
    name,
    description: '테스트용 조회 도구',
    params: { q: { type: 'string', required: false } },
    handler: async (args, ctx) => {
      onCall?.(args, ctx);
      return { echoed: args.q ?? null };
    },
  });
}

const base = (overrides) => ({
  runId: 'run-test',
  agentType: 'test',
  systemPrompt: '너는 테스트 에이전트다.',
  input: { hello: 'world' },
  model: 'gemini-2.5-flash',
  ...overrides,
});

test('화이트리스트 밖 도구를 부르면 에러를 관측으로 되돌리고 런은 계속된다', async () => {
  const supabase = mockTraceClient();
  const ai = mockAi([
    action('stats.nope', {}),       // 없는 도구
    final({ report: 'ok' }),        // 모델이 스스로 고쳐 정상 종료
  ]);

  const outcome = await runAgent(base({
    ai, supabase, tools: [makeTool('stats.drilldown')],
    toolCtx: { db: {}, userId: 'u1' },
  }));

  assert.equal(outcome.stopReason, STOP_REASONS.FINAL);
  assert.deepEqual(outcome.result, { report: 'ok' });

  // 실패 스텝이 기록되고, 후보 목록이 모델에게 되돌아갔어야 한다
  const failed = outcome.steps.find((s) => s.ok === false);
  assert.ok(failed, '실패 스텝이 기록되어야 한다');
  assert.match(failed.observation.error, /stats\.drilldown/);

  // 되먹임 확인: 2번째 모델 호출의 대화에 그 에러가 들어 있어야 한다
  const secondCall = ai.calls[1];
  const transcript = JSON.stringify(secondCall.contents);
  assert.match(transcript, /없는 도구/);
});

test('maxSteps를 다 쓰면 에러가 아니라 강제 final로 끝난다', async () => {
  const supabase = mockTraceClient();
  const ai = mockAi([
    action('stats.drilldown', { q: 'a' }),
    action('stats.drilldown', { q: 'b' }),
    final({ report: '관측만으로 쓴 보고서' }),
  ]);

  const outcome = await runAgent(base({
    ai, supabase, tools: [makeTool('stats.drilldown')],
    toolCtx: { db: {}, userId: 'u1' },
    maxSteps: 2,
  }));

  assert.equal(outcome.stopReason, STOP_REASONS.MAX_STEPS);
  assert.deepEqual(outcome.result, { report: '관측만으로 쓴 보고서' });
  assert.equal(ai.calls.length, 3, '강제 final을 위한 추가 호출 1회');

  // 강제 final 호출에는 중단 안내가 붙어야 한다
  assert.match(JSON.stringify(ai.calls[2].contents), /중단 안내/);
});

test('같은 도구를 같은 인자로 반복하면 실행하지 않고 루프로 종료한다', async () => {
  const supabase = mockTraceClient();
  let handlerCalls = 0;
  const ai = mockAi([
    action('stats.drilldown', { q: 'same' }),
    action('stats.drilldown', { q: 'same' }),
    action('stats.drilldown', { q: 'same' }),
    final({ report: 'r' }),
  ]);

  const outcome = await runAgent(base({
    ai, supabase,
    tools: [makeTool('stats.drilldown', () => { handlerCalls += 1; })],
    toolCtx: { db: {}, userId: 'u1' },
    maxSteps: 6,
  }));

  assert.equal(handlerCalls, 1, '중복 호출은 실행 자체를 하지 않는다');
  assert.equal(outcome.stopReason, STOP_REASONS.LOOP);
  assert.deepEqual(outcome.result, { report: 'r' });
});

test('도구 컨텍스트는 넘겨준 호출자 클라이언트를 그대로 받는다 (service-role 유출 없음)', async () => {
  const supabase = mockTraceClient();          // service-role 자리
  const userClient = { marker: 'caller-jwt' }; // 도구가 봐야 할 클라이언트
  let seenCtx = null;

  const ai = mockAi([
    action('stats.drilldown', { q: 'x' }),
    final({ report: 'r' }),
  ]);

  await runAgent(base({
    ai, supabase,
    tools: [makeTool('stats.drilldown', (_a, ctx) => { seenCtx = ctx; })],
    toolCtx: { db: userClient, userId: 'u1' },
  }));

  assert.equal(seenCtx.db, userClient);
  assert.notEqual(seenCtx.db, supabase, '추적용 service-role 클라이언트가 도구로 새면 안 된다');
});

test('쓰기 도구는 allowWrites 없이 등록되면 즉시 터진다', async () => {
  const writer = defineTool({
    name: 'plan.write', description: '쓰기 도구', readOnly: false, handler: async () => ({}),
  });

  await assert.rejects(
    runAgent(base({ ai: mockAi([final({})]), supabase: mockTraceClient(), tools: [writer] })),
    /allowWrites=false/
  );
});

test('잘못된 인자는 관측으로 되돌아가고 모델이 고쳐 쓸 수 있다', async () => {
  const supabase = mockTraceClient();
  const tool = defineTool({
    name: 'stats.timeseries',
    description: '월별 추세',
    params: { months: { type: 'integer', required: true, min: 2, max: 12 } },
    handler: async (args) => ({ months: args.months }),
  });
  const ai = mockAi([
    action('stats.timeseries', {}),                 // 필수 누락
    action('stats.timeseries', { months: '99' }),   // 문자열 + 범위 초과 → 12로 클램프
    final({ report: 'r' }),
  ]);

  const outcome = await runAgent(base({
    ai, supabase, tools: [tool], toolCtx: { db: {}, userId: 'u1' },
  }));

  const missing = outcome.steps.find((s) => s.ok === false);
  assert.match(missing.observation.error, /필수 파라미터 누락/);

  const executed = outcome.steps.find((s) => s.ok && s.tool === 'stats.timeseries');
  assert.deepEqual(executed.observation, { months: 12 });
  assert.equal(outcome.stopReason, STOP_REASONS.FINAL);
});

test('parseEnvelope는 파싱 실패를 성공으로 둔갑시키지 않는다', () => {
  // aiClient.parseJsonResponse는 실패 시 {pages:[{text}]}로 폴백한다.
  // 에이전트가 그걸 쓰면 "빈 액션"이 성공으로 통과하므로 여기선 반드시 실패여야 한다.
  const long = 'x'.repeat(200);
  const parsed = parseEnvelope(long);
  assert.equal(parsed.ok, false);
  assert.ok(parsed.error);

  // 코드펜스로 감싼 정상 JSON은 통과해야 한다
  const fenced = parseEnvelope('```json\n{"thought":"t","final":{"report":"r"}}\n```');
  assert.equal(fenced.ok, true);
  assert.deepEqual(fenced.final, { report: 'r' });

  // 산문이 앞뒤로 붙은 경우도 구제한다
  const noisy = parseEnvelope('생각해보니 이렇습니다: {"thought":"t","action":{"tool":"a","args":{}}} 끝');
  assert.equal(noisy.ok, true);
  assert.equal(noisy.action.tool, 'a');
});

test('스텝은 발생 즉시 기록된다 (실시간 UI 채널)', async () => {
  const supabase = mockTraceClient();
  const ai = mockAi([action('stats.drilldown', { q: 'x' }), final({ report: 'r' })]);

  await runAgent(base({
    ai, supabase, tools: [makeTool('stats.drilldown')], toolCtx: { db: {}, userId: 'u1' },
  }));

  assert.equal(supabase.rows.length, 2, '도구 스텝 1 + final 스텝 1');
  assert.deepEqual(supabase.rows.map((r) => r.seq), [1, 2]);
  assert.equal(supabase.rows[0].run_id, 'run-test');
  assert.equal(supabase.rows[0].tool, 'stats.drilldown');
});

/**
 * 원본 응답 필드(finishReason)가 필요한 테스트용. mockAi는 {text}만 만들어서 잘림을 못 흉내낸다.
 */
function mockRawAi(responses) {
  const calls = [];
  return {
    calls,
    models: {
      generateContent: async (req) => {
        calls.push(req);
        return responses[Math.min(calls.length - 1, responses.length - 1)];
      },
    },
  };
}

test('출력이 잘리면 "구문 오류"가 아니라 잘림으로 되먹인다', async () => {
  // 실제로 겪은 사고: 보고서가 maxOutputTokens에서 잘려 나갔는데 파서는 문법 문제라고 답했고,
  // 모델은 문법을 고치려 들며 같은 길이를 다시 썼다 — 과금 호출 하나를 통째로 버렸다.
  const supabase = mockTraceClient();
  const ai = mockRawAi([
    { text: '{"thought":"t","final":{"report":"아주 긴 보고서', candidates: [{ finishReason: 'MAX_TOKENS' }] },
    { text: JSON.stringify(final({ report: '짧게 다시 씀' })) },
  ]);

  const outcome = await runAgent(base({
    ai, supabase, tools: [makeTool('stats.drilldown')], toolCtx: { db: {}, userId: 'u1' },
  }));

  assert.equal(outcome.stopReason, STOP_REASONS.FINAL);

  const failed = outcome.steps.find((s) => s.ok === false);
  assert.ok(failed, '잘린 턴이 실패 스텝으로 남아야 한다');
  assert.equal(failed.observation.truncated, true);
  assert.match(failed.observation.error, /잘렸습니다/);
  assert.doesNotMatch(failed.observation.error, /구문 오류/, '문법 탓으로 오진하면 안 된다');

  // 되먹임 확인: 다음 호출 대화에 "더 짧게"가 들어가야 모델이 길이를 줄인다
  assert.match(JSON.stringify(ai.calls[1].contents), /더 짧게/);
});

test('thinking이 예산을 다 먹어 출력이 비어도 런을 죽이지 않는다', async () => {
  // finishReason=MAX_TOKENS인데 텍스트 파트가 통째로 없는 경우. extractTextFromResponse가
  // 던지는 자리라, 그대로 두면 관측을 다 모으고도 모델 호출 실패로 런이 끝난다.
  const supabase = mockTraceClient();
  const ai = mockRawAi([
    { candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [] } }] },
    { text: JSON.stringify(final({ report: '복구됨' })) },
  ]);

  const outcome = await runAgent(base({
    ai, supabase, tools: [makeTool('stats.drilldown')], toolCtx: { db: {}, userId: 'u1' },
  }));

  assert.equal(outcome.stopReason, STOP_REASONS.FINAL);
  assert.deepEqual(outcome.result, { report: '복구됨' });
  assert.match(outcome.steps.find((s) => s.ok === false).observation.error, /잘렸습니다/);
});


// ── 도구별 타임아웃: 기본값(조회 기준)은 생성 도구를 못 담는다 ─────────────

test('도구가 선언한 timeoutMs가 런타임 기본값을 이긴다', async () => {
  // 기본 15초는 조회 기준이다. 그 아래에서 모델을 부르는 도구(problems.generate)는
  // 정상 동작이 90초를 넘기므로, 기본값을 그대로 씌우면 **성공 경로가 100% 타임아웃**한다.
  const slow = defineTool({
    name: 'slow.generate',
    description: '모델을 부르는 느린 도구',
    timeoutMs: 5_000,
    handler: async () => { await new Promise((r) => setTimeout(r, 120)); return { made: 3 }; },
  });

  const outcome = await runAgent(base({
    ai: mockAi([action('slow.generate', {}), final({ report: 'ok' })]),
    supabase: mockTraceClient(),
    tools: [slow],
    toolCtx: { db: {}, userId: 'u1' },
    toolTimeoutMs: 20, // 기본값이 적용되면 반드시 터지는 값
  }));

  assert.equal(outcome.stopReason, STOP_REASONS.FINAL);
  const step = outcome.steps.find((s) => s.tool === 'slow.generate');
  assert.equal(step.ok, true, `선언한 상한이 무시되면 정상 생성이 매번 실패한다: ${JSON.stringify(step.observation)}`);
  assert.deepEqual(step.observation, { made: 3 });
});

test('선언한 timeoutMs도 남은 예산을 넘지 못한다', async () => {
  // 도구 하나가 예산을 통째로 먹으면 강제 final을 부를 여유가 사라진다 — 그러면 사용자는
  // 돈만 쓰고 아무것도 못 받는다. 선언값이 아무리 커도 남은 시간으로 다시 조여야 한다.
  const hog = defineTool({
    name: 'slow.hog',
    description: '예산을 통째로 먹으려는 도구',
    timeoutMs: 60_000,
    handler: async () => { await new Promise((r) => setTimeout(r, 4_000)); return { made: 3 }; },
  });

  const started = Date.now();
  const outcome = await runAgent(base({
    ai: mockAi([action('slow.hog', {}), final({ report: 'ok' })]),
    supabase: mockTraceClient(),
    tools: [hog],
    toolCtx: { db: {}, userId: 'u1' },
    // 예산은 FINAL_RESERVE(45s)를 뺀 나머지가 실제 여유다. 여기선 약 1.2초.
    budgetMs: 45_000 + 1_200,
  }));

  const step = outcome.steps.find((s) => s.tool === 'slow.hog');
  assert.equal(step.ok, false, '남은 예산을 넘긴 도구는 잘려야 한다');
  assert.match(step.observation.error, /타임아웃/);
  assert.ok(Date.now() - started < 3_000, '선언값(60초)이 아니라 남은 예산으로 잘려야 한다');
  // 그래도 런은 답을 낸다 — 잘린 뒤 강제/정상 final로 이어진다.
  assert.deepEqual(outcome.result, { report: 'ok' });
});
