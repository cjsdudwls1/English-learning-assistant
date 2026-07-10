import React from 'react';
import type { DirectorOverview } from '../../services/db';
import { useLanguage } from '../../contexts/LanguageContext';
import { getTranslation } from '../../utils/translations';

interface Props {
  overview: DirectorOverview;
}

export const AcademyOverviewCard: React.FC<Props> = ({ overview }) => {
  const { language } = useLanguage();
  const t = getTranslation(language);
  const suffix = (s: string) => (language === 'ko' ? s : '');
  return (
    <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-5">
      <h2 className="text-lg font-bold text-slate-800 dark:text-slate-200 mb-4">{t.director.academyOverview}</h2>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <OverviewStat label={t.director.totalClasses} value={`${overview.totalClasses}${suffix(t.director.countSuffixGae)}`} />
        <OverviewStat label={t.director.totalStudents} value={`${overview.totalStudents}${suffix(t.director.countSuffixMyeong)}`} />
        <OverviewStat label={t.director.totalAssignments} value={`${overview.totalAssignments}${suffix(t.director.countSuffixGae)}`} />
        <OverviewStat label={t.director.totalResponses} value={`${overview.totalResponses}${suffix(t.director.countSuffixGeon)}`} />
        <OverviewStat label={t.director.ungradedResponses} value={`${overview.ungradedResponses}${suffix(t.director.countSuffixGeon)}`} />
        <OverviewStat label={t.director.overallAccuracy} value={`${overview.overallCorrectRate}%`} highlight />
      </div>
    </div>
  );
};

const OverviewStat: React.FC<{ label: string; value: string; highlight?: boolean }> = ({ label, value, highlight }) => (
  <div className={`rounded-xl p-4 text-center ${highlight ? 'bg-indigo-50 dark:bg-indigo-900/20' : 'bg-slate-50 dark:bg-slate-700/50'}`}>
    <p className="text-xs text-slate-600 dark:text-slate-400">{label}</p>
    <p className={`text-xl font-bold mt-1 ${highlight ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-800 dark:text-slate-200'}`}>{value}</p>
  </div>
);
