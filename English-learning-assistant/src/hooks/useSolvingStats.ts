import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchMonthlySolvingStats, fetchDailySolvingStats } from '../services/db';
import { useLanguage } from '../contexts/LanguageContext';
import { getTranslation } from '../utils/translations';
import { translateError } from '../utils/errorI18n';
import { withAuthLockRetry, isAuthLockError } from '../utils/authLockRetry';
import type { MonthlyStats, DailyStats } from '../types';

// 풀이 통계 모듈 캐시 (stale-while-revalidate).
// /stats에 들어올 때마다 SolvingStatsCard 전체가 '통계 불러오는 중...'으로 덮여서,
// 탭을 오갈 때마다 카드가 사라졌다 다시 나타났다. useStatsData와 같은 방식으로
// 직전 스냅샷을 들고 있다가 즉시 그리고, 뒤에서 조용히 새로 받아 덮어쓴다.
//
// 사용자별 키를 두지 않는 이유: 로그아웃 시 LogoutButton이 window.location.reload()를
// 부르므로 모듈 캐시가 그 시점에 통째로 사라진다 (useStatsData와 동일한 전제).
const monthlyCache = new Map<number, MonthlyStats[]>();
const dailyCache = new Map<string, DailyStats[]>();
const CACHE_MAX_ENTRIES = 8;

function writeCache<K, V>(cache: Map<K, V>, key: K, value: V): void {
  // delete 후 set으로 삽입 순서를 갱신한다 — Map의 순서가 곧 LRU 순서가 된다.
  cache.delete(key);
  cache.set(key, value);
  while (cache.size > CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next();
    if (oldest.done) break;
    cache.delete(oldest.value);
  }
}

export function useSolvingStats() {
  const { language } = useLanguage();
  const initialYear = new Date().getFullYear();
  const [year, setYear] = useState(initialYear);
  const [selectedMonth, setSelectedMonth] = useState<number | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [monthlyStats, setMonthlyStats] = useState<MonthlyStats[]>(() => monthlyCache.get(initialYear) ?? []);
  const [dailyStats, setDailyStats] = useState<DailyStats[]>([]);
  const [loading, setLoading] = useState(() => !monthlyCache.has(initialYear));
  const [error, setError] = useState<string | null>(null);

  // 첫 렌더의 상태는 이미 캐시에서 왔다. 아래 effect가 같은 스냅샷을 또 set하지 않도록
  // '지금 화면에 그려진 연도'를 따로 들고 간다.
  const appliedYearRef = useRef(initialYear);

  useEffect(() => {
    let cancelled = false;
    const cached = monthlyCache.get(year);
    if (cached && appliedYearRef.current !== year) setMonthlyStats(cached);
    appliedYearRef.current = year;
    // 캐시가 있으면 로딩 화면을 띄우지 않는다. 갱신은 뒤에서 조용히 돈다.
    setLoading(!cached);
    setError(null);
    setSelectedMonth(null);
    setSelectedDate(null);
    withAuthLockRetry(() => fetchMonthlySolvingStats(year))
      .then((data) => {
        if (cancelled) return;
        writeCache(monthlyCache, year, data);
        setMonthlyStats(data);
      })
      .catch((e) => {
        if (cancelled) return;
        // 갱신에 실패했을 때 캐시가 있으면 그대로 둔다. 이미 보여준 값을 빈 화면으로
        // 되돌리면 사용자에겐 데이터가 사라진 것처럼 보인다.
        if (isAuthLockError(e)) {
          console.warn('[SolvingStats] Auth lock conflict on monthly fetch:', e);
          if (!cached) setMonthlyStats([]);
          return;
        }
        if (!cached) setMonthlyStats([]);
        setError(translateError(e, language, getTranslation(language), getTranslation(language).stats.monthlyLoadError));
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [year, language]);

  useEffect(() => {
    if (!selectedMonth) { setDailyStats([]); return; }
    let cancelled = false;
    const key = `${year}-${selectedMonth}`;
    const cached = dailyCache.get(key);
    if (cached) setDailyStats(cached);
    setSelectedDate(null);
    withAuthLockRetry(() => fetchDailySolvingStats(year, selectedMonth))
      .then((data) => {
        if (cancelled) return;
        writeCache(dailyCache, key, data);
        setDailyStats(data);
      })
      .catch((e) => {
        if (cancelled) return;
        if (isAuthLockError(e)) {
          console.warn('[SolvingStats] Auth lock conflict on daily fetch:', e);
          if (!cached) setDailyStats([]);
          return;
        }
        if (!cached) setDailyStats([]);
        setError(translateError(e, language, getTranslation(language), getTranslation(language).stats.dailyLoadError));
      });
    return () => { cancelled = true; };
  }, [year, selectedMonth, language]);

  const handleYearChange = useCallback((y: number) => setYear(y), []);
  const handleSelectMonth = useCallback((m: number) => setSelectedMonth(m), []);
  const handleSelectDate = useCallback((d: string) => setSelectedDate(d), []);

  return {
    year, selectedMonth, selectedDate,
    monthlyStats, dailyStats, loading, error,
    handleYearChange, handleSelectMonth, handleSelectDate,
  };
}
