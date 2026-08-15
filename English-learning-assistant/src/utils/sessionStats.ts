import { isCorrectFromMark, normalizeMark } from '../services/marks';
import { unwrapEmbedded } from './postgrestEmbed';

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
    // labels 임베드는 관계 cardinality에 따라 배열/객체로 모양이 갈린다 — unwrapEmbedded 참고.
    // 예전엔 `labels.length > 0`로 판정했는데, 객체의 .length는 undefined라 조건이 늘 거짓이 되어
    // 정답·오답이 모두 0으로 집계됐다.
    const label = unwrapEmbedded<any>(problem.labels);
    if (label) {
      const mark = normalizeMark(label.user_mark);
      if (isCorrectFromMark(mark)) correct_count++; else incorrect_count++;
    }
  });
  
  return {
    problem_count,
    correct_count,
    incorrect_count,
  };
}

