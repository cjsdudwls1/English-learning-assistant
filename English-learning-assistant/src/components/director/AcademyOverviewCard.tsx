import React from 'react';
import type { DirectorOverview } from '../../services/db';

interface Props {
  overview: DirectorOverview;
}

export const AcademyOverviewCard: React.FC<Props> = ({ overview }) => {
  return (
    <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-5">
      <h2 className="text-lg font-bold text-slate-800 dark:text-slate-200 mb-4">학원 전체 현황</h2>
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <OverviewStat label="전체 학급" value={`${overview.totalClasses}개`} />
        <OverviewStat label="전체 학생" value={`${overview.totalStudents}명`} />
        <OverviewStat label="총 과제" value={`${overview.totalAssignments}개`} />
        <OverviewStat label="총 응답" value={`${overview.totalResponses}건`} />
        <OverviewStat label="전체 정답률" value={`${overview.overallCorrectRate}%`} highlight />
      </div>
    </div>
  );
};

const OverviewStat: React.FC<{ label: string; value: string; highlight?: boolean }> = ({ label, value, highlight }) => (
  <div className={`rounded-xl p-4 text-center ${highlight ? 'bg-indigo-50 dark:bg-indigo-900/20' : 'bg-slate-50 dark:bg-slate-700/50'}`}>
    <p className="text-xs text-slate-500 dark:text-slate-400">{label}</p>
    <p className={`text-xl font-bold mt-1 ${highlight ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-800 dark:text-slate-200'}`}>{value}</p>
  </div>
);
