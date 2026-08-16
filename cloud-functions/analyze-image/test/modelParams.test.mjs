/**
 * 모델 세대별 생성 파라미터 게이팅 회귀 테스트.
 *
 * 왜 테스트로 고정하는가: 이 게이팅이 깨져도 **아무 증상이 없다**.
 * gemini-3.6-flash에 temperature를 보내면 400이 나는 게 아니라 조용히 무시된다
 * (Vertex 실측 2026-08-16: T=0.0으로 6회 호출해도 출력이 갈렸다. 같은 조건에서
 *  3.5-flash는 6/6 동일). 로그에도 안 남고 응답도 정상이라, 누가 `config.temperature`를
 * 무조건 넣는 코드로 되돌려도 리뷰에서 잡지 않으면 끝까지 모른다.
 * 그때 잃는 건 "온도를 0으로 고정했다"는 사실이 아니라 그 착각 위에 세운 재현성이다.
 *
 * 다루는 것:
 *   1. 신세대(3.6-flash, 3.5-flash-lite)에는 temperature를 보내지 않는다
 *   2. 구세대(3.5-flash 등)에는 종전대로 보낸다
 *   3. thinkingLevel이 주어지면 숫자 thinkingBudget보다 우선한다
 *   4. seed는 세대와 무관하게 전달된다
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { generateWithRetry } from '../shared/aiClient.js';

/** generateContent에 실제로 넘어간 요청을 잡아두는 가짜 클라이언트. */
function fakeAi(captured) {
  return {
    models: {
      generateContent: async (req) => {
        captured.push(req);
        return { text: '{}', usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 } };
      },
    },
  };
}

async function callWith(overrides) {
  const captured = [];
  await generateWithRetry({
    ai: fakeAi(captured),
    contents: [{ role: 'user', parts: [{ text: 'x' }] }],
    sessionId: 'test',
    maxRetries: 1,
    baseDelayMs: 1,
    temperature: 0.0,
    ...overrides,
  });
  assert.equal(captured.length, 1, '정확히 한 번 호출돼야 한다');
  return captured[0].config;
}

// ─── 1. 신세대: temperature 미전송 ──────────────────────────────────────

test('gemini-3.6-flash에는 temperature를 보내지 않는다', async () => {
  const config = await callWith({ model: 'gemini-3.6-flash' });
  assert.equal('temperature' in config, false);
});

test('gemini-3.5-flash-lite에도 temperature를 보내지 않는다', async () => {
  const config = await callWith({ model: 'gemini-3.5-flash-lite' });
  assert.equal('temperature' in config, false);
});

// ─── 2. 구세대: 종전 동작 보존 ──────────────────────────────────────────

test('gemini-3.5-flash에는 temperature를 종전대로 보낸다', async () => {
  const config = await callWith({ model: 'gemini-3.5-flash' });
  assert.equal(config.temperature, 0.0);
});

test('gemini-3.1-flash-lite에도 temperature를 보낸다 (lite라고 뭉뚱그리지 않는다)', async () => {
  const config = await callWith({ model: 'gemini-3.1-flash-lite' });
  assert.equal(config.temperature, 0.0);
});

// ─── 3. thinkingLevel 우선 ──────────────────────────────────────────────

test('thinkingLevel이 주어지면 thinkingConfig는 level 형태로 나간다', async () => {
  const config = await callWith({ model: 'gemini-3.6-flash', thinkingLevel: 'high' });
  assert.deepEqual(config.thinkingConfig, { thinkingLevel: 'high' });
});

test('thinkingLevel은 숫자 thinkingBudget보다 우선한다', async () => {
  const config = await callWith({ model: 'gemini-3.5-flash', thinkingLevel: 'low', thinkingBudget: 0 });
  assert.deepEqual(config.thinkingConfig, { thinkingLevel: 'low' });
});

test('thinkingBudget: null은 thinkingConfig 자체를 생략한다', async () => {
  const config = await callWith({ model: 'gemini-3.5-flash', thinkingBudget: null });
  assert.equal('thinkingConfig' in config, false);
});

test('구세대에 숫자 thinkingBudget을 주면 그대로 나간다', async () => {
  const config = await callWith({ model: 'gemini-3.5-flash', thinkingBudget: 0 });
  assert.deepEqual(config.thinkingConfig, { thinkingBudget: 0 });
});

// ─── 4. seed는 세대 무관 ────────────────────────────────────────────────

test('seed는 신세대·구세대 모두에 전달된다', async () => {
  for (const model of ['gemini-3.6-flash', 'gemini-3.5-flash']) {
    const config = await callWith({ model, seed: 42 });
    assert.equal(config.seed, 42, `${model}에 seed가 전달돼야 한다`);
  }
});

test('seed를 안 주면 config에 넣지 않는다', async () => {
  const config = await callWith({ model: 'gemini-3.6-flash' });
  assert.equal('seed' in config, false);
});
