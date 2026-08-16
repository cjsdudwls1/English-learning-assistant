/**
 * cardinality 계약 회귀 — "값의 모양"이 채점 분기의 유일한 기준임을 고정한다.
 *
 * 지키려는 성질: 새 문제 유형(answer_format 이름)이 생겨도 채점 코드를 고칠 필요가 없다.
 * 아는 모양이면 그 모양대로 채점하고, 모르면 기권한다. 이 파일이 깨지면 새 유형이
 * 단일 비교로 조용히 채점돼 confident-wrong(자신있는 오답)이 난다.
 *
 * 검증 대상:
 *   1. shared/answerShape.js    — toCardinality 매핑
 *   2. shared/dbOperations.js   — computeIsCorrect 기권 / buildContentJson 저장 형태
 *   3. shared/simplePipeline.js — normalizeItem의 미지 형식·원출력 보존
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { toCardinality } from '../shared/answerShape.js';
import { computeIsCorrect, buildContentJson } from '../shared/dbOperations.js';
import { normalizeItem } from '../shared/simplePipeline.js';

// ─── 1. toCardinality 매핑 ────────────────────────────────────────────────

test('toCardinality: 아는 형식은 세 모양 중 하나로 떨어진다', () => {
  // one — 형식 개념 도입 전 레거시(미기재)도 여기로. 그 시절 저장된 건 전부 단일답이다.
  assert.equal(toCardinality(undefined), 'one');
  assert.equal(toCardinality(null), 'one');
  assert.equal(toCardinality(''), 'one');
  assert.equal(toCardinality('   '), 'one');
  assert.equal(toCardinality('single'), 'one');
  // set — 저장 계약값('multi')과 모델·GT 라벨 어휘('multi_select')가 공존한다
  assert.equal(toCardinality('multi'), 'set');
  assert.equal(toCardinality('multi_select'), 'set');
  // list
  assert.equal(toCardinality('multi_blank'), 'list');
});

test('toCardinality: 모르는 형식은 판정하지 않는다(null)', () => {
  assert.equal(toCardinality('unknown'), null);
  assert.equal(toCardinality('ordering'), null); // 아직 없는 유형이 와도 코드 수정 없이 여기로
  assert.equal(toCardinality('matching'), null);
  assert.equal(toCardinality(42), null);
});

// ─── 2. computeIsCorrect: 모양별 채점 ────────────────────────────────────

test('computeIsCorrect: 모르는 형식은 채점하지 않고 기권한다', () => {
  // 값만 보면 단일 비교로 "정답"이 나오는 입력. 하지만 형식을 모르면 그 비교가 성립하는지 알 수 없다
  // (순서·매칭 유형이라면 "3"과 "3"이 같아도 정답이 아닐 수 있다).
  const args = { user_answer: '3', correct_answer: '3', choices: [{ text: 'a' }, { text: 'b' }, { text: 'c' }] };
  assert.equal(computeIsCorrect({ ...args, answer_format: 'single' }), true);
  assert.equal(computeIsCorrect({ ...args, answer_format: undefined }), true); // 레거시도 그대로 채점
  assert.equal(computeIsCorrect({ ...args, answer_format: 'ordering' }), null);
  assert.equal(computeIsCorrect({ ...args, answer_format: 'unknown' }), null);
});

test('computeIsCorrect: 시험지 O/X 마크는 형식을 몰라도 그대로 쓴다', () => {
  // 기권은 자동 비교에만 적용된다. 사람이 시험지에 매긴 채점은 형식과 무관하게 신뢰한다.
  assert.equal(computeIsCorrect({ user_marked_correctness: 'O', answer_format: 'ordering' }), true);
  assert.equal(computeIsCorrect({ user_marked_correctness: 'X', answer_format: 'ordering' }), false);
});

test('computeIsCorrect: set은 완전일치, list는 항상 기권 (기존 동작 유지)', () => {
  const choices = [{ text: 'a' }, { text: 'b' }, { text: 'c' }, { text: 'd' }];
  const setArgs = {
    answer_format: 'multi', choices,
    user_answer: '2, 4', correct_answer: '2, 4',
    user_answers: [2, 4], correct_answers: [2, 4],
  };
  assert.equal(computeIsCorrect(setArgs), true);
  assert.equal(computeIsCorrect({ ...setArgs, user_answers: [2, 3], user_answer: '2, 3' }), false);
  // 정답이 1개뿐이거나 사용자가 덜 골랐으면 집합 게이트 미충족 → 기권
  assert.equal(computeIsCorrect({ ...setArgs, correct_answers: [2], correct_answer: '2' }), null);
  // list(다중빈칸 자유서술)는 자동 비교로 채점할 수 없다
  assert.equal(computeIsCorrect({
    answer_format: 'multi_blank', user_answer: 'a', correct_answer: 'a',
  }), null);
});

// ─── 3. normalizeItem: 미지 형식·원출력 보존 ─────────────────────────────

test('normalizeItem: 모르는 형식 이름을 버리지 않고 보존한다', () => {
  // 예전엔 여기서 조용히 사라져 단일답으로 취급됐다. 이름이 남아야 하류가 기권할 수 있다.
  const item = normalizeItem({
    problem_number: '1', answer_format: 'ordering', user_answer: '3', correct_answer: '3',
  });
  assert.equal(item.answer_format, 'ordering');
  assert.equal(toCardinality(item.answer_format), null);
});

test('normalizeItem: 아는 형식은 계약값으로 정규화된다(기존 동작 유지)', () => {
  const mc = normalizeItem({
    problem_number: '1', answer_format: 'multi_select',
    choices: ['a', 'b', 'c', 'd'], correct_answer: '2, 4', user_answer: '2, 4',
  });
  assert.equal(mc.answer_format, 'multi'); // 모델 어휘 multi_select → 저장 계약값 multi
  const single = normalizeItem({ problem_number: '2', correct_answer: '3' });
  assert.equal(single.answer_format, undefined); // 단일답은 형식을 달지 않는다(레거시 호환)
});

test('normalizeItem: 모델 원출력을 _raw로 보존하되 열거되지는 않게 한다', () => {
  const raw = { problem_number: '1', correct_answer: '2', 아직_모르는_필드: '보존' };
  const item = normalizeItem(raw);
  assert.equal(item._raw, raw);
  assert.equal(item._raw['아직_모르는_필드'], '보존');
  // 기존 코드가 item을 순회·직렬화·비교할 때 갑자기 끼어들면 안 된다.
  assert.ok(!Object.keys(item).includes('_raw'));
  assert.ok(!JSON.stringify(item).includes('_raw'));
});

// ─── 4. buildContentJson: 저장 형태 ──────────────────────────────────────

test('buildContentJson: cardinality와 모델 원출력을 함께 저장한다', () => {
  const raw = { problem_number: '1', correct_answer: '2', 아직_모르는_필드: 'x' };
  const item = normalizeItem(raw);
  const content = buildContentJson(item, item.choices);
  assert.equal(content.cardinality, 'one');
  // 정규화가 버린 필드도 raw에 남아, 나중에 필요해지면 이미지 재분석 없이 되살릴 수 있다.
  assert.equal(content.raw['아직_모르는_필드'], 'x');
});

test('buildContentJson: 복수정답은 set, 다중빈칸은 list로 기록된다', () => {
  const mc = normalizeItem({
    problem_number: '1', answer_format: 'multi_select',
    choices: ['a', 'b', 'c', 'd'], correct_answer: '2, 4', user_answer: '2, 4',
  });
  const setContent = buildContentJson(mc, mc.choices);
  assert.equal(setContent.cardinality, 'set');
  assert.deepEqual(setContent.correct_answers, [2, 4]);

  const mb = normalizeItem({
    problem_number: '2', answer_format: 'multi_blank',
    correct_answers: ['apple', 'banana'], user_answers: ['apple', null],
  });
  const listContent = buildContentJson(mb, mb.choices);
  assert.equal(listContent.cardinality, 'list');
  assert.deepEqual(listContent.correct_answers, ['apple', 'banana']);
});

test('buildContentJson: 모르는 형식은 이름을 남기고 cardinality는 null로 둔다', () => {
  // 'single'로 덮으면 하류가 단일 비교로 채점해버린다. 이름을 남겨 기권을 유도한다.
  const item = normalizeItem({ problem_number: '1', answer_format: 'ordering', correct_answer: '3' });
  const content = buildContentJson(item, item.choices);
  assert.equal(content.answer_format, 'ordering');
  assert.equal(content.cardinality, null);
});
