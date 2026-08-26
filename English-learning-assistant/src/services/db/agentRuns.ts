// 에이전트 실행 기록(agent_runs) + 스텝 추적(agent_steps) 조회
//
// 쓰기 경로가 없는 건 의도다 — 기록은 GCF가 service-role로만 쓰고, 테이블에 INSERT 정책이
// 아예 없다. 프론트는 읽기만 한다(스텝 위조 차단).
import { supabase } from '../supabaseClient';

export type AgentType = 'consultant' | 'planner' | 'briefing' | 'inspector';
export type AgentRunStatus = 'running' | 'completed' | 'failed';

/** 'final' 외의 값은 "답은 냈지만 정상 종료는 아니다" — UI가 경고를 띄우는 근거. */
export type AgentStopReason = 'final' | 'max_steps' | 'budget' | 'tool_errors' | 'loop_detected';

export interface AgentStepRow {
  id: string;
  run_id: string;
  seq: number;
  thought: string | null;
  tool: string | null;
  args: Record<string, unknown> | null;
  observation: unknown;
  ok: boolean;
  created_at: string;
}

export interface AgentRunRow {
  id: string;
  agent_type: string;
  status: AgentRunStatus;
  stop_reason: AgentStopReason | null;
  result: unknown;
  error: string | null;
  total_tokens: number;
  model_calls: number;
  started_at: string;
  completed_at: string | null;
}

const RUN_COLUMNS =
  'id, agent_type, status, stop_reason, result, error, total_tokens, model_calls, started_at, completed_at';

export async function fetchAgentRun(runId: string): Promise<AgentRunRow | null> {
  const { data, error } = await supabase
    .from('agent_runs')
    .select(RUN_COLUMNS)
    .eq('id', runId)
    .maybeSingle();

  if (error) throw error;
  return (data as AgentRunRow) ?? null;
}

export async function fetchAgentSteps(runId: string): Promise<AgentStepRow[]> {
  const { data, error } = await supabase
    .from('agent_steps')
    .select('id, run_id, seq, thought, tool, args, observation, ok, created_at')
    .eq('run_id', runId)
    .order('seq', { ascending: true });

  if (error) throw error;
  return (data as AgentStepRow[]) || [];
}

/**
 * 에이전트 실행 시작. 즉시 runId만 받고 본 작업은 백그라운드에서 돈다
 * (generate-all과 동일한 fire-and-forget — 루프는 수십 초가 걸려 응답을 붙잡고 있을 수 없다).
 */
export async function startAgentRun(params: {
  agentType: AgentType;
  input: Record<string, unknown>;
  language: 'ko' | 'en';
}): Promise<string> {
  const functionUrl = import.meta.env.VITE_ANALYZE_GCF_URL;
  if (!functionUrl) {
    throw new Error(params.language === 'ko'
      ? 'VITE_ANALYZE_GCF_URL 환경변수가 설정되지 않았습니다.'
      : 'VITE_ANALYZE_GCF_URL environment variable is not set.');
  }

  const { data: { session } } = await supabase.auth.getSession();
  const response = await fetch(functionUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session?.access_token}`,
    },
    body: JSON.stringify({ mode: 'agent', agentType: params.agentType, input: params.input }),
  });

  if (!response.ok) {
    const text = await response.text();
    let parsed: { error?: string };
    try { parsed = JSON.parse(text); } catch { parsed = { error: text }; }
    throw new Error(parsed.error || `HTTP ${response.status}`);
  }

  const result = await response.json();
  if (!result?.runId) {
    throw new Error(params.language === 'ko' ? '에이전트 실행 ID를 받지 못했습니다.' : 'No agent run id returned.');
  }
  return result.runId as string;
}
