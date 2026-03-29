import React from 'react';
import { MonthlyStatsSelector } from './MonthlyStatsSelector';
import { DailyStatsSelector } from './DailyStatsSelector';
import { AssignmentStatsDisplay } from './AssignmentStatsDisplay';
import { useSolvingStats } from '../../hooks/useSolvingStats';

export const SolvingStatsCard: React.FC = () => {
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
      time: acc.time + s.avg_time_seconds * s.total_count,
    }),
    { total: 0, correct: 0, incorrect: 0, time: 0 }
  );

  if (loading) {
    return (
      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-5 text-center text-slate-500">
        통계 불러오는 중...
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-lg border border-slate-200 dark:border-slate-700 p-5 space-y-5">
      <h3 className="text-lg font-bold text-slate-800 dark:text-slate-200">월별 / 일별 풀이 통계</h3>
      {error && <p className="text-red-500 text-sm">{error}</p>}

      <AssignmentStatsDisplay
        totalCount={yearTotals.total}
        correctCount={yearTotals.correct}
        incorrectCount={yearTotals.incorrect}
        avgTimeSeconds={yearTotals.total > 0 ? Math.round(yearTotals.time / yearTotals.total) : 0}
        label={`${year}년 전체`}
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
          label={`${selectedMonth}월 통계`}
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
          label={`${selectedDate} 통계`}
        />
      )}
    </div>
  );
};
