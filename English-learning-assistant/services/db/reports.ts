import { supabase } from '../supabaseClient';
import { getCurrentUserId } from './auth';

// 문제 단위 AI 리포트 저장
export async function saveProblemReport(problemId: string, reportText: string): Promise<void> {
  const userId = await getCurrentUserId();

  // 소유권 검증: problem -> session -> user_id
  const { data: ownership, error: ownershipError } = await supabase
    .from('problems')
    .select(`sessions!inner(user_id)`) 
    .eq('id', problemId)
    .single();

  if (ownershipError) throw ownershipError;
  const ownershipSessions: any = (ownership as any)?.sessions;
  const ownershipSessionUserId = Array.isArray(ownershipSessions)
    ? ownershipSessions[0]?.user_id
    : ownershipSessions?.user_id;
  if (!ownership || ownershipSessionUserId !== userId) {
    throw new Error('이 문제에 대한 접근 권한이 없습니다.');
  }

  const { error } = await supabase
    .from('labels')
    .update({ ai_report: reportText })
    .eq('problem_id', problemId);

  if (error) throw error;
}

// 문제 단위 AI 리포트 조회
export async function fetchProblemReport(problemId: string): Promise<string | null> {
  const userId = await getCurrentUserId();

  // 소유권 검증
  const { data: problemRow, error: problemError } = await supabase
    .from('problems')
    .select(`id, sessions!inner(user_id)`) 
    .eq('id', problemId)
    .single();

  if (problemError) throw problemError;
  const problemSessions: any = (problemRow as any)?.sessions;
  const problemSessionUserId = Array.isArray(problemSessions)
    ? problemSessions[0]?.user_id
    : problemSessions?.user_id;
  if (!problemRow || problemSessionUserId !== userId) {
    throw new Error('이 문제에 대한 접근 권한이 없습니다.');
  }

  const { data, error } = await supabase
    .from('labels')
    .select('ai_report')
    .eq('problem_id', problemId)
    .single();

  if (error) throw error;
  return data?.ai_report ?? null;
}

