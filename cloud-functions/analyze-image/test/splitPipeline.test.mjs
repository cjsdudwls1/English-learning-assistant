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
 *   2. Call 2(학생답) — 세 레이어 구분·VERBATIM·흐린 마크·정답표 오염 차단.
 *   3. Call 3(정답)   — 학생 마크 배제. 이게 빠지면 Call 2와 독립이 아니게 된다.
 *   4. 호출 간 독립성 — Call 2 프롬프트에 정답이 새어 들어가지 않는가.
 *   5. mergeCallResults — 번호 정합·환각 방어(순수함수).
 *
 * 프롬프트 본문은 영문이지만 **시험지에서 실제로 매칭할 문자열은 한국어 그대로** 남긴다
 * (복수정답 트리거 "두 개를 고르세요", "1형식".."5형식" 등). 여기를 번역하면 트리거가 죽으므로
 * 아래 검사들도 그 부분만 한글 정규식을 쓴다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildParsePrompt, buildUserAnswerPrompt, buildCorrectAnswerPrompt, mergeCallResults,
} from '../shared/splitPipeline.js';
import { normalizeItem } from '../shared/simplePipeline.js';

const ITEMS = [
  {
    problem_number: '10',
    instruction: '어법상 알맞은 문장 두 개를 고르세요',
    choices: [{ label: '1', text: 'He go' }, { label: '2', text: 'He goes' }],
    answer_format: 'multi_select',
  },
  {
    problem_number: '14',
    instruction: '빈칸에 알맞은 말을 쓰시오',
    choices: [],
    answer_format: 'multi_blank',
    blank_count: 3,
  },
];

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

// ─── 2. Call 2(학생답): 판독 지시 ───────────────────────────────────────

test('Call2 프롬프트: 인쇄체·학생연필·교사빨간펜 세 레이어를 구분시킨다', () => {
  const p = buildUserAnswerPrompt(ITEMS, 1);
  assert.match(p, /Printed type/);
  assert.match(p, /Pencil/);
  assert.match(p, /Red pen/);
  // 빨간펜이 시각적으로 압도적이라는 함정을 명시해야 한다.
  assert.match(p, /not the answer/);
});

test('Call2 프롬프트: 철자를 고치지 말라고 지시한다(VERBATIM)', () => {
  // 실측 오답 — 학생이 쓴 "beetween"을 모델이 "between"으로 교정해 오답이 정답으로 둔갑했다.
  const p = buildUserAnswerPrompt(ITEMS, 1);
  assert.match(p, /never correct spelling or grammar/);
  assert.match(p, /beetween/);
  // 손글씨도 원문 언어 그대로 — 영문 지시가 한국어 서술형 답안을 번역시키면 안 된다.
  assert.match(p, /original language/i);
});

test('Call2 프롬프트: 흐린 연필 자국도 유효한 마크로 취급시킨다', () => {
  const p = buildUserAnswerPrompt(ITEMS, 1);
  assert.match(p, /Faint pencil traces|light circles/);
});

test('Call2 프롬프트: 인쇄된 정답표를 답으로 옮기지 말라고 지시한다', () => {
  const p = buildUserAnswerPrompt(ITEMS, 1);
  assert.match(p, /answer key|explanation/);
  assert.match(p, /do not copy it/);
});

// ─── 3. Call 3(정답): 학생 마크 배제 ────────────────────────────────────

test('Call3 프롬프트: 학생의 연필 마크를 정답 근거로 쓰지 말라고 지시한다', () => {
  const p = buildCorrectAnswerPrompt(ITEMS, 1);
  assert.match(p, /may be wrong/);
  assert.match(p, /not evidence/);
});

test('Call3 프롬프트: 보이지 않는 문항의 정답을 지어내지 말라고 지시한다', () => {
  const p = buildCorrectAnswerPrompt(ITEMS, 1);
  assert.match(p, /Do not invent/);
  assert.match(p, /null/);
});

// ─── 4. 호출 간 독립성 ──────────────────────────────────────────────────

test('Call2 프롬프트에 정답 값이 새어 들어가지 않는다', () => {
  // 이 파이프라인의 존재 이유 — Call 2가 정답을 모르면 "정답을 학생답 칸에 베끼는" 오염이
  // 구조적으로 불가능해진다. 문항 목록에 correct_answer를 실어 보내면 그 이득이 사라진다.
  const withAnswers = ITEMS.map((it) => ({ ...it, correct_answer: '42XYZ', correct_answers: ['42XYZ'] }));
  const p = buildUserAnswerPrompt(withAnswers, 1);
  assert.ok(!p.includes('42XYZ'), 'Call2 프롬프트에 정답이 새면 호출 분리의 이득이 사라진다');
});

test('Call2/Call3 프롬프트에 학생 답이 새어 들어가지 않는다', () => {
  const withUser = ITEMS.map((it) => ({ ...it, user_answer: '99ABC', user_answers: ['99ABC'] }));
  assert.ok(!buildCorrectAnswerPrompt(withUser, 1).includes('99ABC'),
    'Call3가 학생 답을 보면 그것을 정답으로 베낄 수 있다');
});

test('문항 목록은 번호·발문·선택지·형식을 담는다(답을 채울 자리를 알기 위한 최소치)', () => {
  const p = buildUserAnswerPrompt(ITEMS, 1);
  assert.match(p, /Q10/);
  assert.match(p, /Q14/);
  assert.match(p, /\[MULTI-SELECT\]/);
  assert.match(p, /\[MULTI-BLANK 3\]/);
  // 발문은 시험지 원문이라 목록에도 한국어 그대로 실려야 한다(영문화 대상이 아니다).
  assert.match(p, /어법상 알맞은 문장 두 개를 고르세요/);
});

test('두 답 호출 모두 복수정답·다중빈칸 배열 규칙을 받는다', () => {
  const u = buildUserAnswerPrompt(ITEMS, 1);
  const c = buildCorrectAnswerPrompt(ITEMS, 1);
  assert.match(u, /user_answers/);
  assert.match(u, /ascending array of\s+strings/);
  assert.match(c, /correct_answers/);
  assert.match(c, /ascending array of\s+strings/);
  // 원문자→ASCII 변환은 양쪽 다 필요하다(한쪽만 있으면 비교 단위가 어긋난다).
  assert.match(u, /①/);
  assert.match(c, /①/);
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

test('merge: 구조에 없는 번호를 답 호출이 내면 버린다(환각 방어)', () => {
  const merged = mergeCallResults({
    structureRows: [{ problem_number: '3', answer_format: 'single' }],
    userRows: [{ problem_number: '3', user_answer: '1' }, { problem_number: '99', user_answer: '2' }],
    correctRows: [{ problem_number: '99', correct_answer: '3' }],
  });
  assert.equal(merged.length, 1, '구조가 기준이다 — 답 호출이 만든 번호는 문항이 되지 못한다');
  assert.equal(merged[0].problem_number, '3');
  assert.equal(merged[0].correct_answer, null, '99번의 정답이 3번으로 새면 안 된다');
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
