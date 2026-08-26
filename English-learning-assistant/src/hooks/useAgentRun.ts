/**
 * 에이전트 실행 구독 훅 (4종 에이전트 공용)
 *
 * 에이전트는 수십 초~수 분 동안 돈다. 그동안 스피너만 돌리면 사용자는 멈춘 줄 안다.
 * 그래서 실행 상태가 아니라 **스텝**을 실시간으로 흘린다 — "무엇을 왜 조회하는 중인지"가
 * 곧 진행률이다.
 *
 * 전달 경로는 useProblemGeneration에서 검증된 3중 구조를 그대로 쓴다:
 *   Realtime 구독 → 10초 안에 아무것도 안 오면 폴링 폴백(2초) → 10분 최종 타임아웃
 * Realtime은 네트워크/프록시 환경에 따라 조용히 죽는다. 폴백이 없으면 그 사용자에게는
 * 기능 자체가 없는 것과 같다.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../services/supabaseClient';
import {
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
const FINAL_TIMEOUT_MS = 10 * 60 * 1000;

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

    const id = await startAgentRun({ agentType, input, language });
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

      // ── 최종 타임아웃: 백그라운드 인스턴스가 통째로 죽으면 run은 영원히 'running'이다
      finalTimerRef.current = setTimeout(() => {
        const message = language === 'ko'
          ? '에이전트 응답 시간이 초과되었습니다. 잠시 후 다시 시도해주세요.'
          : 'The agent timed out. Please try again in a moment.';
        setError(message);
        setState('failed');
        settle(() => reject(new Error(message)));
      }, FINAL_TIMEOUT_MS);
    });
  }, [cleanup, language]);

  return { state, runId, steps, result, stopReason, error, start, reset };
}
