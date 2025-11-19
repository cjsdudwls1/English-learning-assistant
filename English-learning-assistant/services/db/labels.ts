import { supabase } from '../supabaseClient';
import { getCurrentUserId } from './auth';
import { isCorrectFromMark, normalizeMark } from '../marks';

// 간단한 라벨링 업데이트 (정답/오답만)
export async function quickUpdateLabels(sessionId: string, problemId: string, mark: '정답' | '오답'): Promise<void> {
  const userId = await getCurrentUserId();
  
  // 세션 소유권 검증
  const { data: session, error: sessionError } = await supabase
    .from('sessions')
    .select('user_id')
    .eq('id', sessionId)
    .single();
  
  if (sessionError) throw sessionError;
  if (session.user_id !== userId) {
    throw new Error('이 세션에 접근할 권한이 없습니다.');
  }
  
  // labels 테이블 업데이트
  const normalizedMark = normalizeMark(mark);
  const isCorrect = isCorrectFromMark(normalizedMark);
  
  const { error: labelUpdateError } = await supabase
    .from('labels')
    .update({
      user_mark: normalizedMark,
      is_correct: isCorrect,
    })
    .eq('problem_id', problemId);
  
  if (labelUpdateError) throw labelUpdateError;
}

