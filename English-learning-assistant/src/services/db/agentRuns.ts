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
 * 에이전트 요청 실패.
 *
 * definitive를 나누는 이유: 서버가 4xx/5xx로 **명시적으로 거절**한 것과, fetch가 끊긴 것은
 * 전혀 다르다. 후자는 서버가 멀쩡히 루프를 계속 돌고 있을 수 있어(응답만 못 받은 것) 여기서
 * 실패로 확정하면 이미 과금된 결과를 버리게 된다. 그 판단은 Realtime/폴링에 맡긴다.
 */
export class AgentRequestError extends Error {
  readonly definitive: boolean;
  constructor(message: string, definitive: boolean) {
    super(message);
    this.name = 'AgentRequestError';
    this.definitive = definitive;
  }
}

/**
 * 에이전트 실행 요청.
 *
 * 응답은 **루프가 다 끝난 뒤**에 온다(수십 초~수 분). fire-and-forget이 아닌 이유는
 * cloud-functions/analyze-image/index.js의 handleAgentRun 주석 참고 — 요약하면 publisher가
 * cpu-throttling 상태라 응답을 flush한 뒤의 백그라운드 작업에 CPU가 안 붙는다.
 *
 * 그래서 runId는 **호출자가 만들어 넘긴다.** 그래야 이 fetch를 기다리는 동안에도 그 id로
 * agent_steps를 구독해 진행 상황을 볼 수 있다.
 */
export async function startAgentRun(params: {
  runId: string;
  agentType: AgentType;
  input: Record<string, unknown>;
  language: 'ko' | 'en';
}): Promise<void> {
  const functionUrl = import.meta.env.VITE_ANALYZE_GCF_URL;
  if (!functionUrl) {
    throw new AgentRequestError(params.language === 'ko'
      ? 'VITE_ANALYZE_GCF_URL 환경변수가 설정되지 않았습니다.'
      : 'VITE_ANALYZE_GCF_URL environment variable is not set.', true);
  }

  const { data: { session } } = await supabase.auth.getSession();

  let response: Response;
  try {
    response = await fetch(functionUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session?.access_token}`,
      },
      body: JSON.stringify({
        mode: 'agent',
        runId: params.runId,
        agentType: params.agentType,
        input: params.input,
      }),
    });
  } catch (networkError) {
    // 네트워크 단절·프록시 idle 컷. 서버는 계속 돌고 있을 수 있다.
    throw new AgentRequestError((networkError as Error)?.message ?? 'network error', false);
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    let parsed: { error?: string };
    try { parsed = JSON.parse(text); } catch { parsed = { error: text }; }
    // 409 = 같은 runId가 이미 도는 중. 새로 시작할 건 없지만 그 런은 살아있다.
    throw new AgentRequestError(parsed.error || `HTTP ${response.status}`, response.status !== 409);
  }
}
