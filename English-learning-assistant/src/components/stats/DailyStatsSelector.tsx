import React from 'react';
import type { DailyStats } from '../../types';
import { useLanguage } from '../../contexts/LanguageContext';
import { getTranslation } from '../../utils/translations';

interface Props {
  year: number;
  month: number;
  dailyData: DailyStats[];
  selectedDate: string | null;
  onSelectDate: (date: string) => void;
}

export const DailyStatsSelector: React.FC<Props> = ({ year, month, dailyData, selectedDate, onSelectDate }) => {
  const { language } = useLanguage();
  const t = getTranslation(language);
  const daysInMonth = new Date(year, month, 0).getDate();
  const dataMap = new Map(dailyData.map((d) => [d.date, d]));

  const days = Array.from({ length: daysInMonth }, (_, i) => {
    const day = i + 1;
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  });

  return (
    <div className="space-y-2">
      <h4 className="text-xs sm:text-sm font-semibold text-slate-600 dark:text-slate-400">{language === 'ko' ? `${month}월 일별 통계` : `Daily Statistics — ${t.monthLabels[month - 1]}`}</h4>
      <div className="grid grid-cols-7 gap-1">
        {days.map((date) => {
          const day = parseInt(date.slice(-2), 10);
          const stats = dataMap.get(date);
          const isSelected = selectedDate === date;
          const hasData = !!stats && stats.total_count > 0;
          return (
            // min-h는 sm:에서 반드시 푼다. 데이터 없는 날 칸은 자연 높이가 31px이라 40px 하한이
            // 데스크톱에서도 걸려 그 주 행이 통째로 8px 두꺼워진다 — 마우스에는 탭 하한이 필요 없다.
            <button
              key={date}
              onClick={() => onSelectDate(date)}
              className={`relative min-h-[40px] sm:min-h-0 px-0.5 py-1.5 sm:px-1 sm:py-2 rounded-lg text-xs font-medium leading-tight transition-all ${
                isSelected
                  ? 'bg-indigo-600 text-white shadow-md'
                  : hasData
                    ? 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-600 hover:border-indigo-400'
                    : 'bg-slate-50 dark:bg-slate-800/30 text-slate-400 dark:text-slate-600'
              }`}
            >
              {day}
              {hasData && (
                <span className={`block text-[10px] sm:text-[11px] leading-tight mt-0.5 ${isSelected ? 'text-indigo-200' : 'text-indigo-500'}`}>
                  {language === 'ko' ? `${stats!.total_count}문제` : stats!.total_count}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
};
