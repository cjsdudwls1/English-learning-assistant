import type { ProblemItem } from '../types';
import { normalizeMark } from '../services/marks';
import { toCardinality } from './answerShape';

type AnswerFields = Pick<
  ProblemItem,
  'answerFormat' | 'correctAnswers' | 'userAnswers' | 'blankCorrectAnswers' | 'blankUserAnswers'
>;

/**
 * content JSONB에서 답 관련 필드를 뽑는다(두 변환 함수가 공유 — 규칙이 갈라지지 않게).
 *
 * 값의 모양(cardinality)으로 갈라 담는 이유: correct_answers/user_answers는 같은 키인데
 * set이면 number[](선택지 번호), list면 (string|null)[](빈칸별 자유서술)이라 타입이 다르다.
 * 섞이면 자동채점이 오작동하므로 MC 번호배열과 빈칸 배열을 전용 필드로 분리한다.
 * 모르는 형식(판정 불가)이면 어느 쪽에도 넣지 않는다 — 해석할 수 없는 배열을 채점 가능한
 * 필드에 넣으면 confident-wrong의 재료가 된다.
 */
function pickAnswerFields(content: any): AnswerFields {
  const answerFormat = content?.answer_format ?? undefined;
  const card = toCardinality(answerFormat);
  const correct = Array.isArray(content?.correct_answers) ? content.correct_answers : undefined;
  const user = Array.isArray(content?.user_answers) ? content.user_answers : undefined;
  const isList = card === 'list';
  const gradable = card !== null && !isList; // one | set — MC 번호배열로 해석해도 되는 경우
  return {
    answerFormat,
    correctAnswers: gradable ? correct : undefined,
    userAnswers: gradable ? user : undefined,
    blankCorrectAnswers: isList ? correct : undefined,
    blankUserAnswers: isList ? user : undefined,
  };
}

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
    ...pickAnswerFields(p.content),
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
    ...pickAnswerFields(row.problems.content),
  };
}

