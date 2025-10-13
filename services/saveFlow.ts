import { supabase } from './supabaseClient';
import { uploadProblemImage, createSession } from './db';
import type { ProblemItem } from '../types';
import { isCorrectFromMark, normalizeMark } from './marks';

export async function saveFinalLabels(imageFile: File, items: ProblemItem[]) {
  // 1) 이미지 Storage 업로드 (최종 저장 시점)
  const imageUrl = await uploadProblemImage(imageFile);
  
  // 2) 세션 생성
  const sessionId = await createSession(imageUrl);
  
  // 3) 문제 저장 (문항 텍스트/보기)
  const problemsPayload = items.map((it, idx) => ({
    session_id: sessionId,
    index_in_image: it.index ?? idx,
    stem: it.문제내용.text,
    choices: (it.문제_보기 ?? []).map(c => ({ text: c.text, confidence: c.confidence_score }))
  }));
  const { data: problems, error: problemsError } = await supabase.from('problems').insert(problemsPayload).select('id, index_in_image');
  if (problemsError) throw problemsError;

  // 4) 라벨 저장 (정오표시/정답/분류/신뢰도)
  const idByIndex = new Map<number, string>();
  for (const row of problems) idByIndex.set(row.index_in_image, row.id);

  const labelsPayload = items.map((it, idx) => ({
    problem_id: idByIndex.get(it.index ?? idx)!,
    user_answer: it.사용자가_기술한_정답.text,
    user_mark: normalizeMark(it.사용자가_직접_채점한_정오답),
    is_correct: isCorrectFromMark(it.사용자가_직접_채점한_정오답),
    classification: it.문제_유형_분류,
    confidence: {
      stem: it.문제내용.confidence_score,
      answer: it.사용자가_기술한_정답.confidence_score,
      choices: (it.문제_보기 ?? []).map(c => c.confidence_score)
    }
  }));
  const { error: labelsError } = await supabase.from('labels').insert(labelsPayload);
  if (labelsError) throw labelsError;
}


