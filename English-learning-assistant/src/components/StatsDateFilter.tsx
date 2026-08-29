import React from 'react';
import DatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';
import { getTranslation } from '../utils/translations';

interface StatsDateFilterProps {
  startDate: Date | null;
  endDate: Date | null;
  language: 'ko' | 'en';
  onStartDateChange: (date: Date | null) => void;
  onEndDateChange: (date: Date | null) => void;
  onSetDateRange: (months: number) => void;
  onClearFilter: () => void;
  onThisYearClick: () => void;
}

export const StatsDateFilter: React.FC<StatsDateFilterProps> = ({
  startDate,
  endDate,
  language,
  onStartDateChange,
  onEndDateChange,
  onSetDateRange,
  onClearFilter,
  onThisYearClick,
}) => {
  const t = getTranslation(language);

  return (
    <div className="mb-4 sm:mb-6 p-2.5 sm:p-4 bg-slate-50 dark:bg-slate-900/50 rounded-lg">
      {/* 모바일: 라벨을 한 줄 위로 빼서 프리셋 버튼들이 세그먼트처럼 한 줄에 들어가게 한다 */}
      <div className="flex flex-wrap gap-1.5 sm:gap-2 items-center mb-2 sm:mb-3">
        <span className="w-full sm:w-auto text-xs sm:text-sm font-medium text-slate-700 dark:text-slate-300">{t.stats.periodSetting}</span>
        <button
          onClick={() => onSetDateRange(1)}
          className="min-h-[40px] sm:min-h-0 px-2.5 sm:px-3 py-1.5 sm:py-1 text-xs sm:text-sm bg-blue-100 text-blue-700 rounded hover:bg-blue-200"
        >
          {t.stats.oneMonth}
        </button>
        <button
          onClick={() => onSetDateRange(3)}
          className="min-h-[40px] sm:min-h-0 px-2.5 sm:px-3 py-1.5 sm:py-1 text-xs sm:text-sm bg-blue-100 text-blue-700 rounded hover:bg-blue-200"
        >
          {t.stats.threeMonths}
        </button>
        <button
          onClick={() => onSetDateRange(6)}
          className="min-h-[40px] sm:min-h-0 px-2.5 sm:px-3 py-1.5 sm:py-1 text-xs sm:text-sm bg-blue-100 text-blue-700 rounded hover:bg-blue-200"
        >
          {t.stats.sixMonths}
        </button>
        <button
          onClick={onThisYearClick}
          className="min-h-[40px] sm:min-h-0 px-2.5 sm:px-3 py-1.5 sm:py-1 text-xs sm:text-sm bg-blue-100 text-blue-700 rounded hover:bg-blue-200"
        >
          {t.stats.thisYear}
        </button>
        {(startDate || endDate) && (
          <button
            onClick={onClearFilter}
            className="min-h-[40px] sm:min-h-0 px-2.5 sm:px-3 py-1.5 sm:py-1 text-xs sm:text-sm bg-gray-200 text-gray-700 rounded hover:bg-gray-300"
          >
            {t.stats.total}
          </button>
        )}
      </div>
      {/* 날짜 입력에는 글자 크기 유틸리티를 걸지 않는다 — 16px 미만이면 iOS가 포커스 때 화면을 확대한다 */}
      <div className="flex flex-col sm:flex-row gap-2 sm:gap-3 sm:items-center">
        <div className="flex items-center gap-2 min-w-0">
          <label htmlFor="stats-start-date" className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 shrink-0">{t.stats.startDate}</label>
          <DatePicker
            id="stats-start-date"
            selected={startDate}
            onChange={onStartDateChange}
            dateFormat="yyyy-MM-dd"
            className="px-2.5 sm:px-3 py-1.5 sm:py-1 border rounded"
            maxDate={endDate || new Date()}
          />
        </div>
        <div className="flex items-center gap-2 min-w-0">
          <label htmlFor="stats-end-date" className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 shrink-0">{t.stats.endDate}</label>
          <DatePicker
            id="stats-end-date"
            selected={endDate}
            onChange={onEndDateChange}
            dateFormat="yyyy-MM-dd"
            className="px-2.5 sm:px-3 py-1.5 sm:py-1 border rounded"
            minDate={startDate}
            maxDate={new Date()}
          />
        </div>
      </div>
    </div>
  );
};

