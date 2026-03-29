import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchAssignedToMe } from '../services/db';
import type { SharedAssignment } from '../types';

export const AssignmentsPage: React.FC = () => {
  const [assignments, setAssignments] = useState<SharedAssignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchAssignedToMe()
      .then(setAssignments)
      .catch((e) => setError(e instanceof Error ? e.message : '과제를 불러오지 못했습니다.'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="text-center py-20 text-slate-500">불러오는 중...</div>;

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-200">내 과제</h1>
      {error && <p className="text-red-500 text-sm">{error}</p>}
      {assignments.length === 0 ? (
        <div className="text-center py-16 text-slate-400">
          <p className="text-lg">아직 할당된 과제가 없습니다.</p>
          <p className="text-sm mt-1">선생님이 과제를 공유하면 여기에 표시됩니다.</p>
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
                      {new Date(a.created_at).toLocaleDateString('ko-KR')} · {a.problem_count ?? 0}문제
                      {a.due_date && ` · 마감: ${new Date(a.due_date).toLocaleDateString('ko-KR')}`}
                    </p>
                  </div>
                  <div className="text-right">
                    {isComplete ? (
                      <span className="px-3 py-1 rounded-full bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 text-xs font-medium">완료</span>
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
