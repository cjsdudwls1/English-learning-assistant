import { supabase } from '../supabaseClient';
import { getCurrentUserId } from './auth';

// 등록 문제(problems) 재풀이 이력 — problem_solving_sessions는 generated_problems FK +
// UNIQUE(user_id, problem_id) 제약이라 등록 문제의 다회 시도 기록에 쓸 수 없어 별도 테이블 사용.

export interface RetryAttempt {
  id: string;
  problem_id: string;
  answer: string | null;
  is_correct: boolean | null;
  attempted_at: string;
}

export interface RetryAttemptInput {
  problemId: string;
  answer: string;
  isCorrect: boolean | null;
}

const ID_CHUNK = 100;

export async function saveRetryAttempts(attempts: RetryAttemptInput[]): Promise<void> {
  if (attempts.length === 0) return;
  const userId = await getCurrentUserId();
  const now = new Date().toISOString();
  const rows = attempts.map((a) => ({
    user_id: userId,
    problem_id: a.problemId,
    answer: a.answer,
    is_correct: a.isCorrect,
    attempted_at: now,
  }));
  const { error } = await supabase.from('retry_attempts').insert(rows);
  if (error) throw error;
}

/** 본인의 시도 이력을 problem_id별로 최신순 그룹핑하여 반환 */
export async function fetchRetryAttempts(problemIds: string[]): Promise<Record<string, RetryAttempt[]>> {
  if (problemIds.length === 0) return {};
  const userId = await getCurrentUserId();
  const rows: RetryAttempt[] = [];
  for (let i = 0; i < problemIds.length; i += ID_CHUNK) {
    const chunk = problemIds.slice(i, i + ID_CHUNK);
    const { data, error } = await supabase
      .from('retry_attempts')
      .select('id, problem_id, answer, is_correct, attempted_at')
      .eq('user_id', userId)
      .in('problem_id', chunk)
      .order('attempted_at', { ascending: false });
    if (error) throw error;
    rows.push(...((data || []) as RetryAttempt[]));
  }
  const map: Record<string, RetryAttempt[]> = {};
  for (const r of rows) {
    (map[r.problem_id] = map[r.problem_id] || []).push(r);
  }
  return map;
}
