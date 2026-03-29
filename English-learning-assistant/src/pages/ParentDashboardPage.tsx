import React, { useEffect, useState } from 'react';
import { fetchMyChildren, fetchMonthlySolvingStats, fetchDailySolvingStats, type ChildInfo } from '../services/db';
import { ChildSelector } from '../components/parent/ChildSelector';
import { ChildStatsCard } from '../components/parent/ChildStatsCard';
import { ChildAssignmentsCard } from '../components/parent/ChildAssignmentsCard';
import type { MonthlyStats, DailyStats } from '../types';

export const ParentDashboardPage: React.FC = () => {
  const [children, setChildren] = useState<ChildInfo[]>([]);
  const [selectedChildId, setSelectedChildId] = useState<string | null>(null);
  const [monthlyStats, setMonthlyStats] = useState<MonthlyStats[]>([]);
  const [dailyStats, setDailyStats] = useState<DailyStats[]>([]);
  const [year, setYear] = useState(new Date().getFullYear());
  const [selectedMonth, setSelectedMonth] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchMyChildren()
      .then((c) => { setChildren(c); if (c.length > 0) setSelectedChildId(c[0].user_id); })
      .catch((e) => setError(e instanceof Error ? e.message : '자녀 목록을 불러오지 못했습니다.'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!selectedChildId) return;
    fetchMonthlySolvingStats(year, selectedChildId)
      .then(setMonthlyStats).catch((e) => setError(e instanceof Error ? e.message : '월별 통계를 불러오지 못했습니다.'));
  }, [selectedChildId, year]);

  useEffect(() => {
    if (!selectedChildId || !selectedMonth) { setDailyStats([]); return; }
    fetchDailySolvingStats(year, selectedMonth, selectedChildId)
      .then(setDailyStats).catch((e) => setError(e instanceof Error ? e.message : '일별 통계를 불러오지 못했습니다.'));
  }, [selectedChildId, year, selectedMonth]);

  if (loading) return <div className="text-center py-20 text-slate-500">불러오는 중...</div>;

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-200">학부모 대시보드</h1>
      {error && <p className="text-red-500 text-sm">{error}</p>}

      <ChildSelector
        children={children}
        selectedId={selectedChildId}
        onSelect={setSelectedChildId}
        onChildrenUpdate={setChildren}
      />

      {selectedChildId && (
        <>
          <ChildStatsCard
            monthlyStats={monthlyStats}
            dailyStats={dailyStats}
            year={year}
            selectedMonth={selectedMonth}
            onYearChange={setYear}
            onSelectMonth={setSelectedMonth}
          />
          <ChildAssignmentsCard childId={selectedChildId} />
        </>
      )}
    </div>
  );
};
