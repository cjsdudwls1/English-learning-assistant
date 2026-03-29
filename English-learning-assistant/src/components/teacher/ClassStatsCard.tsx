import React, { useState } from 'react';
import { MonthlyStatsSelector } from '../stats/MonthlyStatsSelector';
import { AssignmentStatsDisplay } from '../stats/AssignmentStatsDisplay';
import type { MonthlyStats } from '../../types';

interface Props {
  monthlyStats: MonthlyStats[];
  year: number;
  onYearChange?: (year: number) => void;
}

export const ClassStatsCard: React.FC<Props> = ({ monthlyStats, year, onYearChange }) => {
  const [selectedMonth, setSelectedMonth] = useState<number | null>(null);

  const selectedStats = selectedMonth
    ? monthlyStats.find((s) => s.month === selectedMonth)
    : null;

  const totals = monthlyStats.reduce(
    (acc, s) => ({
      total: acc.total + s.total_count,
      correct: acc.correct + s.correct_count,
      incorrect: acc.incorrect + s.incorrect_count,
      time: acc.time + s.avg_time_seconds * s.total_count,
    }),
    { total: 0, correct: 0, incorrect: 0, time: 0 }
  );

  return (
    <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-5 space-y-4">
      <h3 className="text-lg font-bold text-slate-800 dark:text-slate-200">학급 통계</h3>

      <AssignmentStatsDisplay
        totalCount={totals.total}
        correctCount={totals.correct}
        incorrectCount={totals.incorrect}
        avgTimeSeconds={totals.total > 0 ? Math.round(totals.time / totals.total) : 0}
        label={`${year}년 전체`}
      />

      <MonthlyStatsSelector
        year={year}
        monthlyData={monthlyStats}
        selectedMonth={selectedMonth}
        onSelectMonth={setSelectedMonth}
        onYearChange={onYearChange ?? (() => {})}
      />

      {selectedStats && (
        <AssignmentStatsDisplay
          totalCount={selectedStats.total_count}
          correctCount={selectedStats.correct_count}
          incorrectCount={selectedStats.incorrect_count}
          avgTimeSeconds={selectedStats.avg_time_seconds}
          label={`${selectedMonth}월 통계`}
        />
      )}
    </div>
  );
};
