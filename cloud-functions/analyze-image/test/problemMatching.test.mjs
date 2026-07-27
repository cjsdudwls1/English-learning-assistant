/**
 * 문항 번호 매칭 회귀 테스트 — 섹션별 번호 재시작(A-1 / B-1 / C-1) 대응.
 *
 * 배경(2026-07-28 실측): 교재 Unit Exercise는 한 페이지 안에서 구획 A·B·C가 각각 1번부터
 * 다시 시작한다. score.mjs가 첫 숫자열만 키로 쓰던 시절에는 세 문항이 전부 "1"로 뭉개져
 * byNum Map에서 마지막 것만 살아남았고, GT를 그대로 되돌려주는 완벽한 예측조차 다른 섹션의
 * 문항과 대조돼 29문항 중 14개가 wrong으로 찍혔다.
 *
 * 이 파일이 지키는 것:
 *   1. 정밀 키가 섹션을 보존한다 (표기 흔들림 A-1 / A 1 / A1은 흡수)
 *   2. 장식 접두(Q, 문제, #)는 식별자가 아니므로 제거된다 — 기존 GT(숫자만)와의 하위호환
 *   3. 번호가 모호하면 매칭을 포기한다 — 엉뚱한 문항과 짝지어 confident-wrong을 만들지 않는다
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { normalizeProblemNum, looseProblemNum, scoreRun } from '../eval/harness/score.mjs';

test('normalizeProblemNum: 섹션 접두를 보존하고 표기 흔들림은 흡수한다', () => {
  for (const v of ['A-1', 'A 1', 'A1', 'a-1', 'A.1', 'A) 1']) {
    assert.equal(normalizeProblemNum(v), 'a-1', `입력 ${v}`);
  }
  assert.equal(normalizeProblemNum('B-2'), 'b-2');
  assert.equal(normalizeProblemNum('C-15'), 'c-15');
  // 섹션이 다르면 키도 달라야 한다 — 이게 깨지면 애초의 버그가 되돌아온다
  assert.notEqual(normalizeProblemNum('A-1'), normalizeProblemNum('C-1'));
});

test('normalizeProblemNum: 장식 접두/접미는 식별자가 아니므로 순수 번호와 같은 키다', () => {
  for (const v of ['1', ' 1 ', '1.', '1번', '(1)', 'Q1', 'Q-1', 'Q. 1', '#1', '문제 1', '문항1', 'No.1']) {
    assert.equal(normalizeProblemNum(v), '1', `입력 ${v}`);
  }
});

test('normalizeProblemNum: 번호 없는 교재 연습의 폴백 번호도 서로 충돌하지 않는다', () => {
  // simplePipeline이 번호 없는 문항에 "연습 N"을 부여한다. 숫자만 뽑으면 실제 1번과 겹친다.
  assert.equal(normalizeProblemNum('연습 1'), '연습-1');
  assert.notEqual(normalizeProblemNum('연습 1'), normalizeProblemNum('1'));
  // 숫자가 아예 없으면 원문(소문자)이 키
  assert.equal(normalizeProblemNum('서술형'), '서술형');
  assert.equal(normalizeProblemNum(''), '');
  assert.equal(normalizeProblemNum(null), '');
  assert.equal(normalizeProblemNum(undefined), '');
});

test('looseProblemNum: 구 동작(첫 숫자열)을 유지한다 — 폴백 전용', () => {
  assert.equal(looseProblemNum('A-1'), '1');
  assert.equal(looseProblemNum('C-1'), '1');
  assert.equal(looseProblemNum('Q7'), '7');
  assert.equal(looseProblemNum('15'), '15');
});

// ─── scoreRun 매칭 ──────────────────────────────────────────────

/** 섹션 A/B/C가 각각 1번부터 시작하는 한 페이지 (실제 143쪽 구조의 축소판) */
const sectionedGt = {
  pages: [{
    image: 'p143.jpg',
    questions: [
      { problem_number: 'A-1', type: 'text', user_answer: { value: 'on' }, correct_answer: { value: 'on' } },
      { problem_number: 'B-1', type: 'text', user_answer: { value: 'through' }, correct_answer: { value: 'through' } },
      { problem_number: 'C-1', type: 'text', user_answer: { value: 'at night' }, correct_answer: { value: 'at night' } },
    ],
  }],
};

test('scoreRun: 섹션이 겹치는 페이지에서 완벽한 예측은 wrong 0이다', () => {
  const run = {
    'p143.jpg': [
      { problem_number: 'A-1', user_answer: 'on', correct_answer: 'on' },
      { problem_number: 'B-1', user_answer: 'through', correct_answer: 'through' },
      { problem_number: 'C-1', user_answer: 'at night', correct_answer: 'at night' },
    ],
  };
  const { totals } = scoreRun(sectionedGt, run);
  assert.deepEqual(totals.text_user, { correct: 3, abstain: 0, wrong: 0, missing: 0 });
  assert.deepEqual(totals.text_correct, { correct: 3, abstain: 0, wrong: 0, missing: 0 });
  assert.equal(totals.extra_problems, 0);
});

test('scoreRun: 예측 순서가 뒤섞여도 섹션 키로 정확히 짝지어진다', () => {
  const run = {
    'p143.jpg': [
      { problem_number: 'C-1', user_answer: 'at night', correct_answer: 'at night' },
      { problem_number: 'A-1', user_answer: 'on', correct_answer: 'on' },
      { problem_number: 'B-1', user_answer: 'through', correct_answer: 'through' },
    ],
  };
  const { totals } = scoreRun(sectionedGt, run);
  assert.equal(totals.text_user.wrong, 0);
  assert.equal(totals.text_user.correct, 3);
});

test('scoreRun: 섹션 없이 "1"만 낸 예측은 오매칭 대신 기권 처리된다', () => {
  // 페이지에 "1"이 셋이라 어느 문항인지 특정 불가 → 매칭 포기(missing=비처벌).
  // 예전에는 이 입력이 C-1과 짝지어져 A/B 문항을 confident-wrong으로 만들었다.
  const run = { 'p143.jpg': [{ problem_number: '1', user_answer: 'on', correct_answer: 'on' }] };
  const { totals, perInstance } = scoreRun(sectionedGt, run);
  assert.equal(totals.text_user.wrong, 0, '오매칭으로 인한 wrong이 없어야 한다');
  assert.equal(totals.text_user.abstain, 3);
  assert.equal(totals.text_user.missing, 3);
  assert.ok(perInstance.every((i) => i.missing));
  assert.equal(totals.extra_problems, 1, '짝을 못 찾은 예측은 extra로 잡힌다');
});

test('scoreRun: 번호가 유일한 페이지는 표기가 달라도 관대 키로 매칭된다(하위호환)', () => {
  // 기존 ground-truth.json은 전부 숫자만이라 이 폴백 경로로 종전과 동일하게 동작해야 한다.
  const gt = {
    pages: [{
      image: 'p146.jpg',
      questions: [
        { problem_number: '1', type: 'mc', user_answer: { value: '3' }, correct_answer: { value: '3' } },
        { problem_number: '2', type: 'mc', user_answer: { value: '4' }, correct_answer: { value: '4' } },
      ],
    }],
  };
  const run = {
    'p146.jpg': [
      { problem_number: 'Q1', user_answer: '3', correct_answer: '3' },
      { problem_number: '2번', user_answer: '4', correct_answer: '4' },
    ],
  };
  const { totals } = scoreRun(gt, run);
  assert.deepEqual(totals.mc_user, { correct: 2, abstain: 0, wrong: 0, missing: 0 });
  assert.equal(totals.extra_problems, 0);
});

test('scoreRun: 예측 쪽에 같은 번호가 둘이면 폴백하지 않는다', () => {
  const gt = {
    pages: [{
      image: 'p.jpg',
      questions: [{ problem_number: '1', type: 'mc', user_answer: { value: '3' }, correct_answer: { value: '3' } }],
    }],
  };
  // GT는 "1" 하나지만 예측이 A-1·B-1 둘 → 어느 쪽인지 알 수 없으므로 매칭 포기
  const run = {
    'p.jpg': [
      { problem_number: 'A-1', user_answer: '3', correct_answer: '3' },
      { problem_number: 'B-1', user_answer: '5', correct_answer: '5' },
    ],
  };
  const { totals } = scoreRun(gt, run);
  assert.equal(totals.mc_user.wrong, 0);
  assert.equal(totals.mc_user.missing, 1);
  assert.equal(totals.extra_problems, 2);
});

test('scoreRun: 서로 다른 페이지의 같은 번호는 여전히 각자 채점된다', () => {
  const gt = {
    pages: [
      { image: 'a.jpg', questions: [{ problem_number: '1', type: 'mc', user_answer: { value: '3' }, correct_answer: { value: '3' } }] },
      { image: 'b.jpg', questions: [{ problem_number: '1', type: 'mc', user_answer: { value: '5' }, correct_answer: { value: '5' } }] },
    ],
  };
  const run = {
    'a.jpg': [{ problem_number: '1', user_answer: '3', correct_answer: '3' }],
    'b.jpg': [{ problem_number: '1', user_answer: '5', correct_answer: '5' }],
  };
  const { totals } = scoreRun(gt, run);
  assert.deepEqual(totals.mc_user, { correct: 2, abstain: 0, wrong: 0, missing: 0 });
});
