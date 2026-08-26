// 학습 컨설팅 보고서 히스토리(consulting_reports) 저장/조회/삭제
import { supabase } from '../supabaseClient';
import { getCurrentUserId } from './auth';

export interface ConsultingReportRow {
  id: string;
  created_at: string;
  scope_label: string | null;
  language: string;
  report: string;
  stats: { total: number; correct: number; incorrect: number } | null;
}

// 저장(생성 직후 호출). 실패해도 throw는 하되 호출측에서 swallow.
export async function saveConsultingReport(input: {
  scopeLabel: string | null;
  language: 'ko' | 'en';
  report: string;
  stats: { total: number; correct: number; incorrect: number };
  /** 에이전트로 만든 보고서면 그 실행 id — 나중에 근거(스텝)를 되짚을 수 있다. */
  agentRunId?: string | null;
}): Promise<void> {
  const userId = await getCurrentUserId();

  // agent_run_id는 있을 때만 넣는다. 폴백(단발 Edge) 경로가 컬럼 존재 여부에 묶이면 안 된다.
  const row: Record<string, unknown> = {
    user_id: userId,
    scope_label: input.scopeLabel,
    language: input.language,
    report: input.report,
    stats: input.stats,
  };
  if (input.agentRunId) row.agent_run_id = input.agentRunId;

  const { error } = await supabase.from('consulting_reports').insert(row);

  if (error) throw error;
}

// 본인 기록 목록(최신순). RLS가 본인 것만 반환.
export async function fetchConsultingReports(limit?: number): Promise<ConsultingReportRow[]> {
  const { data, error } = await supabase
    .from('consulting_reports')
    .select('id, created_at, scope_label, language, report, stats')
    .order('created_at', { ascending: false })
    .limit(limit ?? 50);

  if (error) throw error;
  return data || [];
}

// 단건 삭제
export async function deleteConsultingReport(id: string): Promise<void> {
  const { error } = await supabase
    .from('consulting_reports')
    .delete()
    .eq('id', id);

  if (error) throw error;
}
