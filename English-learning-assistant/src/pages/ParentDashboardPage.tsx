import React, { useEffect, useState } from 'react';
import { fetchMyChildren, fetchMonthlySolvingStats, fetchDailySolvingStats, type ChildInfo } from '../services/db';
import { fetchHierarchicalStats, type StatsNode } from '../services/stats';
import { ChildSelector } from '../components/parent/ChildSelector';
import { ChildStatsCard } from '../components/parent/ChildStatsCard';
import { ChildAssignmentsCard } from '../components/parent/ChildAssignmentsCard';
import { HierarchicalStatsTable } from '../components/HierarchicalStatsTable';
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

  // 택사노미 통계
  const [taxonomyStats, setTaxonomyStats] = useState<StatsNode[]>([]);
  const [showTaxonomy, setShowTaxonomy] = useState(false);
  const [taxonomyLoading, setTaxonomyLoading] = useState(false);

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

  // 택사노미 통계 로드
  useEffect(() => {
    if (!selectedChildId || !showTaxonomy) return;
    setTaxonomyLoading(true);
    fetchHierarchicalStats(undefined, undefined, 'ko', selectedChildId)
      .then(setTaxonomyStats)
      .catch(() => setTaxonomyStats([]))
      .finally(() => setTaxonomyLoading(false));
  }, [selectedChildId, showTaxonomy]);

  // 자녀 변경 시 택사노미 초기화
  useEffect(() => {
    setShowTaxonomy(false);
    setTaxonomyStats([]);
  }, [selectedChildId]);

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

          {/* 택사노미별 통계 */}
          <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-5 space-y-4">
            <button
              onClick={() => setShowTaxonomy(!showTaxonomy)}
              className="flex items-center gap-2 text-sm font-bold text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-300 transition-colors"
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

          <ChildAssignmentsCard childId={selectedChildId} />
        </>
      )}
    </div>
  );
};
