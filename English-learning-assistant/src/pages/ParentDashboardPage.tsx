import React, { useEffect, useState } from 'react';
import { fetchMyChildren, fetchMonthlySolvingStats, fetchDailySolvingStats, type ChildInfo } from '../services/db';
import { fetchHierarchicalStats, type StatsNode } from '../services/stats';
import { ChildSelector } from '../components/parent/ChildSelector';
import { ChildStatsCard } from '../components/parent/ChildStatsCard';
import { WeeklySummaryCard } from '../components/parent/WeeklySummaryCard';
import { ChildAssignmentsCard } from '../components/parent/ChildAssignmentsCard';
import { HierarchicalStatsTable } from '../components/HierarchicalStatsTable';
import { useLanguage } from '../contexts/LanguageContext';
import { getTranslation } from '../utils/translations';
import { translateError } from '../utils/errorI18n';
import { withAuthLockRetry } from '../utils/authLockRetry';
import type { MonthlyStats, DailyStats } from '../types';

export const ParentDashboardPage: React.FC = () => {
  const { language } = useLanguage();
  const t = getTranslation(language);
  const [children, setChildren] = useState<ChildInfo[]>([]);
  const [selectedChildId, setSelectedChildId] = useState<string | null>(null);
  const [monthlyStats, setMonthlyStats] = useState<MonthlyStats[]>([]);
  const [dailyStats, setDailyStats] = useState<DailyStats[]>([]);
  const [year, setYear] = useState(new Date().getFullYear());
  const [selectedMonth, setSelectedMonth] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  // 에러는 출처별로 따로 들고 있다가 하나로 합친다 — 한 곳의 성공이 다른 곳의 실패 문구를
  // 지워버리면(공용 상태 하나였을 때) 실패가 조용히 감춰진다.
  const [childrenError, setChildrenError] = useState<string | null>(null);
  const [monthlyError, setMonthlyError] = useState<string | null>(null);
  const [dailyError, setDailyError] = useState<string | null>(null);
  const [taxonomyError, setTaxonomyError] = useState<string | null>(null);
  const error = childrenError ?? monthlyError ?? dailyError ?? taxonomyError;

  // 택사노미 통계
  const [taxonomyStats, setTaxonomyStats] = useState<StatsNode[]>([]);
  const [showTaxonomy, setShowTaxonomy] = useState(false);
  const [taxonomyLoading, setTaxonomyLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    withAuthLockRetry(() => fetchMyChildren())
      .then((c) => {
        if (cancelled) return;
        setChildren(c);
        if (c.length > 0) setSelectedChildId(c[0].user_id);
      })
      .catch((e) => { if (!cancelled) setChildrenError(translateError(e, language, t, t.errors.loadChildrenFailed)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  // 자녀를 빠르게 전환하면 이전 자녀의 늦은 응답이 새 자녀 화면을 덮는다 —
  // cancelled 플래그로 버린다(WeeklySummaryCard와 같은 패턴).
  useEffect(() => {
    if (!selectedChildId) return;
    let cancelled = false;
    setMonthlyError(null); // 이전 자녀의 실패 문구가 새 자녀 밑에 남지 않게 매 조회 시작 시 비운다
    fetchMonthlySolvingStats(year, selectedChildId)
      .then((s) => { if (!cancelled) setMonthlyStats(s); })
      .catch((e) => { if (!cancelled) setMonthlyError(translateError(e, language, t, t.errors.loadMonthlyStatsFailed)); });
    return () => { cancelled = true; };
  }, [selectedChildId, year]);

  useEffect(() => {
    if (!selectedChildId || !selectedMonth) { setDailyStats([]); setDailyError(null); return; }
    let cancelled = false;
    setDailyError(null);
    fetchDailySolvingStats(year, selectedMonth, selectedChildId)
      .then((s) => { if (!cancelled) setDailyStats(s); })
      .catch((e) => { if (!cancelled) setDailyError(translateError(e, language, t, t.errors.loadDailyStatsFailed)); });
    return () => { cancelled = true; };
  }, [selectedChildId, year, selectedMonth]);

  // 택사노미 통계 로드
  useEffect(() => {
    if (!selectedChildId || !showTaxonomy) return;
    let cancelled = false;
    setTaxonomyLoading(true);
    setTaxonomyError(null);
    fetchHierarchicalStats(undefined, undefined, language, selectedChildId)
      .then((nodes) => { if (!cancelled) setTaxonomyStats(nodes); })
      .catch((e) => {
        if (cancelled) return;
        setTaxonomyStats([]);
        setTaxonomyError(translateError(e, language, t, t.errors.loadTaxonomyFailed));
      })
      .finally(() => { if (!cancelled) setTaxonomyLoading(false); });
    return () => { cancelled = true; };
  }, [selectedChildId, showTaxonomy, language]);

  // 자녀 변경 시 택사노미 초기화
  useEffect(() => {
    setShowTaxonomy(false);
    setTaxonomyStats([]);
    setTaxonomyError(null);
  }, [selectedChildId]);

  if (loading) return <div className="text-center py-6 sm:py-20 text-slate-500">{t.common.loading}</div>;

  return (
    <div className="max-w-4xl mx-auto space-y-4 sm:space-y-6">
      <h1 className="text-xl sm:text-2xl font-bold text-slate-800 dark:text-slate-200">{t.parent.dashboardTitle}</h1>
      {error && <p className="text-red-500 text-sm">{error}</p>}

      <ChildSelector
        children={children}
        selectedId={selectedChildId}
        onSelect={setSelectedChildId}
        onChildrenUpdate={setChildren}
      />

      {selectedChildId && (
        <>
          <WeeklySummaryCard childId={selectedChildId} />

          <ChildStatsCard
            monthlyStats={monthlyStats}
            dailyStats={dailyStats}
            year={year}
            selectedMonth={selectedMonth}
            onYearChange={setYear}
            onSelectMonth={setSelectedMonth}
          />

          {/* 택사노미별 통계 */}
          <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-3 sm:p-5 space-y-3 sm:space-y-4">
            <button
              onClick={() => setShowTaxonomy(!showTaxonomy)}
              className="flex -my-2.5 items-center gap-2 py-2.5 text-sm font-bold text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-300 transition-colors"
            >
              <span>{showTaxonomy ? '▼' : '▶'}</span>
              {t.stats.taxonomyStatsTitle}
            </button>

            {showTaxonomy && (
              <div className="mt-3">
                {taxonomyLoading ? (
                  <p className="text-sm text-slate-500 py-4 text-center">{t.stats.loadingTaxonomy}</p>
                ) : taxonomyStats.length === 0 ? (
                  <p className="text-sm text-slate-600 dark:text-slate-400 py-4 text-center">{t.stats.noTaxonomyData}</p>
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
