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

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetchChildAssignments(childId)
      .then(setAssignments)
      .catch((e) => setError(translateError(e, language, t, t.assignments.loadError)))
      .finally(() => setLoading(false));
  }, [childId]);

  if (loading) return <div className="text-center py-4 text-slate-500 text-sm">{t.parent.loadingAssignments}</div>;

  return (
    <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-5">
      <h3 className="text-lg font-bold text-slate-800 dark:text-slate-200 mb-4">{t.parent.assignmentStatus}</h3>
      {error && <p className="text-red-500 text-sm mb-3">{error}</p>}
      {assignments.length === 0 ? (
        !error && <p className="text-slate-400 text-sm text-center py-4">{t.parent.noAssignments}</p>
      ) : (
        <div className="space-y-2">
          {assignments.map(a => {
            const isComplete = (a.completed_count ?? 0) >= (a.problem_count ?? 1);
            const overdueIncomplete = !isComplete && isOverdue(a.due_date);
            const hasResponses = (a.completed_count ?? 0) > 0;
            return (
              <div key={a.id} className="flex items-center justify-between p-3 rounded-xl bg-slate-50 dark:bg-slate-700/50">
                <div>
                  <p className="font-medium text-slate-800 dark:text-slate-200">{a.title}</p>
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
                <span className={`text-xs px-2 py-1 rounded-full ${isComplete ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : overdueIncomplete ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300' : 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400'}`}>
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
