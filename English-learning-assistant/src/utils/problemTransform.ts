import type { ProblemItem } from '../types';
import { normalizeMark } from '../services/marks';

/**
 * DB에서 가져온 문제 데이터를 ProblemItem 형식으로 변환
 */
export function transformToProblemItem(
  p: any,
  label: any = {}
): ProblemItem {
  const classification = label.classification || {};

  // 사용자가 직접 채점한 결과 (user_mark): 사용자가 검수 안 했으면 null
  const userMark = label.user_mark != null
    ? normalizeMark(label.user_mark)
    : null;

  // AI 자동 채점 (is_correct): user_answer vs correct_answer 비교 결과
  const aiJudgment = label.is_correct != null
    ? (label.is_correct ? '정답' : '오답')
    : undefined;

  return {
    id: p.id,
    index: p.index_in_image,
    사용자가_직접_채점한_정오답: userMark,
    AI가_판단한_정오답: aiJudgment,
    문제내용: {
      text: p.content?.stem || p.stem || '',
    },
    문제_보기: (p.content?.choices || p.choices || []).map((c: any) => ({
      text: c.text || '',
    })),
    사용자가_기술한_정답: {
      text: label.user_answer || '',
      auto_corrected: false,
      alternate_interpretations: [],
    },
    correct_answer: label.correct_answer || null,
    question_type: (p.question_type || p.content?.question_type || undefined) as any,
    문제_유형_분류: {
      depth1: classification.depth1 || '',
      depth2: classification.depth2 || '',
      depth3: classification.depth3 || '',
      depth4: classification.depth4 || '',
      code: classification.code ?? null,
      CEFR: classification.CEFR ?? null,
      난이도: classification['난이도'] ?? null,
    },
    분류_근거: '',
    passage: p.content?.passage ?? null,
    instruction: p.content?.instruction ?? null,
    question_body: p.content?.question_body ?? null,
    visual_context: p.content?.visual_context ?? null,
    // 다중정답 객관식(multi_answer_contract v1) — content에 없으면 undefined(레거시=단일 취급)
    // multi_blank는 correct_answers/user_answers가 문자열 배열(빈칸별)이므로 MC 번호배열 필드에 넣지 않고
    // 전용 blank* 필드로 분리(타입 충돌 방지 + 자동채점 오작동 방지).
    answerFormat: p.content?.answer_format ?? undefined,
    correctAnswers: (p.content?.answer_format !== 'multi_blank' && Array.isArray(p.content?.correct_answers)) ? p.content.correct_answers : undefined,
    userAnswers: (p.content?.answer_format !== 'multi_blank' && Array.isArray(p.content?.user_answers)) ? p.content.user_answers : undefined,
    blankCorrectAnswers: (p.content?.answer_format === 'multi_blank' && Array.isArray(p.content?.correct_answers)) ? p.content.correct_answers : undefined,
    blankUserAnswers: (p.content?.answer_format === 'multi_blank' && Array.isArray(p.content?.user_answers)) ? p.content.user_answers : undefined,
  };
}

/**
 * labels 조인 결과에서 ProblemItem 변환 (fetchProblemsByIds용)
 */
export function transformFromLabelJoin(row: any): ProblemItem {
  const classification = row.classification || {};
  return {
    id: row.problems.id,
    index: row.problems.index_in_image,
    사용자가_직접_채점한_정오답: normalizeMark(row.user_mark),
    AI가_판단한_정오답: row.is_correct !== undefined && row.is_correct !== null
      ? (row.is_correct ? '정답' : '오답')
      : undefined,
    문제내용: {
      text: row.problems.content?.stem || row.problems.stem || '',
    },
    문제_보기: (row.problems.content?.choices || row.problems.choices || []).map((c: any) => ({
      text: c.text || '',
    })),
    사용자가_기술한_정답: {
      text: row.user_answer || '',
      auto_corrected: false,
      alternate_interpretations: [],
    },
    correct_answer: row.correct_answer || null,
    question_type: (row.problems.question_type || row.problems.content?.question_type || undefined) as any,
    문제_유형_분류: {
      depth1: classification.depth1 || '',
      depth2: classification.depth2 || '',
      depth3: classification.depth3 || '',
      depth4: classification.depth4 || '',
      code: classification.code ?? null,
      CEFR: classification.CEFR ?? null,
      난이도: classification['난이도'] ?? null,
    },
    분류_근거: '',
    passage: row.problems.content?.passage ?? null,
    instruction: row.problems.content?.instruction ?? null,
    question_body: row.problems.content?.question_body ?? null,
    visual_context: row.problems.content?.visual_context ?? null,
    // 다중정답 객관식(multi_answer_contract v1) — content에 없으면 undefined(레거시=단일 취급)
    // multi_blank는 문자열 배열 → 전용 blank* 필드로 분리(위 transformFromContent와 동일 규칙).
    answerFormat: row.problems.content?.answer_format ?? undefined,
    correctAnswers: (row.problems.content?.answer_format !== 'multi_blank' && Array.isArray(row.problems.content?.correct_answers)) ? row.problems.content.correct_answers : undefined,
    userAnswers: (row.problems.content?.answer_format !== 'multi_blank' && Array.isArray(row.problems.content?.user_answers)) ? row.problems.content.user_answers : undefined,
    blankCorrectAnswers: (row.problems.content?.answer_format === 'multi_blank' && Array.isArray(row.problems.content?.correct_answers)) ? row.problems.content.correct_answers : undefined,
    blankUserAnswers: (row.problems.content?.answer_format === 'multi_blank' && Array.isArray(row.problems.content?.user_answers)) ? row.problems.content.user_answers : undefined,
  };
}

