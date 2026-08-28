/**
 * 에이전트 사고 과정 타임라인
 *
 * 단발 호출이면 스피너로 충분했다. 에이전트는 "무엇을 왜 조회하는 중인지"가 곧 진행률이라,
 * 그걸 안 보여주면 사용자에겐 그냥 더 오래 걸리는 기능이 된다.
 *
 * 표시 원칙:
 *   - 실패 스텝(ok=false)을 숨기지 않는다. 에이전트는 잘못 부르고 스스로 고치면서 진행하고,
 *     그 과정이 보여야 결과의 근거도 믿을 수 있다.
 *   - stop_reason이 'final'이 아니면 조기 중단이다. 결과는 주되 그 사실을 반드시 함께 띄운다.
 */
import { useEffect, useRef } from 'react';
import type { AgentStepRow, AgentStopReason } from '../../services/db';
import { getTranslation } from '../../utils/translations';

interface AgentTraceProps {
  language: 'ko' | 'en';
  steps: AgentStepRow[];
  state: 'idle' | 'running' | 'completed' | 'failed';
  stopReason?: AgentStopReason | null;
  error?: string | null;
}

/**
 * 스텝 → 사람이 읽는 라벨. 모르는 도구는 이름 그대로 보여준다(후속 에이전트가 추가될 자리).
 *
 * tool=null은 두 가지다 — 최종 보고서(ok)와 모델 응답 파싱 실패(!ok). 둘을 같은 라벨로 묶으면
 * 실패한 줄이 "보고서 작성"으로 보인다.
 */
function stepLabel(step: AgentStepRow, t: ReturnType<typeof getTranslation>): string {
  switch (step.tool) {
    case 'stats.drilldown': return t.stats.agentToolDrilldown;
    case 'samples.wrong': return t.stats.agentToolWrongSamples;
    case 'stats.timeseries': return t.stats.agentToolTimeseries;
    case 'profile.get': return t.stats.agentToolProfile;
    case null: return step.ok ? t.stats.agentToolFinal : t.stats.agentStepRetryResponse;
    default: return step.tool;
  }
}

/** 관측 요약 한 줄. 원본 JSON을 그대로 뿌리면 읽히지 않는다. */
function summarize(observation: unknown, language: 'ko' | 'en'): string | null {
  if (!observation || typeof observation !== 'object') return null;
  const o = observation as Record<string, unknown>;

  if (typeof o.error === 'string') return o.error;
  if (typeof o.modelError === 'string') return o.modelError;
  if (o.final === true) return null;

  const parts: string[] = [];
  if (typeof o.nodePath === 'string') parts.push(o.nodePath);
  if (typeof o.total === 'number') {
    parts.push(language === 'ko' ? `${o.total}문항` : `${o.total} items`);
  }
  if (typeof o.accuracy === 'number') parts.push(`${o.accuracy}%`);
  if (typeof o.returned === 'number') {
    parts.push(language === 'ko' ? `오답 ${o.returned}건` : `${o.returned} incorrect`);
  }
  if (Array.isArray(o.series)) {
    parts.push(language === 'ko' ? `${o.series.length}개월` : `${o.series.length} months`);
  }
  if (typeof o.grade === 'string') parts.push(o.grade);
  if (typeof o.note === 'string') parts.push(o.note);

  return parts.length ? parts.join(' · ') : null;
}

function stopReasonMessage(reason: AgentStopReason, t: ReturnType<typeof getTranslation>): string {
  switch (reason) {
    case 'max_steps': return t.stats.agentStopMaxSteps;
    case 'budget': return t.stats.agentStopBudget;
    case 'tool_errors': return t.stats.agentStopToolErrors;
    case 'loop_detected': return t.stats.agentStopLoop;
    default: return '';
  }
}

export function AgentTrace({ language, steps, state, stopReason, error }: AgentTraceProps) {
  const t = getTranslation(language);
  const endRef = useRef<HTMLDivElement | null>(null);

  // 스텝이 쌓이면 마지막 줄로 따라간다 — 진행 중인 지점이 화면 밖에 있으면 타임라인의 의미가 없다.
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [steps.length]);

  if (state === 'idle') return null;

  const isPartial = state === 'completed' && !!stopReason && stopReason !== 'final';

  return (
    <div className="mb-4 w-full max-w-full min-w-0 rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/50">
      <div className="mb-3 flex items-center gap-2">
        {state === 'running' && (
          <span className="inline-block h-2 w-2 flex-shrink-0 animate-pulse rounded-full bg-blue-500" aria-hidden="true" />
        )}
        <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">
          {t.stats.agentTraceTitle}
        </h3>
        <span className="text-xs text-slate-500 dark:text-slate-400">
          {state === 'running' ? t.stats.agentWorking
            : state === 'completed' ? t.stats.agentDone
            : t.stats.agentFailed}
        </span>
      </div>

      {steps.length === 0 && state === 'running' && (
        <p className="text-xs text-slate-500 dark:text-slate-400">{t.stats.agentStarting}</p>
      )}

      <ol className="max-h-64 space-y-2 overflow-y-auto">
        {steps.map((step) => {
          const observation = summarize(step.observation, language);
          return (
            <li key={step.id ?? step.seq} className="flex gap-3">
              <span
                className={`mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full text-[10px] font-semibold ${
                  step.ok
                    ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300'
                    : 'bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300'
                }`}
              >
                {step.seq}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-xs font-medium text-slate-700 dark:text-slate-200">
                    {stepLabel(step, t)}
                  </span>
                  {!step.ok && (
                    <span className="text-[10px] font-medium text-amber-600 dark:text-amber-400">
                      {t.stats.agentStepRetried}
                    </span>
                  )}
                </div>
                {step.thought && (
                  <p className="mt-0.5 break-words text-xs text-slate-600 dark:text-slate-300">{step.thought}</p>
                )}
                {observation && (
                  <p className={`mt-0.5 break-words text-[11px] ${
                    step.ok ? 'text-slate-500 dark:text-slate-400' : 'text-amber-600 dark:text-amber-400'
                  }`}>
                    {observation}
                  </p>
                )}
              </div>
            </li>
          );
        })}
        <div ref={endRef} />
      </ol>

      {isPartial && (
        <p className="mt-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-200">
          {t.stats.agentPartial} {stopReasonMessage(stopReason, t)}
        </p>
      )}

      {state === 'failed' && error && (
        <p className="mt-3 break-words rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-300">
          {error}
        </p>
      )}
    </div>
  );
}

export default AgentTrace;
