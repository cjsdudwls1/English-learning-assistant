import React, { useEffect, useState } from 'react';
import { fetchMonthlySolvingStats, fetchDailySolvingStats } from '../../services/db';
import { fetchHierarchicalStats, type StatsNode } from '../../services/stats';
import { MonthlyStatsSelector } from '../stats/MonthlyStatsSelector';
import { DailyStatsSelector } from '../stats/DailyStatsSelector';
import { AssignmentStatsDisplay } from '../stats/AssignmentStatsDisplay';
import { HierarchicalStatsTable } from '../HierarchicalStatsTable';
import type { MonthlyStats, DailyStats } from '../../types';

interface Props {
  studentId: string;
  studentEmail?: string;
  onClose?: () => void;
}

export const StudentStatsPanel: React.FC<Props> = ({ studentId, studentEmail, onClose }) => {
  const [year, setYear] = useState(new Date().getFullYear());
  const [selectedMonth, setSelectedMonth] = useState<number | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [monthlyStats, setMonthlyStats] = useState<MonthlyStats[]>([]);
  const [dailyStats, setDailyStats] = useState<DailyStats[]>([]);
  const [taxonomyStats, setTaxonomyStats] = useState<StatsNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [taxonomyLoading, setTaxonomyLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showTaxonomy, setShowTaxonomy] = useState(false);

  // 월별 통계 로드
  useEffect(() => {
    setLoading(true);
    setError(null);
    fetchMonthlySolvingStats(year, studentId)
      .then(setMonthlyStats)
      .catch((e) => setError(e instanceof Error ? e.message : '통계를 불러오지 못했습니다.'))
      .finally(() => setLoading(false));
  }, [studentId, year]);

  // 일별 통계 로드
  useEffect(() => {
    if (!selectedMonth) { setDailyStats([]); return; }
    fetchDailySolvingStats(year, selectedMonth, studentId)
      .then(setDailyStats)
      .catch(() => {});
  }, [studentId, year, selectedMonth]);

  // 택사노미별 통계 로드
  useEffect(() => {
    if (!showTaxonomy) return;
    setTaxonomyLoading(true);
    fetchHierarchicalStats(undefined, undefined, 'ko', studentId)
      .then(setTaxonomyStats)
      .catch(() => setTaxonomyStats([]))
      .finally(() => setTaxonomyLoading(false));
  }, [studentId, showTaxonomy]);

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
        학생 통계 불러오는 중...
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-5 space-y-5">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-bold text-slate-800 dark:text-slate-200">
          {studentEmail ? `${studentEmail}` : '학생'} 통계
        </h3>
        {onClose && (
          <button
            onClick={onClose}
            className="text-xs px-3 py-1.5 text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors"
          >
            닫기
          </button>
        )}
      </div>
      {error && <p className="text-red-500 text-sm">{error}</p>}

      {/* 연간 총합 */}
      <AssignmentStatsDisplay
        totalCount={yearTotals.total}
        correctCount={yearTotals.correct}
        incorrectCount={yearTotals.incorrect}
        avgTimeSeconds={yearTotals.total > 0 ? Math.round(yearTotals.time / yearTotals.total) : 0}
        label={`${year}년 전체`}
      />

      {/* 월별 선택 */}
      <MonthlyStatsSelector
        year={year}
        monthlyData={monthlyStats}
        selectedMonth={selectedMonth}
        onSelectMonth={(m) => { setSelectedMonth(m); setSelectedDate(null); }}
        onYearChange={(y) => { setYear(y); setSelectedMonth(null); setSelectedDate(null); }}
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

      {/* 일별 선택 */}
      {selectedMonth && (
        <DailyStatsSelector
          year={year}
          month={selectedMonth}
          dailyData={dailyStats}
          selectedDate={selectedDate}
          onSelectDate={setSelectedDate}
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

      {/* 택사노미별 통계 토글 */}
      <div className="border-t border-slate-200 dark:border-slate-700 pt-4">
        <button
          onClick={() => setShowTaxonomy(!showTaxonomy)}
          className="flex items-center gap-2 text-sm font-semibold text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-300 transition-colors"
        >
          <span>{showTaxonomy ? '▼' : '▶'}</span>
          문제 유형(택사노미)별 통계
        </button>

        {showTaxonomy && (
          <div className="mt-3">
            {taxonomyLoading ? (
              <p className="text-sm text-slate-500 py-4 text-center">택사노미 통계 불러오는 중...</p>
            ) : taxonomyStats.length === 0 ? (
              <p className="text-sm text-slate-400 py-4 text-center">택사노미 통계 데이터가 없습니다.</p>
            ) : (
              <HierarchicalStatsTable data={taxonomyStats} />
            )}
          </div>
        )}
      </div>
    </div>
  );
};
