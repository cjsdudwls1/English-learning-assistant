/**
 * 시험지(TestSheetView) 제출 → DB 저장 대상 선별.
 *
 * saveGeneratedProblemResults는 UNIQUE(user_id, problem_id) upsert라 넘긴 값이 기존 기록을 **덮는다**.
 * 미응답 문항까지 넘기면 gradeGeneratedProblem이 기권으로 돌려준 isCorrect=null이
 * 예전에 맞힌 true를 지워, 학생 정답률이 아무 이유 없이 떨어진다.
 *
 * '답을 했는가' 판정은 재풀이(RetryProblemsPage)와 같은 규칙 — 공백만 입력한 것도 미응답으로 본다.
 * 두 경로가 갈리면 같은 상황에서 한쪽만 기록을 덮어써 원인 추적이 불가능해진다.
 */

/** 사용자가 실제로 답을 했는지. 공백만 있는 문자열은 미응답. OX의 false는 유효한 응답. */
export function isAnswered(answer: string | number | boolean | null | undefined): boolean {
  if (answer === null || answer === undefined) return false;
  if (typeof answer === 'string') return answer.trim() !== '';
  return true;
}

export interface SavableCandidate {
  problemId: string | null | undefined;
  userAnswer: string | number | boolean | null | undefined;
}

/** DB 저장 대상만 남긴다 — problemId가 있고, 실제로 응답한 문항. */
export function selectSavableResults<T extends SavableCandidate>(results: T[]): T[] {
  return results.filter((r) => Boolean(r.problemId) && isAnswered(r.userAnswer));
}
