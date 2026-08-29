/**
 * 맞춤 학습플랜 결과
 *
 * 보고서 모달과 다른 점: **여기 있는 건 읽을거리가 아니라 할 일이다.** 계획을 읽고 나서
 * 문제를 다시 찾아야 한다면 계획을 세운 의미가 없다 — 그래서 하루치마다 바로 풀 수 있게 한다.
 *
 * 과제 초안은 초안으로만 둔다. 배포에는 반·학생 선택이 필요하고 그건 이 화면이 가진 정보가
 * 아니다(에세이 채점의 "AI 판정은 제안일 뿐"과 같은 선). 사용자가 과제 화면에서 직접 만든다.
 */
import React, { useState } from 'react';
import { getTranslation } from '../utils/translations';
import { renderMarkdown } from '../utils/markdown';
import type { PlannerResult } from '../hooks/usePlanner';

interface LearningPlanModalProps {
  language: 'ko' | 'en';
  plan: PlannerResult | null;
  scopeLabel?: string;
  isOpen: boolean;
  onClose: () => void;
  /** 해당 문제들을 시험지로 연다. 모달을 닫는 건 호출부 몫이다. */
  onSolve: (problemIds: string[]) => void | Promise<unknown>;
}

export const LearningPlanModal: React.FC<LearningPlanModalProps> = ({
  language,
  plan,
  scopeLabel,
  isOpen,
  onClose,
  onSolve,
}) => {
  const t = getTranslation(language);
  // 연타로 같은 조회를 두 번 쏘지 않게 누른 버튼만 잠근다('all' 또는 일차 번호).
  const [busy, setBusy] = useState<number | 'all' | null>(null);

  if (!isOpen) return null;

  const handleSolve = async (key: number | 'all', ids: string[]) => {
    if (busy !== null || ids.length === 0) return;
    setBusy(key);
    try {
      await onSolve(ids);
    } finally {
      setBusy(null);
    }
  };

  const solveLabel = (key: number | 'all', fallback: string) =>
    (busy === key ? t.common.loading : fallback);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-2 sm:p-4">
      <div className="flex max-h-[92vh] w-full max-w-3xl flex-col rounded-lg bg-white shadow-xl dark:bg-slate-800 sm:max-h-[88vh]">
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 p-4 sm:p-5 dark:border-slate-700">
          <div className="min-w-0">
            <h3 className="text-xl font-bold text-slate-800 dark:text-slate-200">{t.stats.planModalTitle}</h3>
            {scopeLabel && (
              <p className="mt-1 break-words text-sm text-slate-500 dark:text-slate-400">
                {language === 'ko' ? '범위' : 'Scope'}: {scopeLabel}
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            className="inline-flex min-h-[40px] flex-shrink-0 items-center justify-center rounded bg-slate-200 px-3 py-2 text-sm text-slate-700 transition-colors hover:bg-slate-300 sm:min-h-0 sm:py-1.5 dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-slate-600"
          >
            {t.common.close}
          </button>
        </div>

        <div className="overflow-y-auto p-4 sm:p-6">
          {!plan ? (
            <p className="text-slate-500 dark:text-slate-400">{t.stats.planEmpty}</p>
          ) : (
            <>
              {plan.summary && (
                <section className="mb-4 sm:mb-6">
                  <h4 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    {t.stats.planSummaryTitle}
                  </h4>
                  <article className="max-w-none break-keep break-words leading-relaxed text-[15px] text-slate-700 dark:text-slate-300">
                    {renderMarkdown(plan.summary)}
                  </article>
                </section>
              )}

              {/* 새로 만든 문항 수는 서버 예산 카운터 값이다 — 모델이 부풀릴 수 없는 숫자만 보여준다. */}
              {plan.generatedCount > 0 && (
                <p className="mb-4 rounded border border-violet-200 bg-violet-50 px-3 py-2 text-xs text-violet-800 dark:border-violet-800 dark:bg-violet-900/30 dark:text-violet-200">
                  {t.stats.planNewProblems.replace('{count}', String(plan.generatedCount))}
                </p>
              )}

              <section>
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <h4 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    {t.stats.planScheduleTitle}
                  </h4>
                  {plan.problemIds.length > 0 && (
                    <button
                      onClick={() => void handleSolve('all', plan.problemIds)}
                      disabled={busy !== null}
                      className="inline-flex min-h-[40px] items-center justify-center rounded bg-violet-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-60 sm:min-h-0 sm:py-1.5"
                    >
                      {solveLabel('all', `${t.stats.planSolveAll} (${plan.problemIds.length})`)}
                    </button>
                  )}
                </div>

                {/* 일정이 비어도 서버는 더 이상 실패로 처리하지 않는다 — 이미 만들어 둔 문제와
                    요약은 살려 보낸다. 그때 여기가 아무것도 안 그리면 빈 화면으로 보인다. */}
                {plan.weeklyPlan.length === 0 && (
                  <p className="rounded border border-slate-200 px-3 py-2 text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
                    {t.stats.planScheduleEmpty}
                  </p>
                )}

                <ol className="space-y-2 sm:space-y-3">
                  {plan.weeklyPlan.map((day) => (
                    <li
                      key={day.day}
                      className="rounded-lg border border-slate-200 p-3 sm:p-4 dark:border-slate-700"
                    >
                      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 sm:gap-x-3">
                        <span className="shrink-0 rounded bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600 dark:bg-slate-700 dark:text-slate-300">
                          {t.stats.planDayLabel.replace('{count}', String(day.day))}
                        </span>
                        <span className="min-w-0 break-words font-semibold text-slate-800 dark:text-slate-200">{day.focus}</span>
                        {day.nodePath && (
                          <span className="break-words text-xs text-slate-500 dark:text-slate-400">{day.nodePath}</span>
                        )}
                      </div>

                      {day.activity && (
                        <p className="mt-2 break-words text-sm leading-6 text-slate-700 dark:text-slate-300">
                          {day.activity}
                        </p>
                      )}

                      <div className="mt-2 sm:mt-3 flex flex-wrap items-center gap-2 sm:gap-3">
                        {day.problemIds.length > 0 ? (
                          <>
                            <span className="text-xs text-slate-500 dark:text-slate-400">
                              {t.stats.planProblemCount.replace('{count}', String(day.problemIds.length))}
                            </span>
                            <button
                              onClick={() => void handleSolve(day.day, day.problemIds)}
                              disabled={busy !== null}
                              className="inline-flex min-h-[40px] items-center justify-center rounded bg-slate-100 px-3 py-2 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-60 sm:min-h-0 sm:py-1.5 dark:bg-slate-700 dark:text-slate-200 dark:hover:bg-slate-600"
                            >
                              {solveLabel(day.day, t.stats.planSolve)}
                            </button>
                          </>
                        ) : (
                          <span className="text-xs text-slate-400 dark:text-slate-500">{t.stats.planNoProblems}</span>
                        )}
                      </div>
                    </li>
                  ))}
                </ol>
              </section>

              {plan.assignmentDraft && (
                <section className="mt-4 sm:mt-6 rounded-lg border border-slate-200 bg-slate-50 p-3 sm:p-4 dark:border-slate-700 dark:bg-slate-900/40">
                  <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                    {t.stats.planAssignmentTitle}
                  </h4>
                  <p className="mt-2 break-words font-medium text-slate-800 dark:text-slate-200">
                    {plan.assignmentDraft.title}
                  </p>
                  {plan.assignmentDraft.description && (
                    <p className="mt-1 break-words text-sm leading-6 text-slate-600 dark:text-slate-300">
                      {plan.assignmentDraft.description}
                    </p>
                  )}
                  <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
                    {t.stats.planAssignmentNotice}
                  </p>
                </section>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default LearningPlanModal;
