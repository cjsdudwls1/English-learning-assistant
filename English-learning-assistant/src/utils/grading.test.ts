/**
 * 채점 계약 회귀 테스트.
 *
 * 이 파일이 지키는 단 하나의 원칙: **자신있는 오답(confident-wrong)보다 기권(null)이 낫다.**
 * 채점 근거가 없거나 형식이 어긋나면 false가 아니라 null이어야 한다. false는 학생 화면에
 * "틀렸습니다"로 확정 표시되고 통계에도 오답으로 누적되지만, null은 '수동 확인'으로 빠진다.
 *
 * 2026-08-29 실제로 잡힌 두 결함을 고정한다:
 *  (1) 객관식 문자열 답안에서 choices[idx]가 없으면 `answer === undefined`가 되어 조용히 오답 확정
 *  (2) short_answer만 trim+toLowerCase라 백엔드(computeIsCorrect)·재풀이 채점과 판정이 갈라짐
 */
import { describe, it, expect } from 'vitest';
import { gradeGeneratedProblem, normalizeOX, normalizeForCompare } from './grading';
import type { GradableProblem } from './grading';

const mc = (over: Partial<GradableProblem> = {}): GradableProblem => ({
  problem_type: 'multiple_choice',
  correct_answer_index: 1,
  choices: [{ text: 'apple' }, { text: 'banana' }, { text: 'cherry' }],
  ...over,
});

describe('gradeGeneratedProblem — 객관식', () => {
  it('인덱스 답안(시험지 경로)을 비교한다', () => {
    expect(gradeGeneratedProblem(mc(), 1)).toBe(true);
    expect(gradeGeneratedProblem(mc(), 2)).toBe(false);
  });

  it('선택지 텍스트 답안(과제 경로)을 비교한다', () => {
    expect(gradeGeneratedProblem(mc(), 'banana')).toBe(true);
    expect(gradeGeneratedProblem(mc(), 'apple')).toBe(false);
  });

  it('정답 인덱스가 없으면 기권한다', () => {
    expect(gradeGeneratedProblem(mc({ correct_answer_index: null }), 1)).toBeNull();
  });

  it('choices가 없으면 오답 확정이 아니라 기권한다', () => {
    // 회귀: 예전엔 undefined와 비교돼 false(오답)로 확정됐다.
    expect(gradeGeneratedProblem(mc({ choices: null }), 'banana')).toBeNull();
    expect(gradeGeneratedProblem(mc({ choices: [] }), 'banana')).toBeNull();
  });

  it('정답 인덱스가 선택지 범위를 벗어나면 기권한다', () => {
    expect(gradeGeneratedProblem(mc({ correct_answer_index: 9 }), 'banana')).toBeNull();
  });

  it('인덱스가 없어도 correct_answer 문자열이 있으면 그걸로 채점한다', () => {
    const p = mc({ correct_answer_index: null, correct_answer: 'banana' });
    expect(gradeGeneratedProblem(p, 'banana')).toBe(true);
    expect(gradeGeneratedProblem(p, 'apple')).toBe(false);
  });
});

describe('gradeGeneratedProblem — 서술형/단답', () => {
  it('essay는 항상 기권한다', () => {
    expect(gradeGeneratedProblem({ problem_type: 'essay', correct_answer: 'x' }, 'x')).toBeNull();
  });

  it('빈 답안은 기권한다', () => {
    expect(gradeGeneratedProblem(mc(), '')).toBeNull();
    expect(gradeGeneratedProblem(mc(), null)).toBeNull();
    expect(gradeGeneratedProblem(mc(), undefined)).toBeNull();
  });

  it('정답 미설정이면 기권한다', () => {
    expect(gradeGeneratedProblem({ problem_type: 'short_answer', correct_answer: '' }, 'cat')).toBeNull();
    expect(gradeGeneratedProblem({ problem_type: 'short_answer', correct_answer: null }, 'cat')).toBeNull();
  });

  it('구두점·대소문자·공백 차이는 정답으로 본다(백엔드 정규화와 동일)', () => {
    const p: GradableProblem = { problem_type: 'short_answer', correct_answer: 'The cat' };
    expect(gradeGeneratedProblem(p, 'the cat')).toBe(true);
    expect(gradeGeneratedProblem(p, 'The cat.')).toBe(true);
    expect(gradeGeneratedProblem(p, '  the  cat  ')).toBe(true);
    expect(gradeGeneratedProblem(p, 'a dog')).toBe(false);
  });

  it("어포스트로피·하이픈은 보존한다(can't ≠ cant)", () => {
    expect(normalizeForCompare("can't")).not.toBe(normalizeForCompare('cant'));
    expect(normalizeForCompare('well-known')).not.toBe(normalizeForCompare('wellknown'));
  });

  it('정규화 후 빈 문자열이 되면 기권한다', () => {
    // 정답이 구두점뿐이면 비교 근거가 없다 → 오답 확정 금지.
    expect(gradeGeneratedProblem({ problem_type: 'short_answer', correct_answer: '...' }, 'cat')).toBeNull();
  });
});

describe('gradeGeneratedProblem — OX', () => {
  const ox = (correct: string | boolean): GradableProblem => ({ problem_type: 'ox', correct_answer: correct });

  it('O/X와 true/false 표기를 섞어 비교한다', () => {
    expect(gradeGeneratedProblem(ox(true), 'O')).toBe(true);
    expect(gradeGeneratedProblem(ox('true'), 'O')).toBe(true);
    expect(gradeGeneratedProblem(ox(false), 'O')).toBe(false);
    expect(gradeGeneratedProblem(ox('X'), false)).toBe(true);
  });

  it('정답이나 답안을 인식 못 하면 기권한다', () => {
    expect(gradeGeneratedProblem(ox('maybe'), 'O')).toBeNull();
    expect(gradeGeneratedProblem(ox(true), 'maybe')).toBeNull();
  });

  it('normalizeOX는 인식 불가 값에 null을 준다', () => {
    expect(normalizeOX('O')).toBe('O');
    expect(normalizeOX('거짓')).toBe('X');
    expect(normalizeOX('아마도')).toBeNull();
    expect(normalizeOX(null)).toBeNull();
  });
});

describe('problem_type 누락', () => {
  it('타입이 없으면 객관식으로 본다(기존 동작 고정)', () => {
    expect(gradeGeneratedProblem({ correct_answer_index: 1, choices: [{ text: 'a' }, { text: 'b' }] }, 'b')).toBe(true);
  });
});
