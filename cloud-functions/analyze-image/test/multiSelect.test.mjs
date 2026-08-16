/**
 * 복수정답(multi_select) 지원 회귀 테스트 — GT 라벨 규약 1(2026-07-27 확정).
 *
 * 대상은 전부 순수함수(AI·DB·네트워크 의존 없음)라 `node --test`만으로 돈다.
 * 다루는 경계 4곳:
 *   1. eval/harness/score.mjs      — 추출품질 채점(집합 완전일치, multi_* 버킷 분리)
 *   2. shared/simplePipeline.js    — 모델 출력 → DB 계약 정규화(normalizeItem) + 프롬프트 지시문
 *   3. shared/answerSanitizers.js  — 별칭 판정(isMultiSelectFmt)·번호집합 파싱
 *   4. shared/dbOperations.js      — 프로덕션 정오답 판정(computeIsCorrect)
 *
 * 루트의 test-*.js는 실제 GCP/Supabase를 때리는 수동 스크립트다. 이 디렉터리는 그것과 분리된
 * 자동 실행 단위테스트 전용(`npm test`).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  extractChoiceDigits, isMultiSelectFormat, parseGtAnswerSets,
  classifyMultiSelect, setKey, scoreRun, scoreMultiRun,
} from '../eval/harness/score.mjs';
import { normalizeItem, buildExtractPrompt, buildStructurePrompt } from '../shared/simplePipeline.js';
import { isMultiSelectFmt, sanitizeMcAnswerSet } from '../shared/answerSanitizers.js';
import { computeIsCorrect } from '../shared/dbOperations.js';

const CHOICES4 = ['a', 'b', 'c', 'd'];
const sorted = (set) => [...set].sort((a, b) => a - b);

// ─── 1. extractChoiceDigits ──────────────────────────────────────────────

test('extractChoiceDigits: 스칼라·원문자·배열·객체를 같은 집합으로 본다', () => {
  assert.deepEqual(sorted(extractChoiceDigits('3, 4')), [3, 4]);
  assert.deepEqual(sorted(extractChoiceDigits(['3', '4'])), [3, 4]);
  assert.deepEqual(sorted(extractChoiceDigits([{ value: '3' }, { value: '4' }])), [3, 4]);
  assert.deepEqual(sorted(extractChoiceDigits({ values: ['4', '3'] })), []); // {values}는 GT 래퍼 → parseGtAnswerSets 담당
  assert.deepEqual(sorted(extractChoiceDigits('4번, 3번')), [3, 4]);
});

test('extractChoiceDigits: 인접 원문자를 이어붙이지 않는다("③④"≠34)', () => {
  // 문자열 치환 방식(normalizeChoiceValue)이면 "③④"→"34"로 뭉개져 존재하지 않는 34번을 만든다.
  assert.deepEqual(sorted(extractChoiceDigits('③④')), [3, 4]);
  assert.deepEqual(sorted(extractChoiceDigits('①③')), [1, 3]);
});

test('extractChoiceDigits: 빈 입력은 빈 집합', () => {
  for (const v of [null, undefined, '', [], '해당 없음']) {
    assert.equal(extractChoiceDigits(v).size, 0, `입력=${JSON.stringify(v)}`);
  }
});

test('setKey: 순서 무관 안정 키, 빈 집합은 null', () => {
  assert.equal(setKey(extractChoiceDigits('4, 3')), '3,4');
  assert.equal(setKey(extractChoiceDigits('3, 4')), '3,4');
  assert.equal(setKey(new Set()), null);
});

// ─── 2. 형식 별칭 판정 ────────────────────────────────────────────────────

test('multi 별칭: 계약값 multi와 라벨 어휘 multi_select를 모두 수용', () => {
  for (const fmt of ['multi', 'multi_select']) {
    assert.equal(isMultiSelectFormat(fmt), true, fmt);
    assert.equal(isMultiSelectFmt(fmt), true, fmt);
  }
  for (const fmt of ['single', 'multi_blank', null, undefined, '']) {
    assert.equal(isMultiSelectFormat(fmt), false, String(fmt));
    assert.equal(isMultiSelectFmt(fmt), false, String(fmt));
  }
});

test('multi 별칭: score.mjs 사본과 answerSanitizers 원본이 항상 같은 답을 낸다', () => {
  // score.mjs는 "외부 의존 없음" 규약 때문에 판정을 재구현한다 → 두 정의가 갈라지면
  // eval 지표와 프로덕션 채점이 조용히 어긋난다. 이 테스트가 유일한 연결고리다.
  for (const fmt of ['multi', 'multi_select', 'single', 'multi_blank', 'MULTI', null, undefined, 0, {}]) {
    assert.equal(isMultiSelectFormat(fmt), isMultiSelectFmt(fmt), `불일치: ${JSON.stringify(fmt)}`);
  }
});

// ─── 3. parseGtAnswerSets ────────────────────────────────────────────────

test('parseGtAnswerSets: 지원하는 3가지 라벨 형태', () => {
  assert.deepEqual(parseGtAnswerSets({ values: ['3', '4'] }).map(sorted), [[3, 4]]);
  assert.deepEqual(parseGtAnswerSets(['3', '4']).map(sorted), [[3, 4]]);
  assert.deepEqual(
    parseGtAnswerSets({ ambiguous: true, accept_sets: [['3', '4'], ['3', '5']] }).map(sorted),
    [[3, 4], [3, 5]],
  );
});

test('parseGtAnswerSets: 형태 불명·부재는 null(채점 불가 신호)', () => {
  assert.equal(parseGtAnswerSets(null), null);
  assert.equal(parseGtAnswerSets(undefined), null);
  // 단일정답용 스칼라 라벨({ambiguous, accept})을 복수정답 필드에 잘못 넣은 경우 —
  // 조용히 통과시키면 라벨 결함이 지표에 묻힌다.
  assert.equal(parseGtAnswerSets({ ambiguous: true, accept: ['3', '4'], null_ok: true }), null);
  assert.equal(parseGtAnswerSets({ value: '3' }), null);
});

// ─── 4. classifyMultiSelect ──────────────────────────────────────────────

test('classifyMultiSelect: 집합 완전일치만 correct(순서·표기 무관)', () => {
  const gt = { values: ['3', '4'] };
  assert.equal(classifyMultiSelect(gt, ['3', '4']), 'correct');
  assert.equal(classifyMultiSelect(gt, ['4', '3']), 'correct');
  assert.equal(classifyMultiSelect(gt, '4, 3'), 'correct');
  assert.equal(classifyMultiSelect(gt, '③④'), 'correct');
});

test('classifyMultiSelect: 부분집합·초과집합 모두 wrong(전사 누락은 기권이 아니다)', () => {
  const gt = { values: ['3', '4'] };
  assert.equal(classifyMultiSelect(gt, ['3']), 'wrong');
  assert.equal(classifyMultiSelect(gt, ['3', '4', '5']), 'wrong');
  assert.equal(classifyMultiSelect(gt, ['1', '2']), 'wrong');
});

test('classifyMultiSelect: 아무것도 못 뽑았으면 abstain(precision-first)', () => {
  const gt = { values: ['3', '4'] };
  assert.equal(classifyMultiSelect(gt, null), 'abstain');
  assert.equal(classifyMultiSelect(gt, []), 'abstain');
  assert.equal(classifyMultiSelect(gt, '표시 없음'), 'abstain');
});

test('classifyMultiSelect: 라벨 결함은 abstain(처벌·가점 모두 보류)', () => {
  assert.equal(classifyMultiSelect(null, ['3', '4']), 'abstain');
  assert.equal(classifyMultiSelect({ ambiguous: true, accept: ['3'] }, ['3', '4']), 'abstain');
});

test('classifyMultiSelect: 판독 모호(accept_sets) 중 하나만 맞아도 correct', () => {
  const gt = { ambiguous: true, accept_sets: [['3', '4'], ['3', '5']] };
  assert.equal(classifyMultiSelect(gt, ['3', '5']), 'correct');
  assert.equal(classifyMultiSelect(gt, ['3', '4']), 'correct');
  assert.equal(classifyMultiSelect(gt, ['4', '5']), 'wrong');
});

// ─── 5. scoreRun: 버킷 분리 ──────────────────────────────────────────────

const GT_MIXED = {
  pages: [{
    image: 'p1.png',
    questions: [
      { problem_number: '1', type: 'mc', user_answer: { value: '3' }, correct_answer: { value: '3' } },
      {
        problem_number: '2', type: 'mc', answer_format: 'multi_select',
        user_answers: { values: ['3', '4'] }, correct_answers: { values: ['3', '4'] },
      },
      {
        problem_number: '3', type: 'mc', answer_format: 'multi_select',
        user_answers: { values: ['1', '2'] }, correct_answers: { values: ['1', '2'] },
      },
    ],
  }],
};

test('scoreRun: multi는 mc 버킷을 오염시키지 않는다(이전 결과 파일과 비교 가능성 유지)', () => {
  const run = {
    'p1.png': [
      { problem_number: '1', user_answer: '3', correct_answer: '3' },
      {
        problem_number: '2', answer_format: 'multi',
        user_answer: '3, 4', correct_answer: '3, 4', user_answers: [3, 4], correct_answers: [3, 4],
      },
      { // 정답 집합 중 하나만 추출 → 부분집합 = wrong
        problem_number: '3', answer_format: 'multi',
        user_answer: '1', correct_answer: '1', user_answers: [1], correct_answers: [1],
      },
    ],
  };
  const { totals } = scoreRun(GT_MIXED, run);

  assert.deepEqual(totals.mc_user, { correct: 1, abstain: 0, wrong: 0, missing: 0 });
  assert.deepEqual(totals.mc_correct, { correct: 1, abstain: 0, wrong: 0, missing: 0 });
  assert.deepEqual(totals.multi_user, { correct: 1, abstain: 0, wrong: 1, missing: 0 });
  assert.deepEqual(totals.multi_correct, { correct: 1, abstain: 0, wrong: 1, missing: 0 });
  assert.equal(totals.text_user.correct + totals.text_user.wrong + totals.text_user.abstain, 0);
  assert.equal(totals.summary.multi_gt_invalid, 0);
  assert.equal(totals.summary.multi_user.precision, 0.5);
});

test('scoreRun: 배열이 없으면 스칼라("3, 4")에서 집합을 뽑는다', () => {
  // pipeline-runner를 거치지 않은 구 결과 파일에도 채점이 되어야 한다.
  const run = {
    'p1.png': [
      { problem_number: '1', user_answer: '3', correct_answer: '3' },
      { problem_number: '2', user_answer: '3, 4', correct_answer: '③④' },
      { problem_number: '3', user_answer: '1, 2', correct_answer: '1, 2' },
    ],
  };
  const { totals } = scoreRun(GT_MIXED, run);
  assert.deepEqual(totals.multi_user, { correct: 2, abstain: 0, wrong: 0, missing: 0 });
  assert.deepEqual(totals.multi_correct, { correct: 2, abstain: 0, wrong: 0, missing: 0 });
});

test('scoreRun: 라벨 결함은 multi_gt_invalid로 드러난다(조용한 통과 금지)', () => {
  const gtBad = {
    pages: [{
      image: 'p1.png',
      questions: [{
        problem_number: '2', type: 'mc', answer_format: 'multi_select',
        // 배열 라벨 미정비 — 규약 1 이전의 스칼라 placeholder만 있는 상태
        user_answer: { ambiguous: true, accept: ['3', '4'], null_ok: true },
        correct_answer: { ambiguous: true, accept: ['3', '4'], null_ok: false },
      }],
    }],
  };
  const run = { 'p1.png': [{ problem_number: '2', user_answers: [3, 4], correct_answers: [3, 4] }] };
  const { totals } = scoreRun(gtBad, run);
  assert.equal(totals.summary.multi_gt_invalid, 1);
  assert.deepEqual(totals.multi_user, { correct: 0, abstain: 1, wrong: 0, missing: 0 });
});

test('scoreRun: 문항 누락은 abstain+missing으로 집계', () => {
  const { totals } = scoreRun(GT_MIXED, { 'p1.png': [] });
  assert.deepEqual(totals.multi_user, { correct: 0, abstain: 2, wrong: 0, missing: 2 });
});

// ─── 6. scoreMultiRun: 안정성 ────────────────────────────────────────────

test('scoreMultiRun: 같은 집합의 다른 표기는 flaky가 아니다', () => {
  const runs = [
    { 'p1.png': [{ problem_number: '2', answer_format: 'multi', user_answers: [3, 4], correct_answers: [3, 4] }] },
    { 'p1.png': [{ problem_number: '2', answer_format: 'multi', user_answer: '4, 3', correct_answer: '③④' }] },
  ];
  const gtOnlyMulti = { pages: [{ image: 'p1.png', questions: [GT_MIXED.pages[0].questions[1]] }] };
  const { agg } = scoreMultiRun(gtOnlyMulti, runs);
  assert.equal(agg.flaky_pred, 0);
  assert.equal(agg.flaky_class, 0);
});

test('scoreMultiRun: 집합이 실제로 달라지면 flaky로 잡힌다', () => {
  // normalizeMC를 그대로 쓰면 ["3","4"]와 ["3"]이 둘 다 "3"으로 뭉개져 이 변동을 놓친다.
  const runs = [
    { 'p1.png': [{ problem_number: '2', answer_format: 'multi', user_answers: [3, 4], correct_answers: [3, 4] }] },
    { 'p1.png': [{ problem_number: '2', answer_format: 'multi', user_answers: [3], correct_answers: [3, 4] }] },
  ];
  const gtOnlyMulti = { pages: [{ image: 'p1.png', questions: [GT_MIXED.pages[0].questions[1]] }] };
  const { agg } = scoreMultiRun(gtOnlyMulti, runs);
  assert.equal(agg.flaky_pred, 1);
  assert.equal(agg.flaky_class, 1);
  assert.equal(agg.ever_wrong, 1);
  assert.equal(agg.always_wrong, 0);
});

// ─── 7. sanitizeMcAnswerSet ──────────────────────────────────────────────

test('sanitizeMcAnswerSet: 정렬·중복제거·범위검증', () => {
  assert.deepEqual(sanitizeMcAnswerSet('4, 3, 4', CHOICES4), [3, 4]);
  assert.deepEqual(sanitizeMcAnswerSet('③④', CHOICES4), [3, 4]);
  assert.deepEqual(sanitizeMcAnswerSet(['3', '4'], CHOICES4), [3, 4]); // 배열도 문자열화되어 통과
  assert.deepEqual(sanitizeMcAnswerSet('3, 4, 9', CHOICES4), [3, 4]);  // 범위밖만 개별 폐기
  assert.deepEqual(sanitizeMcAnswerSet('3, 4', []), []);               // 선택지 없음 → 집합 무의미
});

// ─── 8. normalizeItem: 모델 출력 → DB 계약 ────────────────────────────────

test('normalizeItem: multi_select → 계약값 multi + 정렬 배열 + 하위호환 스칼라', () => {
  const item = normalizeItem({
    problem_number: '63', instruction: '어법상 옳은 것을 모두 고르시오. (단, 2개)',
    choices: CHOICES4, answer_format: 'multi_select',
    user_answers: ['4', '3'], correct_answers: ['3', '4'],
  });
  assert.equal(item.answer_format, 'multi');       // DB/프론트 계약값으로 정규화
  assert.deepEqual(item.correct_answers, [3, 4]);
  assert.deepEqual(item.user_answers, [3, 4]);
  assert.equal(item.correct_answer, '3, 4');
  assert.equal(item.user_answer, '3, 4');
});

test('normalizeItem: 배열이 비면 스칼라에서 집합을 복원한다', () => {
  const item = normalizeItem({
    problem_number: '15', choices: CHOICES4, answer_format: 'multi_select',
    user_answer: '②④', correct_answer: '2, 4',
  });
  assert.deepEqual(item.user_answers, [2, 4]);
  assert.deepEqual(item.correct_answers, [2, 4]);
  assert.equal(item.user_answer, '2, 4');
});

test('normalizeItem: 학습자가 덜 표시했으면 그대로 보존한다(지어내지 않음)', () => {
  const item = normalizeItem({
    problem_number: '7', choices: CHOICES4, answer_format: 'multi_select',
    user_answers: ['3'], correct_answers: ['3', '4'],
  });
  assert.deepEqual(item.user_answers, [3]);
  assert.deepEqual(item.correct_answers, [3, 4]);
  assert.equal(item.user_answer, '3');
});

test('normalizeItem: 마크 없음은 null(상위에서 기권)', () => {
  const item = normalizeItem({
    problem_number: '7', choices: CHOICES4, answer_format: 'multi_select',
    user_answers: [], correct_answers: ['3', '4'],
  });
  assert.deepEqual(item.user_answers, []);
  assert.equal(item.user_answer, null);
});

test('normalizeItem: 선택지 2개 미만이면 서술형 답을 파괴하지 않는다', () => {
  // multi_select가 서술형에 잘못 붙으면 sanitizeMcAnswerSet이 빈 배열을 돌려주어
  // 원래 텍스트 답이 null로 날아간다 → choices.length>=2 게이트로 차단.
  const item = normalizeItem({
    problem_number: '9', choices: [], answer_format: 'multi_select',
    user_answer: 'Because he was tired.', correct_answer: 'Because he was tired.',
  });
  assert.notEqual(item.answer_format, 'multi');
  assert.equal(item.correct_answer, 'Because he was tired.');
  assert.equal(item.user_answer, 'Because he was tired.');
});

test('normalizeItem: 단일정답·multi_blank 경로는 영향 없음', () => {
  const single = normalizeItem({ problem_number: '1', choices: CHOICES4, user_answer: '③', correct_answer: '3' });
  assert.equal(single.answer_format, undefined);
  assert.equal(single.user_answer, '3');   // 원문자 → ASCII 백스톱만 적용
  assert.equal(single.correct_answers, undefined);

  const blank = normalizeItem({
    problem_number: '28', answer_format: 'multi_blank', choices: [],
    user_answers: ['a doctor', ''], correct_answers: ['a doctor', 'a painter'],
  });
  assert.equal(blank.answer_format, 'multi_blank');
  assert.deepEqual(blank.correct_answers, ['a doctor', 'a painter']);  // 텍스트 보존(번호집합화 금지)
  assert.deepEqual(blank.user_answers, ['a doctor', null]);            // 인덱스 정렬 보존
});

test('normalizeItem: 스칼라에서 집합을 재도출해도 같은 값(resolveAnswerFormat 정합)', () => {
  // dbOperations.resolveAnswerFormat은 배열을 그대로 쓰지 않고 스칼라에서 다시 뽑는다
  // (sanitizeMcAnswerSet(item.correct_answer, choices)). 두 경로가 갈라지면 DB에 저장되는
  // 집합과 normalizeItem이 만든 집합이 어긋난다.
  for (const raw of [
    { choices: CHOICES4, answer_format: 'multi_select', user_answers: ['4', '3'], correct_answers: ['3', '4'] },
    { choices: CHOICES4, answer_format: 'multi_select', user_answer: '②④', correct_answer: '2, 4' },
    { choices: CHOICES4, answer_format: 'multi_select', user_answers: [], correct_answers: ['1', '2'] },
  ]) {
    const item = normalizeItem({ problem_number: '1', ...raw });
    assert.deepEqual(sanitizeMcAnswerSet(item.correct_answer, item.choices), item.correct_answers);
    assert.deepEqual(sanitizeMcAnswerSet(item.user_answer, item.choices), item.user_answers);
  }
});

// ─── 9. computeIsCorrect: 프로덕션 채점 ──────────────────────────────────

test('computeIsCorrect: multi 집합 완전일치 → true', () => {
  assert.equal(computeIsCorrect({
    user_answer: '3, 4', correct_answer: '3, 4', choices: CHOICES4,
    answer_format: 'multi', user_answers: [3, 4], correct_answers: [3, 4],
  }), true);
});

test('computeIsCorrect: 같은 개수의 다른 집합 → false', () => {
  assert.equal(computeIsCorrect({
    user_answer: '3, 5', correct_answer: '3, 4', choices: ['a', 'b', 'c', 'd', 'e'],
    answer_format: 'multi', user_answers: [3, 5], correct_answers: [3, 4],
  }), false);
});

test('computeIsCorrect: 학습자 집합이 정답보다 작으면 기권(추출누락과 구분 불가)', () => {
  // ud.size < cd.size 게이트. "덜 표시함"과 "덜 추출됨"을 구분할 수 없으므로
  // 오답 단정(confident-wrong) 대신 보류한다 — precision-first.
  assert.equal(computeIsCorrect({
    user_answer: '3', correct_answer: '3, 4', choices: CHOICES4,
    answer_format: 'multi', user_answers: [3], correct_answers: [3, 4],
  }), null);
});

test('computeIsCorrect: 정답이 1개로 접혔으면 기권(cd.size>=2 게이트)', () => {
  assert.equal(computeIsCorrect({
    user_answer: '3', correct_answer: '3', choices: CHOICES4,
    answer_format: 'multi', user_answers: [3], correct_answers: [3],
  }), null);
});

test('computeIsCorrect: multi_select 별칭만으로도 집합채점에 진입한다', () => {
  // 발문 휴리스틱(detectMultiAnswer)이 못 잡는 표현("(2개)" 단독 등)에 대한 방어선.
  // 판별 입력은 '순서만 다른 같은 집합' — 집합채점에 못 들어가면 단일비교가
  // 첫 숫자만 보고(3 vs 4) 정답을 오답으로 단정한다.
  const base = { user_answer: '3, 4', correct_answer: '4, 3', choices: CHOICES4, instruction: null };
  assert.equal(computeIsCorrect(base), false, '전제: 별칭 없으면 단일비교가 false-negative를 낸다');
  assert.equal(computeIsCorrect({
    ...base, answer_format: 'multi_select', user_answers: [3, 4], correct_answers: [3, 4],
  }), true);
});

test('computeIsCorrect: 배열 미전달 시 스칼라 재파싱 폴백(구 호출부 무영향)', () => {
  // 별칭만 있고 정제 배열이 없어도 스칼라에서 집합을 재추출해 같은 결론에 도달해야 한다.
  assert.equal(computeIsCorrect({
    user_answer: '3, 4', correct_answer: '4, 3', choices: CHOICES4,
    instruction: null, answer_format: 'multi_select',
  }), true);
  // 발문 힌트만으로도(구 detectMultiAnswer 경로) 동일.
  assert.equal(computeIsCorrect({
    user_answer: '3, 4', correct_answer: '4, 3', choices: CHOICES4,
    instruction: '모두 고르시오',
  }), true);
});

test('computeIsCorrect: O/X 채점 마크가 있으면 집합채점보다 우선', () => {
  assert.equal(computeIsCorrect({
    user_marked_correctness: 'X',
    user_answer: '3, 4', correct_answer: '3, 4', choices: CHOICES4,
    answer_format: 'multi', user_answers: [3, 4], correct_answers: [3, 4],
  }), false);
});

test('computeIsCorrect: 단일정답 경로는 변경 없음', () => {
  assert.equal(computeIsCorrect({ user_answer: '3', correct_answer: '3', choices: CHOICES4 }), true);
  assert.equal(computeIsCorrect({ user_answer: '2', correct_answer: '3', choices: CHOICES4 }), false);
  assert.equal(computeIsCorrect({ user_answer: null, correct_answer: '3', choices: CHOICES4 }), null);
});

// ─── 10. 파이프라인 연결: normalizeItem → computeIsCorrect ────────────────

test('연결: 모델이 multi_select로 낸 문항이 프로덕션에서 실제로 채점된다', () => {
  // 이 경로가 끊겨 있던 것이 원래 버그다 — Step 2 프롬프트에 복수정답 지시가 없어
  // 모델이 번호를 1개만 내면 cd.size>=2 게이트에 걸려 전부 기권 처리됐다.
  const raw = {
    problem_number: '69', instruction: '어법상 옳은 것을 모두 고르시오. (단, 2개)',
    choices: CHOICES4, answer_format: 'multi_select',
    user_answers: ['3', '4'], correct_answers: ['4', '3'],
  };
  const item = normalizeItem(raw);
  const verdict = computeIsCorrect({
    user_marked_correctness: item.user_marked_correctness,
    user_answer: item.user_answer, correct_answer: item.correct_answer,
    choices: item.choices, instruction: item.instruction,
    answer_format: item.answer_format,
    user_answers: item.user_answers, correct_answers: item.correct_answers,
  });
  assert.equal(verdict, true);
});

// ─── 11. 프롬프트 지시문 존재 ─────────────────────────────────────────────

test('Step 1 프롬프트: 복수정답을 전부 적으라는 지시가 살아있다', () => {
  const p = buildExtractPrompt(1);
  assert.match(p, /모두 고르/);
  assert.match(p, /전부/);
});

test('Step 2 프롬프트: multi_select 스키마·규칙이 살아있다', () => {
  // 4-Pass → 2-스텝 이관 때 이 지시문이 통째로 누락돼 복수정답 채점이 무력화된 전례가 있다.
  const p = buildStructurePrompt('dummy');
  assert.match(p, /multi_select/);
  assert.match(p, /user_answers/);
  assert.match(p, /correct_answers/);
  assert.match(p, /모두 고르/);
});
