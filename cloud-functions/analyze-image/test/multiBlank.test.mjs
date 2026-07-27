/**
 * 다중빈칸(multi_blank) 인덱스별 채점 회귀 테스트.
 *
 * 이전에는 배열을 ", "로 이어붙인 스칼라를 text 경로로 채점했다. 그러면 (1)(2)(3) 중 한 칸만
 * 틀려도 문자열 전체가 달라져 "나머지 두 칸은 정확히 읽었다"는 사실이 지표에서 사라졌고,
 * 반대로 부분 오독이 어느 칸에서 났는지도 알 수 없었다.
 *
 * 채점 규약(precision-first, multi_select와 같은 계열):
 *   - 빈칸마다 classifyText로 독립 판정
 *   - 하나라도 wrong → 문항 wrong (부분점수로 오독을 덮지 않는다)
 *   - 전 칸 correct → 문항 correct
 *   - 그 외(일부 correct + 일부 기권) → 문항 abstain (크레딧도 처벌도 없음)
 *   - GT보다 칸을 더 냈으면 없는 빈칸을 지어낸 것 → wrong
 * 문항 단위(blank_*)와 빈칸 단위(blank_cell_*)를 함께 집계해 부분 정확도를 보이게 한다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  isMultiBlankFormat, parseGtBlanks, parsePredBlanks, classifyMultiBlank, scoreRun, scoreMultiRun,
} from '../eval/harness/score.mjs';

test('isMultiBlankFormat: multi_blank만 참', () => {
  assert.equal(isMultiBlankFormat('multi_blank'), true);
  for (const f of ['single', 'multi', 'multi_select', 'text', null, undefined, '']) {
    assert.equal(isMultiBlankFormat(f), false, `입력 ${f}`);
  }
});

test('parseGtBlanks: 스칼라 원소도 {value} 형태로 통일한다', () => {
  assert.deepEqual(parseGtBlanks(['a', null]), [{ value: 'a' }, { value: null }]);
  assert.deepEqual(parseGtBlanks([{ value: 'a', _confidence: 'high' }]), [{ value: 'a', _confidence: 'high' }]);
  assert.equal(parseGtBlanks(null), null, '배열이 아니면 채점 불가');
  assert.equal(parseGtBlanks({ value: 'a' }), null);
});

test('parsePredBlanks: 배열·"(1) x (2) y"·쉼표 스칼라를 모두 칸 배열로 만든다', () => {
  assert.deepEqual(parsePredBlanks(['a', 'b']), ['a', 'b']);
  assert.deepEqual(parsePredBlanks([{ value: 'a' }, { value: 'b' }]), ['a', 'b']);
  assert.deepEqual(parsePredBlanks('(1) between (2) in (3) along'), ['between', 'in', 'along']);
  assert.deepEqual(parsePredBlanks('between, in, along'), ['between', 'in', 'along']);
  assert.deepEqual(parsePredBlanks(null), []);
  assert.deepEqual(parsePredBlanks(undefined), []);
});

const GT3 = [{ value: 'between' }, { value: 'in' }, { value: 'along' }];

test('classifyMultiBlank: 전 칸 일치만 correct', () => {
  const r = classifyMultiBlank(GT3, ['between', 'in', 'along']);
  assert.equal(r.cls, 'correct');
  assert.deepEqual(r.cells, ['correct', 'correct', 'correct']);
  assert.equal(r.invalid, false);
});

test('classifyMultiBlank: 한 칸만 틀려도 문항은 wrong — 단 나머지 칸의 정확도는 cells에 남는다', () => {
  const r = classifyMultiBlank(GT3, ['beetween', 'in', 'along']);
  assert.equal(r.cls, 'wrong');
  assert.deepEqual(r.cells, ['wrong', 'correct', 'correct'],
    '이전 스칼라 채점에서는 이 두 correct가 통째로 사라졌다');
});

test('classifyMultiBlank: 일부만 읽고 나머지는 기권이면 abstain(부분 크레딧 없음, 처벌도 없음)', () => {
  const r = classifyMultiBlank(GT3, ['between', null, null]);
  assert.equal(r.cls, 'abstain');
  assert.deepEqual(r.cells, ['correct', 'abstain', 'abstain']);
});

test('classifyMultiBlank: 예측이 짧으면 부족한 칸은 기권', () => {
  const r = classifyMultiBlank(GT3, ['between']);
  assert.equal(r.cls, 'abstain');
  assert.deepEqual(r.cells, ['correct', 'abstain', 'abstain']);
});

test('classifyMultiBlank: GT보다 칸을 더 내면 지어낸 것 → wrong', () => {
  const r = classifyMultiBlank(GT3, ['between', 'in', 'along', 'over']);
  assert.equal(r.cls, 'wrong');
});

test('classifyMultiBlank: 전 칸 기권이면 abstain', () => {
  assert.equal(classifyMultiBlank(GT3, null).cls, 'abstain');
  assert.equal(classifyMultiBlank(GT3, []).cls, 'abstain');
});

test('classifyMultiBlank: 판독 불가 칸(ambiguous+null_ok)은 어떻게 읽어도 처벌하지 않는다', () => {
  // 실제 라벨 145 B-3: 두 번째 빈칸이 사람 눈으로도 식별 불가 → "to"로 읽든 공란으로 두든 오답 아님
  const gt = [{ value: 'to' }, { ambiguous: true, accept: ['to'], null_ok: true }];
  assert.equal(classifyMultiBlank(gt, ['to', null]).cls, 'abstain', '공란 판독은 기권');
  assert.equal(classifyMultiBlank(gt, ['to', 'to']).cls, 'correct', '"to" 판독도 정답');
  assert.equal(classifyMultiBlank(gt, ['to', 'through']).cls, 'wrong', '허용 밖 판독은 오답');
});

test('classifyMultiBlank: GT가 배열이 아니면 채점 보류(invalid)', () => {
  const r = classifyMultiBlank({ value: 'between, in, along' }, ['between']);
  assert.equal(r.cls, 'abstain');
  assert.equal(r.invalid, true);
});

// ─── scoreRun 통합 ──────────────────────────────────────────────

const gtPage = {
  pages: [{
    image: 'p147.jpg',
    questions: [{
      problem_number: '14', type: 'text', answer_format: 'multi_blank',
      user_answers: [{ value: 'beetween' }, { value: 'in' }, { value: 'along' }],
      correct_answers: [{ value: 'between' }, { value: 'in' }, { value: 'along' }],
      // 이어붙인 우회 스칼라가 남아 있어도 배열이 우선이어야 한다
      user_answer: { value: 'beetween, in, along', _placeholder: true },
      correct_answer: { value: 'between, in, along', _placeholder: true },
    }],
  }],
};

test('scoreRun: multi_blank는 text가 아니라 blank 버킷으로 집계된다', () => {
  const run = {
    'p147.jpg': [{
      problem_number: '14', answer_format: 'multi_blank',
      user_answers: ['beetween', 'in', 'along'],
      correct_answers: ['between', 'in', 'along'],
    }],
  };
  const { totals } = scoreRun(gtPage, run);
  assert.deepEqual(totals.blank_user, { correct: 1, abstain: 0, wrong: 0, missing: 0 });
  assert.deepEqual(totals.blank_correct, { correct: 1, abstain: 0, wrong: 0, missing: 0 });
  assert.equal(totals.text_user.correct + totals.text_user.wrong + totals.text_user.abstain, 0,
    'text 버킷은 건드리지 않는다');
  assert.equal(totals.summary.blank_gt_invalid, 0);
});

test('scoreRun: 학생 오타를 정상 철자로 "교정"해 읽으면 오답으로 잡힌다', () => {
  // 하네스가 재는 것은 "모델이 학생 답을 정확히 읽었는가"다. between으로 고쳐 읽으면 학생 답 왜곡.
  const run = {
    'p147.jpg': [{
      problem_number: '14', answer_format: 'multi_blank',
      user_answers: ['between', 'in', 'along'],
      correct_answers: ['between', 'in', 'along'],
    }],
  };
  const { totals, perInstance } = scoreRun(gtPage, run);
  assert.equal(totals.blank_user.wrong, 1);
  assert.equal(totals.blank_correct.correct, 1, '인쇄 정답 쪽은 맞다');
  assert.deepEqual(perInstance[0].user_answer.cells, ['wrong', 'correct', 'correct']);
});

test('scoreRun: 빈칸 단위 집계가 부분 정확도를 드러낸다', () => {
  const run = {
    'p147.jpg': [{
      problem_number: '14', answer_format: 'multi_blank',
      user_answers: ['between', 'in', 'along'],
      correct_answers: ['between', 'in', 'along'],
    }],
  };
  const { totals } = scoreRun(gtPage, run);
  // 문항 단위로는 wrong 1건이지만, 3칸 중 2칸은 정확히 읽었다는 사실이 남는다
  assert.deepEqual(totals.blank_cell_user, { correct: 2, abstain: 0, wrong: 1, missing: 0 });
  assert.equal(totals.summary.blank_cell_user.precision, 0.6667);
});

test('scoreRun: 배열이 없고 스칼라만 온 예측도 인덱스 채점을 받는다', () => {
  const run = {
    'p147.jpg': [{ problem_number: '14', answer_format: 'multi_blank', user_answer: '(1) beetween (2) in (3) along', correct_answer: '(1) between (2) in (3) along' }],
  };
  const { totals } = scoreRun(gtPage, run);
  assert.deepEqual(totals.blank_user, { correct: 1, abstain: 0, wrong: 0, missing: 0 });
});

test('scoreRun: 문항이 통째로 누락되면 missing + 전 칸 기권', () => {
  const { totals } = scoreRun(gtPage, { 'p147.jpg': [] });
  assert.deepEqual(totals.blank_user, { correct: 0, abstain: 1, wrong: 0, missing: 1 });
  assert.equal(totals.blank_cell_user.abstain, 3);
});

test('scoreRun: 라벨에 배열이 없으면 blank_gt_invalid로 드러난다(조용한 통과 금지)', () => {
  const badGt = {
    pages: [{
      image: 'p.jpg',
      questions: [{
        problem_number: '1', type: 'text', answer_format: 'multi_blank',
        user_answer: { value: 'a, b' }, correct_answer: { value: 'a, b' },
      }],
    }],
  };
  const { totals } = scoreRun(badGt, { 'p.jpg': [{ problem_number: '1', user_answers: ['a', 'b'] }] });
  assert.equal(totals.summary.blank_gt_invalid, 1);
  assert.deepEqual(totals.blank_user, { correct: 0, abstain: 1, wrong: 0, missing: 0 });
});

test('scoreMultiRun: 칸 순서가 바뀌면 다른 예측으로 잡힌다(집합으로 뭉개지 않는다)', () => {
  const runs = [
    { 'p147.jpg': [{ problem_number: '14', answer_format: 'multi_blank', user_answers: ['beetween', 'in', 'along'], correct_answers: ['between', 'in', 'along'] }] },
    { 'p147.jpg': [{ problem_number: '14', answer_format: 'multi_blank', user_answers: ['in', 'beetween', 'along'], correct_answers: ['between', 'in', 'along'] }] },
  ];
  const { agg } = scoreMultiRun(gtPage, runs);
  assert.equal(agg.flaky_pred, 1, '순서가 다르면 flaky로 잡혀야 한다');
});
