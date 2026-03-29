import React from 'react';
import type { MonthlyStats } from '../../types';

interface Props {
  year: number;
  monthlyData: MonthlyStats[];
  selectedMonth: number | null;
  onSelectMonth: (month: number) => void;
  onYearChange: (year: number) => void;
}

const MONTH_LABELS = ['1월', '2월', '3월', '4월', '5월', '6월', '7월', '8월', '9월', '10월', '11월', '12월'];

export const MonthlyStatsSelector: React.FC<Props> = ({ year, monthlyData, selectedMonth, onSelectMonth, onYearChange }) => {
  const dataMap = new Map(monthlyData.map((d) => [d.month, d]));

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <button onClick={() => onYearChange(year - 1)} className="px-3 py-1 rounded-lg bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-sm font-medium">
          &larr;
        </button>
        <span className="text-lg font-bold text-slate-800 dark:text-slate-200">{year}년</span>
        <button onClick={() => onYearChange(year + 1)} className="px-3 py-1 rounded-lg bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-sm font-medium">
          &rarr;
        </button>
      </div>
      <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
        {MONTH_LABELS.map((label, i) => {
          const month = i + 1;
          const stats = dataMap.get(month);
          const isSelected = selectedMonth === month;
          const hasData = !!stats && stats.total_count > 0;
          return (
            <button
              key={month}
              onClick={() => onSelectMonth(month)}
              className={`relative px-2 py-3 rounded-xl text-sm font-medium transition-all ${
                isSelected
                  ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/30'
                  : hasData
                    ? 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-600 hover:border-indigo-400'
                    : 'bg-slate-100 dark:bg-slate-800/50 text-slate-400 dark:text-slate-500 border border-transparent'
              }`}
            >
              {label}
              {hasData && (
                <span className={`absolute -top-1 -right-1 min-w-[18px] h-[18px] flex items-center justify-center rounded-full text-[10px] font-bold ${
                  isSelected ? 'bg-white text-indigo-600' : 'bg-indigo-500 text-white'
                }`}>
                  {stats!.total_count}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
};
