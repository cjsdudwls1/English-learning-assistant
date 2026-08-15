/**
 * Step 1 반복 루프(degeneration) 방어 회귀 테스트.
 *
 * 2026-08-15 프로덕션 사고: 같은 이미지 2장을 46분 간격으로 두 번 올렸는데
 *   11:34 — 7,413자 추출 → 7문항, 45초
 *   12:20 — 197,293자 추출 → 2문항, 6분 12초
 * 입력도 코드도 모델도 같았다. Step 1이 반복 루프에 빠져 26배를 뱉었고, 그 텍스트가
 * Step 2에 통째로 들어가(66,676토큰) 구조화가 문항 2개밖에 건지지 못했다.
 *
 * 당시 코드가 이를 놓친 이유는 폴백 조건이 "빈 응답"뿐이었기 때문이다 — 20만 자
 * 쓰레기는 비어 있지 않으므로 성공으로 통과했다. maxOutputTokens도 없어 폭주에
 * 물리적 상한조차 없었다.
 *
 * AI 호출은 목으로 대체하므로 네트워크 없이 `node --test`로 돈다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { extractAllImages, step1CharLimit } from '../shared/simplePipeline.js';

const IMAGES_2 = [
  { imageBase64: 'AAA', mimeType: 'image/jpeg' },
  { imageBase64: 'BBB', mimeType: 'image/jpeg' },
];

/**
 * generateContent 호출을 기록하는 목.
 * responses는 호출 순서대로 소비되고, 모자라면 마지막 항목이 계속 나온다
 * (= "모든 모델이 같은 증상"인 상황을 표현한다).
 */
function mockAi(responses) {
  const calls = [];
  const ai = {
    models: {
      generateContent: async (req) => {
        calls.push({ model: req.model, config: req.config });
        const r = responses[Math.min(calls.length - 1, responses.length - 1)];
        if (r instanceof Error) throw r;
        return { text: r };
      },
    },
  };
  return { ai, calls };
}

const run = (ai) => extractAllImages({ ai, sessionId: 'test', images: IMAGES_2 });

// ─── step1CharLimit ──────────────────────────────────────────────────────

test('step1CharLimit: 이미지 수에 비례하되 전체 상한에서 멈춘다', () => {
  assert.equal(step1CharLimit(1), 20_000);
  assert.equal(step1CharLimit(2), 40_000);
  // 업로드 상한 10장(index.js MAX_IMAGES)이어도 cap을 넘지 않는다.
  // 비례만 두면 200,000자가 되어 사고 당시의 197,293자가 그대로 통과한다.
  assert.equal(step1CharLimit(10), 80_000);
  assert.equal(step1CharLimit(0), 20_000, '0장이어도 상한이 0이 되면 안 된다');
});

// ─── 정상 동작 보존 ──────────────────────────────────────────────────────

test('정상 길이 출력은 첫 호출에서 그대로 반환된다(행위 보존)', async () => {
  const healthy = '정상 추출 결과 '.repeat(500); // 약 4,000자 — 실측 정상치 범위
  const { ai, calls } = mockAi([healthy]);

  const r = await run(ai);

  assert.equal(r.text, healthy);
  assert.equal(r.usedModel, 'gemini-3.5-flash');
  assert.equal(calls.length, 1, '정상 출력에 재시도가 붙으면 비용이 2배가 된다');
  assert.equal(calls[0].config.temperature, 0, '첫 시도는 종전대로 greedy');
});

test('빈 응답은 종전대로 폴백한다', async () => {
  const { ai, calls } = mockAi(['   ', 'ok']);

  const r = await run(ai);

  assert.equal(r.text, 'ok');
  assert.equal(calls.length, 2);
});

// ─── 폭주 상한 ───────────────────────────────────────────────────────────

test('Step1 호출에 maxOutputTokens 상한이 실린다', async () => {
  const { ai, calls } = mockAi(['ok']);

  await run(ai);

  // 상한이 없으면 모델이 컨텍스트가 허용하는 데까지 뱉는다(사고 당시 197,293자).
  assert.equal(calls[0].config.maxOutputTokens, 16_384, '8,192 × 이미지 2장');
});

// ─── 사고 재현 ───────────────────────────────────────────────────────────

test('실제 사고 재현: 197,293자 출력을 수용하지 않는다', async () => {
  const runaway = 'x'.repeat(197_293); // 2026-08-15 실측값
  const healthy = '정상 추출 결과 '.repeat(500);
  const { ai, calls } = mockAi([runaway, healthy]);

  const r = await run(ai);

  assert.equal(r.text, healthy, '이상 출력을 그대로 반환하면 Step 2가 문항을 놓친다');
  assert.equal(calls.length, 2, '이상 출력은 재시도로 이어져야 한다');
});

test('이상 출력 뒤 재시도는 온도를 올려 같은 궤도를 피한다', async () => {
  const { ai, calls } = mockAi(['x'.repeat(100_000), 'ok']);

  await run(ai);

  assert.equal(calls[0].config.temperature, 0);
  assert.ok(
    calls[1].config.temperature > 0,
    'greedy로 다시 부르면 같은 반복 출력이 그대로 재생된다',
  );
});

test('모든 모델·시도가 이상 출력이면 상한까지 절단해 진행한다', async () => {
  const { ai, calls } = mockAi(['y'.repeat(200_000)]);

  const r = await run(ai);

  // 전량 실패보다는 절단해서라도 문항을 건지는 편이 낫다.
  assert.equal(r.text.length, step1CharLimit(2));
  assert.equal(calls.length, 6, '모델 3개 × 시도 2회를 모두 소진한 뒤에야 절단한다');
});

test('절단할 때는 관측된 이상 출력 중 가장 짧은 것을 쓴다', async () => {
  // 길수록 반복이 심하다 — 짧은 쪽이 실제 지면 내용을 더 온전히 담고 있을 가능성이 높다.
  const { ai } = mockAi(['a'.repeat(200_000), 'b'.repeat(90_000), 'c'.repeat(300_000)]);

  const r = await run(ai);

  assert.equal(r.text[0], 'b');
  assert.equal(r.text.length, step1CharLimit(2));
});

test('상한 경계: 정확히 상한이면 통과, 1자 넘으면 이상으로 본다', async () => {
  const limit = step1CharLimit(2);

  const exact = mockAi(['z'.repeat(limit)]);
  const rExact = await run(exact.ai);
  assert.equal(rExact.text.length, limit);
  assert.equal(exact.calls.length, 1, '상한 이내는 재시도 없이 통과');

  const over = mockAi(['z'.repeat(limit + 1), 'ok']);
  const rOver = await run(over.ai);
  assert.equal(rOver.text, 'ok');
  assert.equal(over.calls.length, 2);
});
