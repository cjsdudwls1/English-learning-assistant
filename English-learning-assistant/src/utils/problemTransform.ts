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
  };
}

/**
 * labels 조인 결과에서 ProblemItem 변환 (fetchProblemsByIds용)
 */
export function transformFromLabelJoin(row: any): ProblemItem {
  const classification = row.classification || {};
  return {
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
  };
}

