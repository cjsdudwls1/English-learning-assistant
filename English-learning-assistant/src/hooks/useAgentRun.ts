/**
 * 에이전트 실행 구독 훅 (4종 에이전트 공용)
 *
 * 에이전트는 수십 초~수 분 동안 돈다. 그동안 스피너만 돌리면 사용자는 멈춘 줄 안다.
 * 그래서 실행 상태가 아니라 **스텝**을 실시간으로 흘린다 — "무엇을 왜 조회하는 중인지"가
 * 곧 진행률이다.
 *
 * 전달 경로는 useProblemGeneration에서 검증된 3중 구조를 그대로 쓴다:
 *   Realtime 구독 → 10초 안에 아무것도 안 오면 폴링 폴백(2초) → 최종 타임아웃
 * Realtime은 네트워크/프록시 환경에 따라 조용히 죽는다. 폴백이 없으면 그 사용자에게는
 * 기능 자체가 없는 것과 같다.
 *
 * ── runId를 여기서 만든다 ────────────────────────────────────────────
 * 서버(GCF publisher)가 cpu-throttling이라 응답을 flush한 뒤엔 CPU가 안 붙는다. 그래서 루프가
 * **요청 안에서** 끝나고, POST는 다 끝난 뒤에야 돌아온다. 서버가 id를 정해 응답에 실어주면
 * 구독을 걸 시점엔 이미 런이 끝나 있어 트레이스가 통째로 사라진다.
 * → id를 먼저 만들고 · 구독을 먼저 걸고 · POST는 그 다음에 쏜다.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../services/supabaseClient';
import {
  AgentRequestError,
  fetchAgentRun,
  fetchAgentSteps,
  startAgentRun,
  type AgentRunRow,
  type AgentStepRow,
  type AgentStopReason,
  type AgentType,
} from '../services/db';

const POLL_FALLBACK_DELAY_MS = 10_000;
const POLL_INTERVAL_MS = 2_000;
// 서버 요청 상한이 300s(deploy-image.ps1 --timeout)라, 그 이상 'running'이면 인스턴스가 죽은 것이다.
// 콜드스타트·큐 대기 여유를 얹어 6분.
const FINAL_TIMEOUT_MS = 6 * 60 * 1000;

export type AgentRunState = 'idle' | 'running' | 'completed' | 'failed';

interface UseAgentRunOptions {
  language: 'ko' | 'en';
}

/** start()가 돌려주는 것. runId는 결과물(보고서 등)에 근거를 연결할 때 필요하다. */
export interface AgentRunOutcome<TResult> {
  result: TResult;
  runId: string;
  stopReason: AgentStopReason | null;
}

export interface UseAgentRunReturn<TResult> {
  state: AgentRunState;
  runId: string | null;
  steps: AgentStepRow[];
  result: TResult | null;
  /** 'final' 외의 값이면 조기 중단된 결과다 — 화면에 그 사실을 알려야 한다. */
  stopReason: AgentStopReason | null;
  error: string | null;
  start: (agentType: AgentType, input: Record<string, unknown>) => Promise<AgentRunOutcome<TResult>>;
  reset: () => void;
}

export function useAgentRun<TResult = unknown>({ language }: UseAgentRunOptions): UseAgentRunReturn<TResult> {
  const [state, setState] = useState<AgentRunState>('idle');
  const [runId, setRunId] = useState<string | null>(null);
  const [steps, setSteps] = useState<AgentStepRow[]>([]);
  const [result, setResult] = useState<TResult | null>(null);
  const [stopReason, setStopReason] = useState<AgentStopReason | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 정리 대상들. 언마운트·완료·실패 어느 쪽으로 끝나도 전부 해제되어야 한다.
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const fallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const finalTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const settledRef = useRef(false);

  const cleanup = useCallback(() => {
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }
    if (pollTimerRef.current) { clearInterval(pollTimerRef.current); pollTimerRef.current = null; }
    if (fallbackTimerRef.current) { clearTimeout(fallbackTimerRef.current); fallbackTimerRef.current = null; }
    if (finalTimerRef.current) { clearTimeout(finalTimerRef.current); finalTimerRef.current = null; }
  }, []);

  useEffect(() => cleanup, [cleanup]);

  const reset = useCallback(() => {
    cleanup();
    settledRef.current = false;
    setState('idle');
    setRunId(null);
    setSteps([]);
    setResult(null);
    setStopReason(null);
    setError(null);
  }, [cleanup]);

  const start = useCallback(async (
    agentType: AgentType,
    input: Record<string, unknown>,
  ): Promise<AgentRunOutcome<TResult>> => {
    cleanup();
    settledRef.current = false;
    setSteps([]);
    setResult(null);
    setStopReason(null);
    setError(null);
    setState('running');

    const id = crypto.randomUUID();
    setRunId(id);

    return new Promise<AgentRunOutcome<TResult>>((resolve, reject) => {
      const settle = (fn: () => void) => {
        if (settledRef.current) return;
        settledRef.current = true;
        cleanup();
        fn();
      };

      const mergeSteps = (incoming: AgentStepRow[]) => {
        setSteps((prev) => {
          const bySeq = new Map(prev.map((s) => [s.seq, s]));
          for (const step of incoming) bySeq.set(step.seq, step);
          return [...bySeq.values()].sort((a, b) => a.seq - b.seq);
        });
      };

      const applyRun = (run: AgentRunRow | null) => {
        if (!run || run.status === 'running') return false;
        if (run.status === 'completed') {
          setStopReason(run.stop_reason);
          setResult(run.result as TResult);
          setState('completed');
          settle(() => resolve({ result: run.result as TResult, runId: id, stopReason: run.stop_reason }));
          return true;
        }
        const message = run.error || (language === 'ko' ? '에이전트 실행에 실패했습니다.' : 'The agent run failed.');
        setStopReason(run.stop_reason);
        setError(message);
        setState('failed');
        settle(() => reject(new Error(message)));
        return true;
      };

      // ── Realtime: 스텝 INSERT + 런 완료 UPDATE를 한 채널에서 받는다
      const channel = supabase
        .channel(`agent-run-${id}`)
        .on('postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'agent_steps', filter: `run_id=eq.${id}` },
          (payload) => mergeSteps([payload.new as AgentStepRow]))
        .on('postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'agent_runs', filter: `id=eq.${id}` },
          (payload) => applyRun(payload.new as AgentRunRow))
        .subscribe();
      channelRef.current = channel;

      // ── 폴링 폴백: Realtime이 조용하면 10초 뒤부터 직접 읽는다
      const poll = async () => {
        if (settledRef.current) return;
        try {
          const [runRow, stepRows] = await Promise.all([fetchAgentRun(id), fetchAgentSteps(id)]);
          mergeSteps(stepRows);
          applyRun(runRow);
        } catch (e) {
          console.error('[useAgentRun] 폴링 실패(무시):', e);
        }
      };

      fallbackTimerRef.current = setTimeout(() => {
        if (settledRef.current) return;
        void poll();
        pollTimerRef.current = setInterval(() => { void poll(); }, POLL_INTERVAL_MS);
      }, POLL_FALLBACK_DELAY_MS);

      // ── 최종 타임아웃: 인스턴스가 통째로 죽으면 run은 영원히 'running'이다
      finalTimerRef.current = setTimeout(() => {
        const message = language === 'ko'
          ? '에이전트 응답 시간이 초과되었습니다. 잠시 후 다시 시도해주세요.'
          : 'The agent timed out. Please try again in a moment.';
        setError(message);
        setState('failed');
        settle(() => reject(new Error(message)));
      }, FINAL_TIMEOUT_MS);

      // ── 요청 발사: 구독을 다 건 뒤다. 응답은 루프가 끝난 뒤에 온다(수십 초~수 분).
      void startAgentRun({ runId: id, agentType, input, language })
        .then(() => {
          // 여기 도달했으면 서버는 finishRun까지 마친 상태다. Realtime이 죽어 있고 폴링이 아직
          // 시작 전(10초)일 수 있으니 한 번 직접 읽어 완료를 앞당긴다.
          void poll();
        })
        .catch((e: unknown) => {
          const definitive = e instanceof AgentRequestError ? e.definitive : true;
          if (!definitive) {
            // fetch만 끊긴 것 — 서버는 계속 돌고 있을 수 있다. 여기서 실패로 확정하면 이미
            // 과금된 결과를 버린다. 판단은 Realtime/폴링/최종 타임아웃에 맡기고 폴링만 앞당긴다.
            console.warn('[useAgentRun] 요청 응답 유실(실행은 계속될 수 있음):', e);
            if (!pollTimerRef.current && !settledRef.current) {
              pollTimerRef.current = setInterval(() => { void poll(); }, POLL_INTERVAL_MS);
            }
            return;
          }
          const message = e instanceof Error ? e.message
            : (language === 'ko' ? '에이전트 실행에 실패했습니다.' : 'The agent run failed.');
          setError(message);
          setState('failed');
          settle(() => reject(new Error(message)));
        });
    });
  }, [cleanup, language]);

  return { state, runId, steps, result, stopReason, error, start, reset };
}
