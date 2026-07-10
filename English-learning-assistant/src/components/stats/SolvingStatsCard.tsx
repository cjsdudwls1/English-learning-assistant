import React from 'react';
import { MonthlyStatsSelector } from './MonthlyStatsSelector';
import { DailyStatsSelector } from './DailyStatsSelector';
import { AssignmentStatsDisplay } from './AssignmentStatsDisplay';
import { useSolvingStats } from '../../hooks/useSolvingStats';
import { useLanguage } from '../../contexts/LanguageContext';
import { getTranslation } from '../../utils/translations';

export const SolvingStatsCard: React.FC = () => {
  const { language } = useLanguage();
  const t = getTranslation(language);
  const {
    year, selectedMonth, selectedDate,
    monthlyStats, dailyStats, loading, error,
    handleYearChange, handleSelectMonth, handleSelectDate,
  } = useSolvingStats();

  const selectedMonthStats = selectedMonth
    ? monthlyStats.find((s) => s.month === selectedMonth)
    : null;

  const selectedDayStats = selectedDate
    ? dailyStats.find((s) => s.date === selectedDate)
    : null;

  const yearTotals = monthlyStats.reduce(
    (acc, s) => ({
      total: acc.total + s.total_count,
      correct: acc.correct + s.correct_count,
      incorrect: acc.incorrect + s.incorrect_count,
      time: acc.time + s.avg_time_seconds * s.timed_count,
      timed: acc.timed + s.timed_count,
    }),
    { total: 0, correct: 0, incorrect: 0, time: 0, timed: 0 }
  );

  if (loading) {
    return (
      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-5 text-center text-slate-500">
        {language === 'ko' ? '통계 불러오는 중...' : 'Loading statistics...'}
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-lg border border-slate-200 dark:border-slate-700 p-5 space-y-5">
      <div>
        <h3 className="text-lg font-bold text-slate-800 dark:text-slate-200">{t.stats.monthlyDailySolvingStats}</h3>
      </div>
      {error && <p className="text-red-500 text-sm">{error}</p>}

      <AssignmentStatsDisplay
        totalCount={yearTotals.total}
        correctCount={yearTotals.correct}
        incorrectCount={yearTotals.incorrect}
        avgTimeSeconds={yearTotals.timed > 0 ? Math.round(yearTotals.time / yearTotals.timed) : 0}
        label={t.stats.yearTotalLabel.replace('{year}', String(year))}
      />

      <MonthlyStatsSelector
        year={year}
        monthlyData={monthlyStats}
        selectedMonth={selectedMonth}
        onSelectMonth={handleSelectMonth}
        onYearChange={handleYearChange}
      />

      {selectedMonthStats && (
        <AssignmentStatsDisplay
          totalCount={selectedMonthStats.total_count}
          correctCount={selectedMonthStats.correct_count}
          incorrectCount={selectedMonthStats.incorrect_count}
          avgTimeSeconds={selectedMonthStats.avg_time_seconds}
          label={t.stats.monthStatsLabel.replace('{month}', String(selectedMonth))}
        />
      )}

      {selectedMonth && (
        <DailyStatsSelector
          year={year}
          month={selectedMonth}
          dailyData={dailyStats}
          selectedDate={selectedDate}
          onSelectDate={handleSelectDate}
        />
      )}

      {selectedDayStats && (
        <AssignmentStatsDisplay
          totalCount={selectedDayStats.total_count}
          correctCount={selectedDayStats.correct_count}
          incorrectCount={selectedDayStats.incorrect_count}
          avgTimeSeconds={selectedDayStats.avg_time_seconds}
          label={t.stats.dateStatsLabel.replace('{date}', String(selectedDate))}
        />
      )}
    </div>
  );
};
