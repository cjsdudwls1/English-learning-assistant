import { supabase } from '../supabaseClient';
import { getCurrentUserId } from './auth';

// 단일 문제 소유권 검증 (problem → session → user_id 단계별)
async function assertProblemOwnership(problemId: string, userId: string): Promise<void> {
  const { data: problem, error: pErr } = await supabase
    .from('problems')
    .select('session_id')
    .eq('id', problemId)
    .single();
  if (pErr) throw pErr;
  if (!problem) throw new Error('이 문제에 대한 접근 권한이 없습니다.');

  const { data: session, error: sErr } = await supabase
    .from('sessions')
    .select('user_id')
    .eq('id', problem.session_id)
    .single();
  if (sErr) throw sErr;
  if (!session || session.user_id !== userId) {
    throw new Error('이 문제에 대한 접근 권한이 없습니다.');
  }
}

// 문제 단위 AI 리포트 저장
export async function saveProblemReport(problemId: string, reportText: string): Promise<void> {
  const userId = await getCurrentUserId();
  await assertProblemOwnership(problemId, userId);

  const { error } = await supabase
    .from('labels')
    .update({ ai_report: reportText })
    .eq('problem_id', problemId);

  if (error) throw error;
}

// 문제 단위 AI 리포트 조회
export async function fetchProblemReport(problemId: string): Promise<string | null> {
  const userId = await getCurrentUserId();
  await assertProblemOwnership(problemId, userId);

  const { data, error } = await supabase
    .from('labels')
    .select('ai_report')
    .eq('problem_id', problemId)
    .single();

  if (error) throw error;
  return data?.ai_report ?? null;
}
