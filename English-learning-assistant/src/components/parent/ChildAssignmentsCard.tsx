import React, { useEffect, useState } from 'react';
import { fetchChildAssignments } from '../../services/db';
import type { SharedAssignment } from '../../types';
import { useLanguage } from '../../contexts/LanguageContext';

interface Props {
  childId: string;
}

export const ChildAssignmentsCard: React.FC<Props> = ({ childId }) => {
  const [assignments, setAssignments] = useState<SharedAssignment[]>([]);
  const [loading, setLoading] = useState(true);
  const { language } = useLanguage();

  useEffect(() => {
    setLoading(true);
    fetchChildAssignments(childId)
      .then(setAssignments)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [childId]);

  if (loading) return <div className="text-center py-4 text-slate-500 text-sm">{language === 'ko' ? '과제 불러오는 중...' : 'Loading assignments...'}</div>;

  return (
    <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-5">
      <h3 className="text-lg font-bold text-slate-800 dark:text-slate-200 mb-4">{language === 'ko' ? '과제 현황' : 'Assignment Status'}</h3>
      {assignments.length === 0 ? (
        <p className="text-slate-400 text-sm text-center py-4">{language === 'ko' ? '배정된 과제가 없습니다.' : 'No assignments yet.'}</p>
      ) : (
        <div className="space-y-2">
          {assignments.map(a => {
            const isComplete = (a.completed_count ?? 0) >= (a.problem_count ?? 1);
            return (
              <div key={a.id} className="flex items-center justify-between p-3 rounded-xl bg-slate-50 dark:bg-slate-700/50">
                <div>
                  <p className="font-medium text-slate-800 dark:text-slate-200">{a.title}</p>
                  <p className="text-xs text-slate-500">
                    {a.completed_count ?? 0}/{a.problem_count ?? 0} {language === 'ko' ? '완료' : 'completed'}
                    {a.due_date && `${language === 'ko' ? ' · 마감: ' : ' · Due: '}${new Date(a.due_date).toLocaleDateString(language === 'ko' ? 'ko-KR' : 'en-US')}`}
                  </p>
                </div>
                <span className={`text-xs px-2 py-1 rounded-full ${isComplete ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400'}`}>
                  {isComplete ? (language === 'ko' ? '완료' : 'Completed') : (language === 'ko' ? '진행중' : 'In Progress')}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
