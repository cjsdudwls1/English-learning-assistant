import { supabase } from '../supabaseClient';
import { getCurrentUserId } from './auth';

/**
 * 문제 풀이 시간 추적 시작
 */
export async function startProblemSolving(problemId: string): Promise<string> {
  const userId = await getCurrentUserId();
  
  const { data, error } = await supabase
    .from('problem_solving_sessions')
    .insert({
      user_id: userId,
      problem_id: problemId,
      started_at: new Date().toISOString(),
    })
    .select('id')
    .single();
  
  if (error) throw error;
  
  return data.id;
}

/**
 * 문제 풀이 완료 및 시간 저장
 */
export async function completeProblemSolving(
  problemId: string,
  isCorrect: boolean,
  timeSpentSeconds: number
): Promise<void> {
  const userId = await getCurrentUserId();
  
  const { error } = await supabase
    .from('problem_solving_sessions')
    .update({
      completed_at: new Date().toISOString(),
      time_spent_seconds: timeSpentSeconds,
      is_correct: isCorrect,
    })
    .eq('user_id', userId)
    .eq('problem_id', problemId);
  
  if (error) throw error;
}

/**
 * 문제 풀이 세션 조회 (기존 세션이 있으면 반환)
 */
export async function getProblemSolvingSession(problemId: string): Promise<{ id: string; started_at: string } | null> {
  const userId = await getCurrentUserId();
  
  const { data, error } = await supabase
    .from('problem_solving_sessions')
    .select('id, started_at')
    .eq('user_id', userId)
    .eq('problem_id', problemId)
    .is('completed_at', null)
    .single();
  
  if (error) {
    if (error.code === 'PGRST116') {
      return null;
    }
    throw error;
  }
  
  return data;
}

