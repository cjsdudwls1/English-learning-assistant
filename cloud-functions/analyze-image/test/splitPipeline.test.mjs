/**
 * 역할분리 3-호출 파이프라인(splitPipeline) 회귀 테스트.
 *
 * 이 파이프라인의 이득은 "호출을 나눈 것" 자체가 아니라 나눠야 넣을 수 있는 **역할 전용 지시**와
 * 호출 간 **독립성**에서 나온다. 둘 다 프롬프트 문자열과 병합 규칙에 들어 있어 모델 호출 없이
 * 검증할 수 있고, 그래서 검증한다 — 2-스텝 전환 때 구 프롬프트의 판독 지시가 통째로 유실된
 * 전례가 있다(복수정답 지시문 누락으로 전 문항 기권, 원문 전사 지시 누락으로 철자 자동교정).
 *
 * 다루는 것:
 *   1. Call 1(구조)   — 손글씨·빨간펜 배제 지시. 이게 빠지면 Call 2·3의 전제가 무너진다.
 *   2. Call 2·3(답)   — 최소 지시. 스키마도 코드도 막지 못하는 오염원만 남았는가.
 *   3. 이미지 해상도  — Call 2만 고해상도인가. 프롬프트가 아니라 전송 페이로드를 본다.
 *   4. 호출 간 독립성 — Call 2·3이 Call 1의 결과를 받지 않는가(문항 목록 포함).
 *   5. mergeCallResults — 번호 정합·환각 방어·구조 누락 구제(순수함수).
 *
 * 프롬프트 본문은 영문이지만 **시험지에서 실제로 매칭할 문자열은 한국어 그대로** 남긴다
 * (복수정답 트리거 "두 개를 고르세요", "1형식".."5형식" 등). 여기를 번역하면 트리거가 죽으므로
 * 아래 검사들도 그 부분만 한글 정규식을 쓴다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { PartMediaResolutionLevel } from '@google/genai';

import {
  buildParsePrompt, buildUserAnswerPrompt, buildCorrectAnswerPrompt, mergeCallResults,
  parseStructure, detectUserAnswers, solveCorrectAnswers, imageParts, CALL_MEDIA_RESOLUTION,
} from '../shared/splitPipeline.js';
import { normalizeItem } from '../shared/simplePipeline.js';

// ─── 1. Call 1(구조): 필기 배제 ─────────────────────────────────────────

test('Call1 프롬프트: 학생 손글씨와 교사 빨간펜을 모두 무시하라고 지시한다', () => {
  const p = buildParsePrompt(1);
  assert.match(p, /handwritten/i);
  assert.match(p, /red[- ]pen/i);
  assert.match(p, /ignore/i);
  // 인쇄 글자 위에 필기가 겹칠 때의 처리가 명시돼야 한다 — 실측 오답이 전부 겹침 영역이었다.
  assert.match(p, /overlap/i);
});

test('Call1 프롬프트: 정답을 판단하지 말라고 지시한다(역할 분리의 전제)', () => {
  const p = buildParsePrompt(1);
  assert.match(p, /\*\*Do not decide\*\* what the correct answer is/);
});

test('Call1 프롬프트: 원문 언어를 그대로 전사하라고 지시한다(번역 금지)', () => {
  // 프롬프트를 영문화하면서 생긴 위험 — 지시가 영어면 모델이 한국어 발문·지문을 영어로
  // 옮겨 출력할 수 있다. 그러면 passage/instruction이 통째로 오염되고 GT와 대조도 불가능해진다.
  // 이 프롬프트가 뽑는 필드 대부분이 한국어 원문이므로 번역 금지는 필수 지시다.
  const p = buildParsePrompt(1);
  assert.match(p, /original language/i);
  assert.match(p, /[Nn]ever translate/);
  assert.match(p, /Korean/);
});

test('Call1 스키마에는 답 필드가 없다 — 구조적으로 답을 낼 수 없다', () => {
  const p = buildParsePrompt(1);
  // 스키마 블록에 user_answer/correct_answer가 등장하면 안 된다.
  assert.ok(!p.includes('"user_answer"'), 'Call1 스키마에 user_answer가 있으면 역할 분리가 무의미하다');
  assert.ok(!p.includes('"correct_answer"'), 'Call1 스키마에 correct_answer가 있으면 역할 분리가 무의미하다');
  // 구조 필드는 있어야 한다.
  for (const f of ['"problem_number"', '"passage"', '"choices"', '"answer_format"']) {
    assert.ok(p.includes(f), `Call1 스키마에 ${f} 누락`);
  }
});

test('Call1 프롬프트: 복수정답 트리거가 한글 수사 형태를 포함한다', () => {
  // 실측 오답 원인 — 트리거 예시에 "두 개를 고르세요"가 없어 multi_select를 놓쳤다.
  // 지시문은 영문이어도 트리거 예시는 한국어여야 한다: 모델이 이미지에서 실제로 매칭할
  // 문자열이 한국어다. 여기를 영어로 번역하면 트리거가 통째로 죽는다.
  const p = buildParsePrompt(1);
  assert.match(p, /두 개를 고르세요/);
  assert.match(p, /모두 고르시오/);
  assert.match(p, /Korean numeral word/);
});

// ─── 2. Call 2·Call 3(답 호출): 최소 지시 ───────────────────────────────

/* 2026-08-24. 이 섹션은 원래 두 프롬프트의 문장을 하나씩 정규식으로 고정하고 있었다
 * (세 레이어 구분·VERBATIM·흐린 연필·열린 호·뒷장 비침·null 도피처 금지·자력 풀이 금지…).
 * 그 문장들을 프롬프트에서 전부 걷어냈으므로 테스트도 함께 지운다 — 지운 이유가 요점이다.
 *
 * 판독 정확도를 지시로 고치려는 시도를 세 번 했고 세 번 다 다른 곳이 망가졌다. 문항 목록을
 * 실어 주자 Call 2가 스스로 풀어 자기 정답을 냈고, 목록을 선택지 개수만 남기자 오독이 전부
 * "5"로 쏠렸고, 목록을 걷어내며 "추측해서 내는 것도 틀린 것"을 넣자 뒤 3문항이 통째로 null이
 * 됐다. 마지막 회차의 보강(열린 호 인정·비침 경고·null 조건 축소)은 테스트 131개를 통과하고도
 * 실측에서 효과가 0이었다 — 문구를 더 정교하게 쓰는 방향으로는 움직이지 않는다는 뜻이다.
 * 문장을 하나씩 정규식으로 붙잡는 테스트는 그 방향을 굳히기만 했다.
 *
 * 그래서 남기는 기준을 뒤집었다. 프롬프트에는 **스키마도 코드도 막지 못하는 오염원**만 남기고
 * 테스트도 그것만 지킨다. 아래가 전부다. 문장을 새로 넣고 싶으면 먼저 답할 것 — 스키마나
 * normalizeItem이 이미 막는가? 막는다면 프롬프트에도 테스트에도 자리가 없다. */

test('Call2 프롬프트: 빨간펜과 인쇄된 정답표를 학생 마크와 구분시킨다', () => {
  // 스키마로 못 막는 오염이다. 교사 채점이나 인쇄된 정답을 그대로 옮겨 적으면 값 자체는
  // 그럴듯해서 사후에 걸러낼 방법이 없고, 채점 결과가 통째로 만점이 된다.
  const p = buildUserAnswerPrompt(1);
  assert.match(p, /[Rr]ed pen/);
  assert.match(p, /answer\s+key/);
  assert.match(p, /neither is the student's answer/);
});

test('Call3 프롬프트: 학생의 연필 마크를 정답 근거로 쓰지 말라고 지시한다', () => {
  // 반대 방향의 같은 오염. Call 3이 학생 마크를 베끼면 is_correct가 언제나 true가 된다.
  const p = buildCorrectAnswerPrompt(1);
  assert.match(p, /may be wrong/);
  assert.match(p, /not evidence/);
});

test('두 답 호출 모두 원문자를 ASCII 숫자로 내라는 지시를 받는다', () => {
  // 한쪽만 ①로 내면 비교 단위가 어긋나 그 문항이 통째로 오답 처리된다. normalizeItem은
  // 원문자를 흡수하지 않는다.
  for (const p of [buildUserAnswerPrompt(1), buildCorrectAnswerPrompt(1)]) {
    assert.match(p, /①/);
    assert.match(p, /plain digit/);
  }
});

test('두 답 호출이 글자 그대로 같은 번호 규칙을 받는다(독립 호출의 조인 키)', () => {
  // 목록을 주지 않으므로 번호는 각 호출이 이미지에서 직접 읽는다. 그러면 표기가 유일한 조인
  // 키인데, 한쪽 규칙만 바뀌면 같은 문항이 두 행으로 갈라진다. 문구 자체보다 **양쪽이 같은지**가
  // 계약이다 — 그래야 문구를 고쳐도 한쪽만 고치는 실수가 잡힌다.
  const rule = (p) => p.split('\n').find((l) => l.startsWith('- problem_number:'));
  const u = rule(buildUserAnswerPrompt(1));
  const c = rule(buildCorrectAnswerPrompt(1));
  assert.ok(u, 'Call2에 problem_number 규칙 줄이 없다');
  assert.equal(u, c, '두 호출의 번호 규칙이 갈라졌다 — 조인 키가 어긋난다');
});

test('두 답 호출 모두 복수답을 담을 배열 필드를 갖는다', () => {
  // 학생이 두 개를 칠했거나 발문이 두 개를 요구하는 경우다. 단일 필드만 있으면 모델이
  // 하나를 버리고, 어느 쪽을 버렸는지 알 길이 없다.
  assert.match(buildUserAnswerPrompt(1), /user_answers/);
  assert.match(buildCorrectAnswerPrompt(1), /correct_answers/);
});

test('답 호출 프롬프트는 짧게 유지된다', () => {
  // 극최소화 직전 Call2는 5446자, Call3은 3931자였고 그 상태에서 정확도가 가장 나빴다.
  // 상한은 품질 지표가 아니라 브레이크다 — 문장을 하나씩 얹어 원래대로 돌아가는 경로를 막는다.
  // 넘겼다면 먼저 물을 것: 이 문장이 없으면 스키마도 코드도 못 막는 오염이 실제로 생기는가?
  for (const [name, p] of [['Call2', buildUserAnswerPrompt(2)], ['Call3', buildCorrectAnswerPrompt(2)]]) {
    assert.ok(p.length < 1500, `${name} 프롬프트가 ${p.length}자다 — 상한 1500자`);
  }
});

test('답 호출 프롬프트의 숫자가 한쪽으로 쏠리지 않는다', () => {
  // 실측 실패 모드다. 프롬프트에 "5 choices"가 7줄 깔리자 오독한 답이 전부 5로 나왔다.
  // 답이 한 자리 숫자라서 프롬프트 안에 반복되는 숫자가 그대로 앵커가 된다.
  for (const [name, p] of [['Call2', buildUserAnswerPrompt(1)], ['Call3', buildCorrectAnswerPrompt(1)]]) {
    for (const d of ['1', '2', '3', '4', '5']) {
      const n = (p.match(new RegExp(d, 'g')) || []).length;
      assert.ok(n <= 3, `${name} 프롬프트에 "${d}"가 ${n}번 나온다 — 답을 그 숫자로 끈다`);
    }
  }
});

// ─── 3. 이미지 해상도(Call 2만 고해상도) ────────────────────────────────

/**
 * 세 호출이 모델에 **실제로 보낸** parts를 가로챈다.
 *
 * 프롬프트 문자열만 보는 위 검사들과 달리 여기는 전송 페이로드를 본다. 판독이 망가진
 * 원인이 지시가 아니라 입력이었던 전례가 있어서다 — 같은 페이지에서 좌측 단은 정확히
 * 읽히고 우측 단만 null이 나왔고, 프롬프트는 문항별로 달라지지 않으니 원인일 수 없었다.
 *
 * `splitPipeline → generateWithRetry → ai.models.generateContent`가 유일한 주입점이라
 * 여기만 잡으면 세 호출을 전부 볼 수 있다.
 */
function spyAi(jsonText) {
  const calls = [];
  const ai = {
    models: {
      async generateContent({ model, contents, config }) {
        calls.push({ model, parts: contents[0].parts, config });
        return { text: jsonText };
      },
    },
  };
  return { ai, calls };
}

const TWO_IMAGES = [
  { imageBase64: 'AAAA', mimeType: 'image/jpeg' },
  { imageBase64: 'BBBB', mimeType: 'image/png' },
];

/** 한 호출이 보낸 이미지 파트만 뽑는다(맨 앞 텍스트 파트 제외). */
async function sentImageParts(call) {
  // pick이 빈 배열을 보면 다음 모델로 폴백한다. items·answers를 다 채워 1회로 끝낸다.
  const { ai, calls } = spyAi('{"items":[{"problem_number":"1"}],"answers":[{"problem_number":"1"}]}');
  await call({ ai, sessionId: 'test', images: TWO_IMAGES });
  assert.equal(calls.length, 1, '폴백 없이 첫 모델에서 끝나야 한다');
  return calls[0].parts.filter((p) => p.inlineData);
}

test('Call2만 이미지 해상도를 올린다 — Call1·Call3는 모델 기본값이다', async () => {
  // 2026-08-24 실측: 이미지 2장이 약 2150토큰(장당 ~1075 ≒ 기본 1120)으로 들어가
  // 1097×1488이 내부 축소됐고, 대비가 낮은 구역의 흐린 연필 호가 먼저 뭉개졌다.
  // 올리는 대가는 이미지 토큰 2배다. 그래서 손글씨를 보는 Call 2에만 준다.
  const structure = await sentImageParts(parseStructure);
  const user = await sentImageParts(detectUserAnswers);
  const correct = await sentImageParts(solveCorrectAnswers);

  for (const p of user) {
    assert.deepEqual(p.mediaResolution, { level: 'MEDIA_RESOLUTION_ULTRA_HIGH' },
      'Call2는 흐린 연필 마크를 봐야 한다 — 기본 예산에서 뭉개진 것이 실측으로 확인됐다');
  }
  for (const p of [...structure, ...correct]) {
    assert.ok(!('mediaResolution' in p),
      'Call1·3은 인쇄체를 읽는다. 토큰만 2배 쓰지 않도록 기본값으로 둔다');
  }
});

test('해상도를 올려도 이미지 데이터와 개수는 그대로다', async () => {
  const parts = await sentImageParts(detectUserAnswers);
  assert.equal(parts.length, TWO_IMAGES.length, '2장을 보냈으면 2파트다 — 크롭도 분할도 없다');
  assert.deepEqual(parts.map((p) => p.inlineData), [
    { data: 'AAAA', mimeType: 'image/jpeg' },
    { data: 'BBBB', mimeType: 'image/png' },
  ], '해상도는 곁가지 필드다. 원본 바이트와 mimeType을 건드리면 안 된다');
});

test('해상도 값이 SDK enum과 글자 그대로 같다', () => {
  // 오타가 나도 API는 400을 주지 않고 조용히 무시할 수 있다. 그러면 이 커밋은 효과 0이면서
  // 테스트는 통과하는 상태가 된다. 리터럴 대신 SDK가 정의한 값을 직접 대조한다.
  assert.equal(
    CALL_MEDIA_RESOLUTION.userAnswer,
    PartMediaResolutionLevel.MEDIA_RESOLUTION_ULTRA_HIGH,
  );
});

test('imageParts: 예산을 안 주면 mediaResolution 키를 만들지 않는다', () => {
  for (const [name, parts] of [
    ['명시적 null', imageParts(TWO_IMAGES, null)],
    ['인자 생략', imageParts(TWO_IMAGES)],
  ]) {
    assert.ok(!('mediaResolution' in parts[0]),
      `${name}: undefined를 남기면 직렬화 결과가 SDK 버전에 따라 갈린다`);
  }
});

// ─── 4. 호출 간 독립성 ──────────────────────────────────────────────────

test('Call2·Call3는 Call1의 결과를 인자로 받지 않는다', () => {
  // 이 파이프라인의 존재 이유 — 세 호출이 각자 이미지만 읽으면 한 호출의 오류가 다른 호출로
  // 번지지 않는다. 문항 목록을 넘기는 순간 그 격리가 깨지고, 실측에서 두 번 다 답이 오염됐다:
  // 선택지 원문을 실었을 때는 Call 2가 마크 대신 스스로 푼 정답을 냈고(학생 ③ / 출력 ⑤,
  // 2회차 재현), 개수만 남겼을 때는("- Q39: 5 choices" × 7줄) 오독한 답이 전부 5로 쏠렸다.
  assert.equal(buildUserAnswerPrompt.length, 1, 'Call2 프롬프트가 문항 목록을 받으면 격리가 깨진다');
  assert.equal(buildCorrectAnswerPrompt.length, 1, 'Call3 프롬프트가 문항 목록을 받으면 격리가 깨진다');
});

test('Call2·Call3 프롬프트에 문항 목록이 없다', () => {
  for (const [name, p] of [['Call2', buildUserAnswerPrompt(1)], ['Call3', buildCorrectAnswerPrompt(1)]]) {
    assert.ok(!/^- Q\d/m.test(p), `${name} 프롬프트에 문항 목록이 남아 있다`);
    assert.ok(!p.includes('[MULTI-SELECT]'), `${name}에 Call1이 붙인 형식 태그가 남아 있다`);
    // "N choices"는 답 형식이 마침 한 자리 숫자라 그 N을 답으로 끄는 앵커가 된다(실측).
    assert.ok(!/\d+ choices/.test(p), `${name}에 선택지 개수가 남아 있다 — 답을 그 숫자로 끈다`);
  }
});

// ─── 5. mergeCallResults(순수함수) ──────────────────────────────────────

test('merge: 세 호출을 problem_number로 합친다', () => {
  const merged = mergeCallResults({
    structureRows: [{ problem_number: '3', instruction: '고르시오', choices: [], answer_format: 'single' }],
    userRows: [{ problem_number: '3', user_answer: '2', user_marked_correctness: 'X' }],
    correctRows: [{ problem_number: '3', correct_answer: '4' }],
  });
  assert.equal(merged.length, 1);
  assert.equal(merged[0].user_answer, '2');
  assert.equal(merged[0].correct_answer, '4');
  assert.equal(merged[0].user_marked_correctness, 'X');
  assert.equal(merged[0].instruction, '고르시오');
});

test('merge: 번호 표기가 달라도("Q3", "3.") 같은 문항으로 묶는다', () => {
  const merged = mergeCallResults({
    structureRows: [{ problem_number: '3', answer_format: 'single' }],
    userRows: [{ problem_number: 'Q3', user_answer: '1' }],
    correctRows: [{ problem_number: '3.', correct_answer: '5' }],
  });
  assert.equal(merged[0].user_answer, '1');
  assert.equal(merged[0].correct_answer, '5');
});

test('merge: 구조에 없는 번호를 한쪽 호출만 내면 버린다(환각 방어)', () => {
  const merged = mergeCallResults({
    structureRows: [{ problem_number: '3', answer_format: 'single' }],
    userRows: [{ problem_number: '3', user_answer: '1' }, { problem_number: '99', user_answer: '2' }],
    correctRows: [{ problem_number: '3', correct_answer: '5' }],
  });
  assert.equal(merged.length, 1, '한 호출만 본 번호는 환각일 수 있다 — 문항이 되지 못한다');
  assert.equal(merged[0].problem_number, '3');
  assert.equal(merged[0].user_answer, '1', '99번의 답이 3번으로 새면 안 된다');
});

test('merge: 구조가 놓친 번호를 Call2·3이 둘 다 냈으면 구제한다', () => {
  // 세 호출이 독립이라 Call 1만 문항을 놓칠 수 있다. 예전에는 구조에 없으면 무조건 버려서,
  // Call 2가 정확히 읽은 학생 답이 구조 누락 하나 때문에 같이 사라졌다. 서로를 모르는 두
  // 호출이 같은 번호에 도달했다면 그 문항은 종이에 있다고 본다.
  const merged = mergeCallResults({
    structureRows: [{ problem_number: '3', answer_format: 'single' }],
    userRows: [{ problem_number: '3', user_answer: '1' }, { problem_number: '4', user_answer: '2' }],
    correctRows: [{ problem_number: '3', correct_answer: '5' }, { problem_number: '4', correct_answer: '3' }],
  });
  assert.equal(merged.length, 2, '두 호출이 함께 본 번호는 구조가 놓쳐도 살린다');
  const q4 = merged.find((m) => m.problem_number === '4');
  assert.equal(q4.user_answer, '2');
  assert.equal(q4.correct_answer, '3');
  assert.equal(q4.instruction, undefined, '구조를 못 읽었으므로 발문은 없다 — 답만 남긴다');
});

test('merge: 구제된 행도 problem_number 표기를 원본대로 쓴다', () => {
  const merged = mergeCallResults({
    structureRows: [],
    userRows: [{ problem_number: 'A-2', user_answer: '1' }],
    correctRows: [{ problem_number: 'A-2', correct_answer: '3' }],
  });
  assert.equal(merged.length, 1);
  assert.equal(merged[0].problem_number, 'A-2');
});

test('merge: 한쪽 호출이 통째로 실패해도 다른 쪽 결과는 살린다', () => {
  const merged = mergeCallResults({
    structureRows: [{ problem_number: '3', instruction: '고르시오', answer_format: 'single' }],
    userRows: [],                                   // Call2 실패
    correctRows: [{ problem_number: '3', correct_answer: '4' }],
  });
  assert.equal(merged[0].user_answer, null);
  assert.equal(merged[0].correct_answer, '4');
  assert.equal(merged[0].instruction, '고르시오', '문항 자체는 저장 가치가 있다');
});

test('merge: 답이 없는 문항은 null이지 빈 문자열이 아니다', () => {
  const merged = mergeCallResults({
    structureRows: [{ problem_number: '7', answer_format: 'single' }],
    userRows: [], correctRows: [],
  });
  assert.equal(merged[0].user_answer, null);
  assert.equal(merged[0].correct_answer, null);
  assert.equal(merged[0].user_answers, null);
  assert.equal(merged[0].correct_answers, null);
});

test('merge 결과가 normalizeItem 계약을 만족한다(복수정답)', () => {
  // 병합 형태가 기존 정규화기를 그대로 통과해야 한다 — DB/프론트 계약은 두 파이프라인 공통이다.
  const merged = mergeCallResults({
    structureRows: [{
      problem_number: '10',
      answer_format: 'multi_select',
      choices: [{ label: '1', text: 'a' }, { label: '2', text: 'b' }, { label: '4', text: 'd' }],
    }],
    userRows: [{ problem_number: '10', user_answer: '1, 2', user_answers: ['1', '2'] }],
    correctRows: [{ problem_number: '10', correct_answer: '1, 2', correct_answers: ['1', '2'] }],
  });
  const item = normalizeItem(merged[0]);
  assert.equal(item.answer_format, 'multi', '별칭 multi_select → 계약값 multi로 정규화');
  // multi_select는 선택지 '번호 집합'이라 sanitizeMcAnswerSet이 숫자로 정규화한다(계약).
  assert.deepEqual(item.user_answers, [1, 2]);
  assert.deepEqual(item.correct_answers, [1, 2]);
  assert.equal(item.user_answer, '1, 2', '스칼라는 하위호환 표시용');
});

test('merge 결과가 normalizeItem 계약을 만족한다(다중빈칸 — 인덱스 보존)', () => {
  const merged = mergeCallResults({
    structureRows: [{ problem_number: '14', answer_format: 'multi_blank', blank_count: 3, choices: [] }],
    userRows: [{ problem_number: '14', user_answers: ['beetween', 'in', 'along'] }],
    correctRows: [{ problem_number: '14', correct_answers: ['between', 'in', 'along'] }],
  });
  const item = normalizeItem(merged[0]);
  assert.equal(item.answer_format, 'multi_blank');
  assert.deepEqual(item.user_answers, ['beetween', 'in', 'along'], '학생 철자는 보존돼야 한다');
  assert.deepEqual(item.correct_answers, ['between', 'in', 'along']);
});
