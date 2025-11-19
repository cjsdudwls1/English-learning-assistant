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
    <div className="mb-6 p-3 sm:p-4 bg-slate-50 dark:bg-slate-900/50 rounded-lg">
      <div className="flex flex-wrap gap-2 items-center mb-3">
        <span className="text-sm font-medium text-slate-700 dark:text-slate-300">{t.stats.periodSetting}</span>
        <button
          onClick={() => onSetDateRange(1)}
          className="px-3 py-1 text-sm bg-blue-100 text-blue-700 rounded hover:bg-blue-200"
        >
          {t.stats.oneMonth}
        </button>
        <button
          onClick={() => onSetDateRange(3)}
          className="px-3 py-1 text-sm bg-blue-100 text-blue-700 rounded hover:bg-blue-200"
        >
          {t.stats.threeMonths}
        </button>
        <button
          onClick={() => onSetDateRange(6)}
          className="px-3 py-1 text-sm bg-blue-100 text-blue-700 rounded hover:bg-blue-200"
        >
          {t.stats.sixMonths}
        </button>
        <button
          onClick={onThisYearClick}
          className="px-3 py-1 text-sm bg-blue-100 text-blue-700 rounded hover:bg-blue-200"
        >
          {t.stats.thisYear}
        </button>
        {(startDate || endDate) && (
          <button
            onClick={onClearFilter}
            className="px-3 py-1 text-sm bg-gray-200 text-gray-700 rounded hover:bg-gray-300"
          >
            {t.stats.total}
          </button>
        )}
      </div>
      <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
        <div>
          <label className="text-sm text-slate-600 mr-2">{t.stats.startDate}</label>
          <DatePicker
            selected={startDate}
            onChange={onStartDateChange}
            dateFormat="yyyy-MM-dd"
            className="px-3 py-1 border rounded"
            maxDate={endDate || new Date()}
          />
        </div>
        <div>
          <label className="text-sm text-slate-600 mr-2">{t.stats.endDate}</label>
          <DatePicker
            selected={endDate}
            onChange={onEndDateChange}
            dateFormat="yyyy-MM-dd"
            className="px-3 py-1 border rounded"
            minDate={startDate}
            maxDate={new Date()}
          />
        </div>
      </div>
    </div>
  );
};

