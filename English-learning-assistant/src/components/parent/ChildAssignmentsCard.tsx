import React, { useEffect, useState } from 'react';
import { fetchChildAssignments } from '../../services/db';
import type { SharedAssignment } from '../../types';
import { useLanguage } from '../../contexts/LanguageContext';
import { getTranslation } from '../../utils/translations';
import { translateError } from '../../utils/errorI18n';
import { isOverdue } from '../../utils/assignmentDue';

interface Props {
  childId: string;
}

export const ChildAssignmentsCard: React.FC<Props> = ({ childId }) => {
  const [assignments, setAssignments] = useState<SharedAssignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { language } = useLanguage();
  const t = getTranslation(language);

  // 자녀를 빠르게 전환하면 이전 자녀의 늦은 응답이 새 자녀 목록을 덮는다 —
  // cancelled 플래그로 버린다(WeeklySummaryCard와 같은 패턴).
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchChildAssignments(childId)
      .then((a) => { if (!cancelled) setAssignments(a); })
      .catch((e) => { if (!cancelled) setError(translateError(e, language, t, t.assignments.loadError)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [childId]);

  if (loading) return <div className="text-center py-4 text-slate-500 text-sm">{t.parent.loadingAssignments}</div>;

  return (
    <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-3 sm:p-5">
      <h3 className="text-base sm:text-lg font-bold text-slate-800 dark:text-slate-200 mb-3 sm:mb-4">{t.parent.assignmentStatus}</h3>
      {error && <p className="text-red-500 text-sm mb-3">{error}</p>}
      {assignments.length === 0 ? (
        !error && <p className="text-slate-400 text-sm text-center py-4">{t.parent.noAssignments}</p>
      ) : (
        <div className="space-y-2">
          {assignments.map(a => {
            // 문제가 0개(또는 미상)인 과제는 '완료'가 아니다 —
            // `?? 1` 폴백은 problem_count가 실제 0일 때 발동하지 않아 0 >= 0으로 완료 처리됐다.
            const problemCount = a.problem_count ?? 0;
            const isComplete = problemCount > 0 && (a.completed_count ?? 0) >= problemCount;
            const overdueIncomplete = !isComplete && isOverdue(a.due_date);
            const hasResponses = (a.completed_count ?? 0) > 0;
            return (
              <div key={a.id} data-testid="child-assignment-row" className="flex items-center justify-between gap-2 p-3 rounded-xl bg-slate-50 dark:bg-slate-700/50">
                <div className="min-w-0">
                  <p className="break-words font-medium text-slate-800 dark:text-slate-200">{a.title}</p>
                  <p className="text-xs text-slate-500">
                    {t.parent.completedFraction.replace('{completed}', String(a.completed_count ?? 0)).replace('{total}', String(a.problem_count ?? 0))}
                    {a.due_date && ` · ${t.parent.dueDateLabel.replace('{date}', new Date(a.due_date).toLocaleDateString(language === 'ko' ? 'ko-KR' : 'en-US'))}`}
                  </p>
                  {hasResponses && (
                    <p className="text-xs text-slate-500 mt-0.5">
                      {t.parent.gradedSummary
                        .replace('{correct}', String(a.correct_count ?? 0))
                        .replace('{wrong}', String(a.incorrect_count ?? 0))
                        .replace('{ungraded}', String(a.ungraded_count ?? 0))}
                    </p>
                  )}
                </div>
                <span className={`shrink-0 whitespace-nowrap text-xs px-2 py-1 rounded-full ${isComplete ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : overdueIncomplete ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300' : 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400'}`}>
                  {isComplete ? t.parent.statusComplete : overdueIncomplete ? t.assignments.overdue : t.parent.statusInProgress}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
