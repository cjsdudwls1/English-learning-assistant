import React from 'react';
import { useLanguage } from '../../contexts/LanguageContext';

interface Props {
  totalCount: number;
  correctCount: number;
  incorrectCount: number;
  avgTimeSeconds: number;
  label?: string;
}

export const AssignmentStatsDisplay: React.FC<Props> = ({ totalCount, correctCount, incorrectCount, avgTimeSeconds, label }) => {
  const { language } = useLanguage();
  const correctRate = totalCount > 0 ? Math.round((correctCount / totalCount) * 100) : 0;
  const minutes = Math.floor(avgTimeSeconds / 60);
  const seconds = avgTimeSeconds % 60;

  if (totalCount === 0) {
    return (
      <div className="text-center py-8 text-slate-600 dark:text-slate-400">
        {label ? `${label}: ` : ''}{language === 'ko' ? '데이터가 없습니다.' : 'No data available.'}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {label && <h4 className="text-sm font-semibold text-slate-600 dark:text-slate-400">{label}</h4>}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard title={language === 'ko' ? '총 문제' : 'Total Problems'} value={language === 'ko' ? `${totalCount}문제` : `${totalCount}`} color="slate" />
        <StatCard title={language === 'ko' ? '정답률' : 'Accuracy'} value={`${correctRate}%`} color="green" />
        <StatCard title={language === 'ko' ? '정답/오답' : 'Correct / Incorrect'} value={`${correctCount}/${incorrectCount}`} color="blue" />
        <StatCard title={language === 'ko' ? '평균 시간' : 'Avg. Time'} value={minutes > 0 ? (language === 'ko' ? `${minutes}분 ${seconds}초` : `${minutes}m ${seconds}s`) : (language === 'ko' ? `${seconds}초` : `${seconds}s`)} color="purple" />
      </div>
      <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-3 overflow-hidden">
        <div
          className="h-full bg-gradient-to-r from-green-500 to-emerald-400 rounded-full transition-all duration-500"
          style={{ width: `${correctRate}%` }}
        />
      </div>
      <div className="flex justify-between text-xs text-slate-500 dark:text-slate-400">
        <span>{language === 'ko' ? `정답 ${correctCount}개` : `${correctCount} correct`}</span>
        <span>{language === 'ko' ? `오답 ${incorrectCount}개` : `${incorrectCount} incorrect`}</span>
      </div>
    </div>
  );
};

const COLORS: Record<string, string> = {
  slate: 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300',
  green: 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400',
  blue: 'bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400',
  purple: 'bg-purple-50 dark:bg-purple-900/20 text-purple-700 dark:text-purple-400',
};

const StatCard: React.FC<{ title: string; value: string; color: string }> = ({ title, value, color }) => (
  <div className={`rounded-xl p-3 ${COLORS[color] ?? COLORS.slate}`}>
    <p className="text-[11px]">{title}</p>
    <p className="text-lg font-bold">{value}</p>
  </div>
);
