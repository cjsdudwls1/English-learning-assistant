import React, { useEffect, useState } from 'react';
import { fetchWeeklySolvingSummary, type WeeklySolvingSummary } from '../../services/db';
import { fetchHierarchicalStats, type StatsNode } from '../../services/stats';
import { useLanguage } from '../../contexts/LanguageContext';
import { getTranslation } from '../../utils/translations';

interface Props {
  childId: string;
}

// 취약 카테고리: 이번 주 표본 3문제 이상 & 정답률 80% 미만인 depth1 중 최저 2개
const WEAK_MIN_SAMPLE = 3;
const WEAK_MAX_RATE = 80;

export const WeeklySummaryCard: React.FC<Props> = ({ childId }) => {
  const { language } = useLanguage();
  const t = getTranslation(language);
  const [summary, setSummary] = useState<WeeklySolvingSummary | null>(null);
  const [weakCategories, setWeakCategories] = useState<Array<{ name: string; rate: number }>>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const s = await fetchWeeklySolvingSummary(childId);
        if (cancelled) return;
        setSummary(s);

        let weak: Array<{ name: string; rate: number }> = [];
        if (s.thisWeekCount > 0) {
          const nodes: StatsNode[] = await fetchHierarchicalStats(s.weekStart, new Date(), language, childId);
          weak = nodes
            .filter((n) => n.total_count >= WEAK_MIN_SAMPLE)
            .map((n) => ({ name: n.depth1, rate: Math.round((n.correct_count / n.total_count) * 100) }))
            .filter((n) => n.rate < WEAK_MAX_RATE)
            .sort((a, b) => a.rate - b.rate)
            .slice(0, 2);
        }
        if (!cancelled) setWeakCategories(weak);
      } catch (e) {
        console.error('Failed to load weekly summary:', e);
        if (!cancelled) setSummary(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [childId, language]);

  if (loading) {
    return (
      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-5">
        <h2 className="text-sm font-bold text-slate-800 dark:text-slate-200 mb-3">{t.parent.weeklySummaryTitle}</h2>
        <p className="text-sm text-slate-400">{t.common.loading}</p>
      </div>
    );
  }
  if (!summary) return null;

  return (
    <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-5">
      <h2 className="text-sm font-bold text-slate-800 dark:text-slate-200 mb-3">{t.parent.weeklySummaryTitle}</h2>
      {summary.thisWeekCount === 0 ? (
        <p className="text-sm text-slate-400">{t.parent.noWeeklyData}</p>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="p-4 bg-blue-50 dark:bg-blue-900/30 rounded-xl">
              <div className="text-xs text-blue-600 dark:text-blue-400 mb-1">{t.parent.thisWeekSolved}</div>
              <div className="text-2xl font-bold text-blue-800 dark:text-blue-200">{summary.thisWeekCount}</div>
              <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                {t.parent.vsLastWeek.replace('{count}', String(summary.lastWeekCount))}
              </div>
            </div>
            <div className="p-4 bg-purple-50 dark:bg-purple-900/30 rounded-xl">
              <div className="text-xs text-purple-600 dark:text-purple-400 mb-1">{t.parent.weeklyAccuracy}</div>
              <div className="text-2xl font-bold text-purple-800 dark:text-purple-200">{summary.thisWeekCorrectRate}%</div>
            </div>
          </div>
          {weakCategories.length > 0 && (
            <div>
              <div className="text-xs font-semibold text-slate-600 dark:text-slate-400 mb-2">{t.parent.weakCategories}</div>
              <div className="flex flex-wrap gap-2">
                {weakCategories.map((c) => (
                  <span key={c.name} className="px-3 py-1 text-xs rounded-full bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-300 border border-red-200 dark:border-red-800">
                    {c.name} · {c.rate}%
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
