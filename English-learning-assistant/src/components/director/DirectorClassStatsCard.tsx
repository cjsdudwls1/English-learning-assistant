import React, { useState } from 'react';
import { MonthlyStatsSelector } from '../stats/MonthlyStatsSelector';
import { AssignmentStatsDisplay } from '../stats/AssignmentStatsDisplay';
import type { ClassInfo, MonthlyStats } from '../../types';

interface Props {
  classes: ClassInfo[];
  selectedClassId: string | null;
  classStats: MonthlyStats[];
  year: number;
  onSelectClass: (id: string) => void;
  onYearChange: (year: number) => void;
  onDeleteClass?: (id: string) => void;
}

export const DirectorClassStatsCard: React.FC<Props> = ({ classes, selectedClassId, classStats, year, onSelectClass, onYearChange, onDeleteClass }) => {
  const [selectedMonth, setSelectedMonth] = useState<number | null>(null);

  const selectedMonthStats = selectedMonth
    ? classStats.find((s) => s.month === selectedMonth)
    : null;

  const totals = classStats.reduce(
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
      <h2 className="text-lg font-bold text-slate-800 dark:text-slate-200">학급별 통계</h2>

      <div className="flex flex-wrap gap-2">
        {classes.map((cls) => (
          <button
            key={cls.id}
            onClick={() => { onSelectClass(cls.id); setSelectedMonth(null); }}
            className={`px-4 py-2 rounded-xl text-sm font-medium transition-colors ${selectedClassId === cls.id ? 'bg-indigo-600 text-white' : 'bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-200'}`}
          >
            {cls.name} ({cls.student_count ?? 0}명)
          </button>
        ))}
      </div>

      {selectedClassId && (
        <>
          <div className="flex justify-end mb-2">
            {onDeleteClass && (
              <button
                onClick={() => {
                  if (window.confirm('정말로 이 학급을 삭제하시겠습니까? 학급에 포함된 모든 과제 및 기록이 함께 삭제됩니다.')) {
                    onDeleteClass(selectedClassId);
                  }
                }}
                className="px-3 py-1.5 bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-800/50 rounded-lg text-sm font-medium transition-colors"
              >
                현재 학급 삭제
              </button>
            )}
          </div>

          <AssignmentStatsDisplay
            totalCount={totals.total}
            correctCount={totals.correct}
            incorrectCount={totals.incorrect}
            avgTimeSeconds={totals.total > 0 ? Math.round(totals.time / totals.total) : 0}
            label={`${year}년 전체`}
          />

          <MonthlyStatsSelector
            year={year}
            monthlyData={classStats}
            selectedMonth={selectedMonth}
            onSelectMonth={setSelectedMonth}
            onYearChange={onYearChange}
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
        </>
      )}

      {classes.length === 0 && (
        <p className="text-slate-400 text-sm py-4 text-center">등록된 학급이 없습니다.</p>
      )}
    </div>
  );
};
