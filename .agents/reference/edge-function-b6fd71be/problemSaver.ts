// problemSaver.ts — 문제 DB 저장 모듈
// 분석 결과를 content JSONB 구조로 변환하여 problems 테이블에 INSERT

import { StageError, summarizeError, markSessionFailed } from '../../_shared/errors.ts';

// ─── 타입 정의 ─────────────────────────────────────────────

export interface SaveProblemsParams {
  supabase: any;
  sessionId: string;
  items: any[];
}

export interface SaveProblemsResult {
  problems: Array<{ id: string; index_in_image: number }>;
  problemsPayload: any[];
}

// ─── choices 정규화 ────────────────────────────────────────

function normalizeChoices(choices: any[]): Array<{ label?: string; text: string }> {
  return (choices || []).map((c: any) => {
    if (typeof c === 'string') {
      return { text: c };
    }
    // 새 구조: { label: "①", text: "..." }
    if (c.label && c.text) {
      return { label: c.label, text: c.text };
    }
    return { text: c.text || String(c) };
  });
}

// ─── stem 텍스트 생성 ──────────────────────────────────────

function buildStemFromItem(item: any): string {
  // 기존 question_text가 있으면 그것을 사용 (하위 호환성)
  let stemText = item.question_text || '';
  if (!stemText && item.instruction) {
    // 새로운 구조: instruction을 기본으로 하고, passage가 있으면 앞에 추가
    const passageText = item._resolved_passage || item.passage || '';
    const questionBody = item.question_body || '';
    stemText = [
      passageText ? `[지문]\n${passageText}` : '',
      item.visual_context ? `[${item.visual_context.type || '자료'}] ${item.visual_context.title || ''}\n${item.visual_context.content || ''}` : '',
      `[문제] ${item.instruction}`,
      questionBody ? `\n${questionBody}` : ''
    ].filter(Boolean).join('\n\n');
  }
  return stemText;
}

// ─── content JSONB 구조 생성 ───────────────────────────────

function buildContentJson(item: any, normalizedChoices: any[]): Record<string, any> {
  return {
    stem: buildStemFromItem(item),
    problem_number: item.problem_number || null,
    shared_passage_ref: item.shared_passage_ref || null,
    passage: item._resolved_passage || item.passage || null,
    visual_context: item.visual_context || null,
    instruction: item.instruction || null,
    question_body: item.question_body || null,
    choices: normalizedChoices,
    user_answer: item.user_answer || null,
    user_marked_correctness: item.user_marked_correctness || null,
    correct_answer: item.correct_answer || null,
  };
}

// ─── 메인 함수: 문제 DB 저장 ───────────────────────────────

/**
 * 분석 결과 아이템들을 content JSONB 구조로 변환하여 problems 테이블에 저장한다.
 *
 * - choices 정규화 (문자열/객체 배열 모두 지원)
 * - stem 텍스트 생성 (instruction + passage + question_body 조합)
 * - content JSONB 구조 생성
 * - problems INSERT + 0문항 실패 처리
 *
 * @returns 저장 성공 시 problems 배열과 payload, 0문항이면 null
 */
export async function saveProblems(params: SaveProblemsParams): Promise<SaveProblemsResult | null> {
  const { supabase, sessionId, items } = params;

  console.log(`[Background] Step 4: Save problems to database...`, { sessionId, itemCount: items.length });

  // 여러 이미지에서 온 문제들이 중복된 index를 가질 수 있으므로,
  // 배열 인덱스를 사용하여 고유한 index_in_image 보장
  const problemsPayload = items.map((it: any, idx: number) => {
    const normalizedChoices = normalizeChoices(it.choices);
    const contentJson = buildContentJson(it, normalizedChoices);

    return {
      session_id: sessionId,
      index_in_image: idx, // 항상 배열 인덱스 사용 (0부터 순차적으로 증가)
      content: contentJson,
      problem_metadata: it.metadata || {
        difficulty: '중',
        word_difficulty: 5,
        problem_type: '분석 대기',
        analysis: '분석 정보 없음'
      }
    };
  });

  const { data: problems, error: problemsError } = await supabase
    .from('problems')
    .insert(problemsPayload)
    .select('id, index_in_image');

  if (problemsError) {
    console.error(`[Background] Step 4 error: Problems insert error`, { sessionId, error: problemsError, problemsPayloadCount: problemsPayload.length });
    throw new StageError('insert_problems', 'Problems insert failed', { problemsPayloadCount: problemsPayload.length, error: summarizeError(problemsError) });
  }

  console.log(`[Background] Step 4 completed: Inserted ${problems?.length || 0} problems`, { sessionId });

  if (!problems || problems.length === 0) {
    console.error(`[Background] Step 4 produced 0 problems. Marking session as failed.`, { sessionId });
    await markSessionFailed({
      supabase,
      sessionId,
      stage: 'insert_problems',
      error: new Error('Inserted 0 problems'),
      extra: { problemsPayloadCount: problemsPayload.length },
    });
    return null;
  }

  return { problems, problemsPayload };
}
