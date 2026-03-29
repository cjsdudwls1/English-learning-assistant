import React from 'react';
import type { DailyStats } from '../../types';

interface Props {
  year: number;
  month: number;
  dailyData: DailyStats[];
  selectedDate: string | null;
  onSelectDate: (date: string) => void;
}

export const DailyStatsSelector: React.FC<Props> = ({ year, month, dailyData, selectedDate, onSelectDate }) => {
  const daysInMonth = new Date(year, month, 0).getDate();
  const dataMap = new Map(dailyData.map((d) => [d.date, d]));

  const days = Array.from({ length: daysInMonth }, (_, i) => {
    const day = i + 1;
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  });

  return (
    <div className="space-y-2">
      <h4 className="text-sm font-semibold text-slate-600 dark:text-slate-400">{month}월 일별 통계</h4>
      <div className="grid grid-cols-7 gap-1">
        {days.map((date) => {
          const day = parseInt(date.slice(-2), 10);
          const stats = dataMap.get(date);
          const isSelected = selectedDate === date;
          const hasData = !!stats && stats.total_count > 0;
          return (
            <button
              key={date}
              onClick={() => onSelectDate(date)}
              className={`relative px-1 py-2 rounded-lg text-xs font-medium transition-all ${
                isSelected
                  ? 'bg-indigo-600 text-white shadow-md'
                  : hasData
                    ? 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-600 hover:border-indigo-400'
                    : 'bg-slate-50 dark:bg-slate-800/30 text-slate-400 dark:text-slate-600'
              }`}
            >
              {day}
              {hasData && (
                <span className={`block text-[9px] mt-0.5 ${isSelected ? 'text-indigo-200' : 'text-indigo-500'}`}>
                  {stats!.total_count}문제
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
};
