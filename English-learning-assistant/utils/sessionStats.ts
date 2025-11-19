import { isCorrectFromMark, normalizeMark } from '../services/marks';

/**
 * 세션의 problems와 labels 데이터로부터 통계를 계산
 */
export function calculateSessionStats(session: any): {
  problem_count: number;
  correct_count: number;
  incorrect_count: number;
} {
  const problems = session.problems || [];
  const problem_count = problems.length;
  let correct_count = 0;
  let incorrect_count = 0;
  
  problems.forEach((problem: any) => {
    const labels = problem.labels || [];
    if (labels.length > 0) {
      const mark = normalizeMark(labels[0].user_mark);
      if (isCorrectFromMark(mark)) correct_count++; else incorrect_count++;
    }
  });
  
  return {
    problem_count,
    correct_count,
    incorrect_count,
  };
}

