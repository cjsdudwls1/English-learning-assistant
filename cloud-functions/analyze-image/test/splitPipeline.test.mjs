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
 *   4. 호출 간 독립성 — Call 2·3이 Call 1의 결과를 받지 않는가(문항 목록 포함).
 *   5. mergeCallResults — 번호 정합·환각 방어·구조 누락 구제(순수함수).
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
  const p = buildUserAnswerPrompt(1);
  assert.match(p, /Printed type/);
  assert.match(p, /Pencil/);
  assert.match(p, /Red pen/);
  // 빨간펜이 시각적으로 압도적이라는 함정을 명시해야 한다.
  assert.match(p, /not the answer/);
});

test('Call2 프롬프트: 철자를 고치지 말라고 지시한다(VERBATIM)', () => {
  // 실측 오답 — 학생이 쓴 "beetween"을 모델이 "between"으로 교정해 오답이 정답으로 둔갑했다.
  const p = buildUserAnswerPrompt(1);
  assert.match(p, /never correct spelling or grammar/);
  assert.match(p, /beetween/);
  // 손글씨도 원문 언어 그대로 — 영문 지시가 한국어 서술형 답안을 번역시키면 안 된다.
  assert.match(p, /original language/i);
});

test('Call2 프롬프트: 흐린 연필 자국도 유효한 마크로 취급시킨다', () => {
  const p = buildUserAnswerPrompt(1);
  assert.match(p, /Faint pencil traces|light circles/);
});

/* 아래 세 개는 2026-08-24 실측에서 나온 것이다. 목록(roster)을 걷어낸 직후 돌린 회차에서
 * 7문항 중 뒤 3개(43·44·45)의 user_answer가 전부 null로 나왔다 — 원본에는 학생이 ②①③을
 * 분명히 골라 놓았는데도. 값을 낸 4문항은 전부 정확했으니 오답을 내는 문제가 아니라
 * 답을 포기하는 문제였다. 원본을 열어 보고 두 가지가 겹친 것을 확인했다.
 *   - 마크가 닫힌 동그라미가 아니라 숫자 왼쪽에 걸친 열린 호였다. 프롬프트는 "fully
 *     enclosed가 가장 강한 신호"라고만 말해서, 열린 호는 약한 신호로 읽힐 여지가 있었다.
 *   - null이 난 세 문항이 전부 뒷장 글자가 비쳐 보이는 단에 있었다. 대비가 낮았다.
 * 여기에 "추측해서 내는 것도 틀린 것"이라는 문장이 얹히자 모델이 안전한 쪽(null)으로 갔다.
 * 억제 문구를 완전히 뺄 수는 없다(빈칸을 지어내면 그게 더 나쁘다). 그래서 null의 조건을
 * "아무 자국도 없음"으로 좁히는 쪽으로 고쳤고, 그 경계를 테스트로 잡아 둔다. */

test('Call2 프롬프트: 닫히지 않은 호도 닫힌 동그라미와 동등한 마크로 인정시킨다', () => {
  const p = buildUserAnswerPrompt(1);
  assert.match(p, /does not have to close/, '열린 마크를 인정하는 문장이 없다');
  assert.match(p, /arc/, '호(arc)라는 실제 형태를 짚어주지 않는다');
  assert.ok(
    !/fully enclosed.*strongest/s.test(p),
    '"닫힌 동그라미가 가장 강한 신호"는 열린 호를 약한 신호로 읽히게 한다',
  );
});

test('Call2 프롬프트: null을 판독 실패의 도피처로 쓰지 말라고 못박는다', () => {
  const p = buildUserAnswerPrompt(1);
  assert.match(p, /no hand-drawn stroke at all/, 'null의 조건이 "자국 없음"으로 좁혀져 있지 않다');
  assert.match(p, /not the safe answer/, 'null이 안전한 선택이 아니라는 말이 없다');
  // 이 문구가 억제 방향으로 되돌아가면 43·44·45가 다시 통째로 빈다.
  assert.ok(
    !/reporting a guess are both wrong/.test(p),
    '"추측해서 내는 것도 틀리다"가 되살아났다 — 흐린 마크를 통째로 포기하게 만든 문장이다',
  );
});

test('Call2 프롬프트: 뒷장 비침을 마크와 구분시킨다', () => {
  const p = buildUserAnswerPrompt(1);
  assert.match(p, /ghosting through|from the back of the sheet/i);
  assert.match(p, /needs a closer look, not a null/, '비침 구역에서 포기하지 말라는 지시가 없다');
});

test('Call2 프롬프트: 인쇄된 정답표를 답으로 옮기지 말라고 지시한다', () => {
  const p = buildUserAnswerPrompt(1);
  assert.match(p, /answer key|explanation/);
  assert.match(p, /do not copy it/);
});

// ─── 3. Call 3(정답): 학생 마크 배제 ────────────────────────────────────

test('Call3 프롬프트: 학생의 연필 마크를 정답 근거로 쓰지 말라고 지시한다', () => {
  const p = buildCorrectAnswerPrompt(1);
  assert.match(p, /may be wrong/);
  assert.match(p, /not evidence/);
});

test('Call3 프롬프트: 보이지 않는 문항의 정답을 지어내지 말라고 지시한다', () => {
  const p = buildCorrectAnswerPrompt(1);
  assert.match(p, /Do not invent/);
  assert.match(p, /null/);
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

test('Call2·Call3가 같은 번호 표기 규칙을 받는다(독립 호출의 조인 키)', () => {
  // 목록을 주지 않으므로 번호는 각 호출이 이미지에서 직접 읽는다. 그러면 표기가 유일한
  // 조인 키인데, 한쪽만 "A-1"을 쓰고 다른 쪽이 "1"을 쓰면 같은 문항이 두 행으로 갈라진다
  // — numKey는 "Q3"/"3." 수준의 장식만 흡수한다.
  for (const p of [buildUserAnswerPrompt(1), buildCorrectAnswerPrompt(1)]) {
    assert.match(p, /as printed next to it/);
    assert.match(p, /A-1/);
  }
});

test('Call2·Call3는 페이지의 모든 문항을 보고하라는 지시를 받는다', () => {
  // 목록이 사라진 만큼 "빠짐없이"가 유일한 완전성 장치다.
  for (const p of [buildUserAnswerPrompt(1), buildCorrectAnswerPrompt(1)]) {
    assert.match(p, /every item you can see/);
  }
});

test('복수답 판정 근거가 호출마다 다르다', () => {
  // 학생답은 **종이에 칠해진 개수**가, 정답은 **발문이 요구하는 개수**가 정한다. 예전에는
  // Call 1이 붙인 [MULTI-SELECT] 태그로 양쪽을 한꺼번에 지시했고, 그러려면 목록이 필요했다.
  const u = buildUserAnswerPrompt(1);
  const c = buildCorrectAnswerPrompt(1);
  assert.match(u, /two or more\*\* numbers/);
  assert.match(c, /모두 고르시오/);
  assert.ok(!u.includes('모두 고르시오'),
    'Call2가 발문 문구로 복수답을 판단하면 종이에 칠해진 것을 보지 않게 된다');
});

test('Call2 프롬프트: 문항을 스스로 풀지 말라고 지시한다', () => {
  // 스키마에 correct_answer 자리가 없어도 "정답과 같은 값을 user_answer 칸에 적는 것"은
  // 막지 못한다 — 지시로도 함께 건다.
  const p = buildUserAnswerPrompt(1);
  assert.match(p, /Do not solve the items/);
  assert.match(p, /[Nn]ever work out which choice is correct/);
  // 마크와 정답이 다른 것이 정상이라는 점을 명시해야 모델이 불일치를 오류로 보지 않는다.
  assert.match(p, /normal, expected case/);
});

test('두 답 호출 모두 복수정답·다중빈칸 배열 규칙을 받는다', () => {
  const u = buildUserAnswerPrompt(1);
  const c = buildCorrectAnswerPrompt(1);
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
