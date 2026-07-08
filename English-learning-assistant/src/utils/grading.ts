/**
 * 공유 채점 유틸 — 시험지(TestSheetView)·과제(AnswerInput/AssignmentSolvePage)·재풀이(RetryProblemsPage)의
 * 채점 로직 단일화.
 *
 * 반환값 계약: true=정답, false=오답, null=자동 채점 불가(수동 확인).
 * 서술형·정답 미설정·형식 불일치를 false(오답 단정)로 뭉개지 않는 것이 핵심 —
 * null은 통계에서 제외하고 화면에는 '수동 확인'으로 표시한다.
 */
import type { GeneratedProblem, ProblemItem } from '../types';
import { getManualReviewReason, extractOptionDigits } from './gradingSafety';

/** 채점에 필요한 필드만 추린 문제 형태 — GeneratedProblem 및 시험지의 느슨한 문제 객체 호환 */
export interface GradableProblem {
  problem_type?: GeneratedProblem['problem_type'] | null;
  correct_answer_index?: number | null;
  correct_answer?: string | boolean | null;
  choices?: Array<{ text: string }> | null;
}

// OX 값 정규화: 'O'/'X' 입력과 'true'/'false'(및 흔한 변형) 정답 형식을 통일
// O = 참(true), X = 거짓(false). 인식 불가 값은 null
export function normalizeOX(value: string | boolean | null | undefined): 'O' | 'X' | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'boolean') return value ? 'O' : 'X';
  const v = value.trim().toLowerCase();
  if (['o', '○', 'true', 't', 'yes', 'y', '1', '참', '맞음', '정답'].includes(v)) return 'O';
  if (['x', '×', 'false', 'f', 'no', 'n', '0', '거짓', '틀림', '오답'].includes(v)) return 'X';
  return null;
}

/**
 * 채점 비교용 정규화 — 백엔드 computeIsCorrect(dbOperations.js)의 서술형 정규화와 정합.
 * 대소문자·구두점(.,?!;:"/)·공백(한글 띄어쓰기 포함) 무시, 어포스트로피(')·하이픈(-)은 보존(can't≠cant).
 */
export function normalizeForCompare(s: string): string {
  return s
    .toLowerCase()
    .replace(/[.,?!;:"/]/g, '')
    .replace(/\s+/g, '');
}

/**
 * 생성 문제(generated_problems) 채점.
 * answer 형태 호환: 객관식은 선택지 인덱스(number, 시험지) 또는 선택지 텍스트(string, 과제),
 * OX는 boolean(시험지) 또는 'O'/'X' 문자열(과제), 그 외는 문자열.
 */
export function gradeGeneratedProblem(
  problem: GradableProblem,
  answer: string | number | boolean | null | undefined
): boolean | null {
  const type = problem.problem_type ?? 'multiple_choice';

  if (type === 'essay') return null;
  if (answer === null || answer === undefined || answer === '') return null;

  if (type === 'multiple_choice') {
    const idx = problem.correct_answer_index;
    if (typeof answer === 'number') {
      if (idx === null || idx === undefined) return null;
      return answer === idx;
    }
    if (typeof answer === 'string') {
      if (idx === null || idx === undefined) {
        if (problem.correct_answer === null || problem.correct_answer === undefined || problem.correct_answer === '') return null;
        return answer === problem.correct_answer;
      }
      return answer === problem.choices?.[idx]?.text;
    }
    return null;
  }

  if (type === 'ox') {
    const correct = normalizeOX(problem.correct_answer);
    if (correct === null) return null; // 정답 미설정 → 채점 불가(미채점)
    const user = normalizeOX(typeof answer === 'boolean' ? answer : String(answer));
    if (user === null) return null;
    return user === correct;
  }

  // short_answer
  const correct = problem.correct_answer;
  if (correct === null || correct === undefined || String(correct).trim() === '') return null;
  return String(correct).trim().toLowerCase() === String(answer).trim().toLowerCase();
}

/**
 * 등록 문제(problems/labels, ProblemItem) 재풀이 채점.
 * gradingSafety의 수동 확인 게이트(복수정답·multi_blank·형식 불일치)를 먼저 통과해야 자동 채점.
 * 객관식은 번호(원문자 포함) 비교, OX형은 normalizeOX, 그 외는 정규화 문자열 비교.
 */
export function gradeRegisteredProblem(item: ProblemItem, answer: string | null | undefined): boolean | null {
  if (answer === null || answer === undefined || answer.trim() === '') return null;

  const hasChoices = (item.문제_보기?.length ?? 0) > 0;
  const reason = getManualReviewReason({
    instruction: item.instruction,
    correctAnswer: item.correct_answer,
    userAnswer: answer,
    hasChoices,
    answerFormat: item.answerFormat,
    correctAnswers: item.correctAnswers,
    userAnswers: item.userAnswers,
  });
  if (reason !== null) return null;

  const correct = item.correct_answer;
  if (correct === null || correct === undefined || String(correct).trim() === '') return null;
  const correctStr = String(correct).trim();

  // OX형(정답이 O/X/true/false 계열일 때만 — 숫자 정답 '1'/'0'을 OX로 오인하지 않도록)
  if (!hasChoices) {
    const cu = correctStr.toUpperCase();
    if (['O', '○', 'X', '×', 'TRUE', 'FALSE', '참', '거짓'].includes(cu)) {
      const oxUser = normalizeOX(answer);
      if (oxUser === null) return null;
      return oxUser === normalizeOX(correctStr);
    }
  }

  // 객관식: 정답·답안 모두 단일 번호로 확신 추출되면 번호 비교
  if (hasChoices) {
    const cd = extractOptionDigits(correctStr);
    const ud = extractOptionDigits(answer);
    if (cd.size === 1 && ud.size === 1) {
      return Array.from(cd)[0] === Array.from(ud)[0];
    }
  }

  const ua = normalizeForCompare(answer);
  const ca = normalizeForCompare(correctStr);
  if (!ua || !ca) return null;
  return ua === ca;
}
