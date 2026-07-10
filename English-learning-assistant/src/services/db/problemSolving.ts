import { supabase } from '../supabaseClient';
import { getCurrentUserId } from './auth';

/**
 * 문제 풀이 시간 추적 시작
 */
export async function startProblemSolving(problemId: string): Promise<string> {
  const userId = await getCurrentUserId();

  const { data, error } = await supabase
    .from('problem_solving_sessions')
    .upsert({
      user_id: userId,
      problem_id: problemId,
      started_at: new Date().toISOString(),
    }, {
      onConflict: 'user_id,problem_id',
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
  const completedAt = new Date();

  const { data, error } = await supabase
    .from('problem_solving_sessions')
    .update({
      completed_at: completedAt.toISOString(),
      time_spent_seconds: timeSpentSeconds,
      is_correct: isCorrect,
    })
    .eq('user_id', userId)
    .eq('problem_id', problemId)
    .select('id');

  if (error) throw error;
  if (data && data.length > 0) return;

  // startProblemSolving이 실패해 세션 행이 없으면 update가 0행 매치로 조용히 성공해
  // 풀이 결과가 유실된다 — 완료 시점 기준으로 행을 생성해 기록을 보존한다.
  const { error: upsertError } = await supabase
    .from('problem_solving_sessions')
    .upsert({
      user_id: userId,
      problem_id: problemId,
      started_at: new Date(completedAt.getTime() - timeSpentSeconds * 1000).toISOString(),
      completed_at: completedAt.toISOString(),
      time_spent_seconds: timeSpentSeconds,
      is_correct: isCorrect,
    }, { onConflict: 'user_id,problem_id' });

  if (upsertError) throw upsertError;
}

export interface GeneratedProblemResult {
  problemId: string;
  isCorrect: boolean | null; // null = 자동 채점 불가(서술형 등)
  timeSpentSeconds: number;
}

/**
 * 시험지(TestSheetView) 제출 결과 배치 저장.
 * UNIQUE(user_id, problem_id) 제약이라 같은 문제 재제출 시 최신 결과로 덮어쓴다.
 */
export async function saveGeneratedProblemResults(
  results: GeneratedProblemResult[],
  startedAt?: string
): Promise<void> {
  if (results.length === 0) return;
  const userId = await getCurrentUserId();
  const now = new Date().toISOString();

  const rows = results.map((r) => ({
    user_id: userId,
    problem_id: r.problemId,
    started_at: startedAt ?? now,
    completed_at: now,
    time_spent_seconds: r.timeSpentSeconds,
    is_correct: r.isCorrect,
  }));

  const { error } = await supabase
    .from('problem_solving_sessions')
    .upsert(rows, { onConflict: 'user_id,problem_id' });

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

