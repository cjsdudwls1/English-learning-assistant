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
  
  // user_mark가 null이면 AI 분석 결과(is_correct)를 기본값으로 사용
  const userMark = label.user_mark !== null && label.user_mark !== undefined
    ? normalizeMark(label.user_mark)
    : (label.is_correct ? 'O' : 'X'); // AI 분석 결과를 기본값으로
  
  return {
    index: p.index_in_image,
    사용자가_직접_채점한_정오답: userMark,
    AI가_판단한_정오답: label.is_correct !== undefined && label.is_correct !== null
      ? (label.is_correct ? '정답' : '오답')
      : undefined,
    문제내용: {
      text: p.stem || '',
    },
    문제_보기: (p.choices || []).map((c: any) => ({
      text: c.text || '',
    })),
    사용자가_기술한_정답: {
      text: label.user_answer || '',
      auto_corrected: false,
      alternate_interpretations: [],
    },
    문제_유형_분류: {
      '1Depth': classification['1Depth'] || '',
      '2Depth': classification['2Depth'] || '',
      '3Depth': classification['3Depth'] || '',
      '4Depth': classification['4Depth'] || '',
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
      text: row.problems.stem || '',
    },
    문제_보기: (row.problems.choices || []).map((c: any) => ({
      text: c.text || '',
    })),
    사용자가_기술한_정답: {
      text: row.user_answer || '',
      auto_corrected: false,
      alternate_interpretations: [],
    },
    문제_유형_분류: {
      '1Depth': classification['1Depth'] || '',
      '2Depth': classification['2Depth'] || '',
      '3Depth': classification['3Depth'] || '',
      '4Depth': classification['4Depth'] || '',
    },
    분류_근거: '',
  };
}

