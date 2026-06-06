import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchAssignedToMe } from '../services/db';
import type { SharedAssignment } from '../types';
import { useLanguage } from '../contexts/LanguageContext';
import { getTranslation } from '../utils/translations';
import { translateError } from '../utils/errorI18n';

export const AssignmentsPage: React.FC = () => {
  const { language } = useLanguage();
  const t = getTranslation(language);
  const [assignments, setAssignments] = useState<SharedAssignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchAssignedToMe()
      .then(setAssignments)
      .catch((e) => setError(translateError(e, language, t, t.assignments.loadError)))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="text-center py-20 text-slate-500">{t.common.loading}</div>;

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-200">{t.assignments.title}</h1>
      {error && <p className="text-red-500 text-sm">{error}</p>}
      {assignments.length === 0 ? (
        <div className="text-center py-16 text-slate-400">
          <p className="text-lg">{t.assignments.emptyTitle}</p>
          <p className="text-sm mt-1">{t.assignments.emptySubtitle}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {assignments.map((a) => {
            const isComplete = (a.completed_count ?? 0) >= (a.problem_count ?? 1);
            return (
              <Link key={a.id} to={`/assignments/${a.id}`} className="block bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-5 hover:border-indigo-400 transition-colors">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-semibold text-slate-800 dark:text-slate-200">{a.title}</p>
                    {a.description && <p className="text-sm text-slate-500 mt-1">{a.description}</p>}
                    <p className="text-xs text-slate-400 mt-2">
                      {new Date(a.created_at).toLocaleDateString(language === 'ko' ? 'ko-KR' : 'en-US')} · {t.assignments.problemCountUnit.replace('{count}', String(a.problem_count ?? 0))}
                      {a.due_date && ` · ${t.assignments.dueLabel.replace('{date}', new Date(a.due_date).toLocaleDateString(language === 'ko' ? 'ko-KR' : 'en-US'))}`}
                    </p>
                  </div>
                  <div className="text-right">
                    {isComplete ? (
                      <span className="px-3 py-1 rounded-full bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 text-xs font-medium">{t.assignments.completed}</span>
                    ) : (
                      <span className="px-3 py-1 rounded-full bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400 text-xs font-medium">
                        {a.completed_count ?? 0}/{a.problem_count ?? 0}
                      </span>
                    )}
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
};
