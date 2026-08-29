/**
 * 시험지 저장 대상 선별 회귀 테스트.
 *
 * 이 파일이 지키는 단 하나의 원칙: **미응답 문항은 DB에 저장하지 않는다.**
 * saveGeneratedProblemResults는 onConflict: 'user_id,problem_id' upsert이므로
 * 미응답의 isCorrect=null이 저장되면 예전에 맞힌 true가 지워진다(정답률 하락).
 *
 * 2026-08-29 QA 감사에서 잡힌 결함을 고정한다:
 *  필터가 `results.filter(r => r.problemId)` — "답을 했는가"가 아니라 "id가 있는가"였다.
 */
import { describe, it, expect } from 'vitest';
import { isAnswered, selectSavableResults } from './testSheetSave';

describe('isAnswered', () => {
  it('빈 값은 미응답이다', () => {
    expect(isAnswered(null)).toBe(false);
    expect(isAnswered(undefined)).toBe(false);
    expect(isAnswered('')).toBe(false);
  });

  it('공백만 입력한 것도 미응답이다', () => {
    // 재풀이(RetryProblemsPage)의 `(answers[id] ?? '').trim() !== ''`와 같은 규칙
    expect(isAnswered('   ')).toBe(false);
    expect(isAnswered('\n\t')).toBe(false);
  });

  it('OX의 false와 객관식 0번은 유효한 응답이다', () => {
    // falsy라는 이유로 걸러지면 X를 고른 학생·A를 고른 학생의 답이 통째로 사라진다
    expect(isAnswered(false)).toBe(true);
    expect(isAnswered(0)).toBe(true);
  });

  it('내용이 있는 답은 응답이다', () => {
    expect(isAnswered('apple')).toBe(true);
    expect(isAnswered(true)).toBe(true);
    expect(isAnswered(2)).toBe(true);
  });
});

describe('selectSavableResults', () => {
  const answered = { problemId: 'p1', userAnswer: 'apple', isCorrect: true };
  const unanswered = { problemId: 'p2', userAnswer: null, isCorrect: null };
  const blank = { problemId: 'p3', userAnswer: '  ', isCorrect: null };
  const noId = { problemId: '', userAnswer: 'banana', isCorrect: false };

  it('미응답 문항을 저장 대상에서 제외한다', () => {
    // 회귀: 예전엔 id만 보고 통과시켜 isCorrect=null이 기존 정답 기록을 덮어썼다
    expect(selectSavableResults([answered, unanswered])).toEqual([answered]);
  });

  it('공백만 입력한 문항도 저장하지 않는다', () => {
    // gradeGeneratedProblem이 '  '를 채점 불가(null)로 돌려주므로 저장하면 같은 덮어쓰기가 난다
    expect(selectSavableResults([answered, blank])).toEqual([answered]);
  });

  it('problemId가 없으면 저장하지 않는다', () => {
    expect(selectSavableResults([noId])).toEqual([]);
  });

  it('OX의 false 응답은 저장한다', () => {
    const oxFalse = { problemId: 'p4', userAnswer: false, isCorrect: true };
    expect(selectSavableResults([oxFalse])).toEqual([oxFalse]);
  });

  it('답한 서술형(자동 채점 불가)은 저장 대상에 남긴다', () => {
    // isCorrect=null이어도 '응답했다'는 사실 자체는 기록 대상 — 판정 기준은 채점 결과가 아니라 응답 여부
    const essay = { problemId: 'p5', userAnswer: 'my long answer', isCorrect: null };
    expect(selectSavableResults([essay])).toEqual([essay]);
  });

  it('전부 미응답이면 빈 배열 — 저장 호출 자체가 일어나지 않는다', () => {
    expect(selectSavableResults([unanswered, blank])).toEqual([]);
  });

  it('시간 균등 분배의 분모가 되는 개수는 응답한 문항 수다', () => {
    // 총 소요시간을 저장 대상 수로 나눠 문제별 시간을 잡으므로, 이 개수가 곧 분모다
    const results = [answered, unanswered, blank, noId];
    expect(selectSavableResults(results)).toHaveLength(1);
  });
});
