import { useCallback, useEffect, useState } from 'react';
import { fetchMonthlySolvingStats, fetchDailySolvingStats } from '../services/db';
import type { MonthlyStats, DailyStats } from '../types';

export function useSolvingStats() {
  const [year, setYear] = useState(new Date().getFullYear());
  const [selectedMonth, setSelectedMonth] = useState<number | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [monthlyStats, setMonthlyStats] = useState<MonthlyStats[]>([]);
  const [dailyStats, setDailyStats] = useState<DailyStats[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setSelectedMonth(null);
    setSelectedDate(null);
    fetchMonthlySolvingStats(year)
      .then((data) => { if (!cancelled) setMonthlyStats(data); })
      .catch((e) => {
        if (!cancelled) {
          setMonthlyStats([]);
          setError(e instanceof Error ? e.message : '월별 통계를 불러오지 못했습니다.');
        }
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [year]);

  useEffect(() => {
    if (!selectedMonth) { setDailyStats([]); return; }
    let cancelled = false;
    setSelectedDate(null);
    fetchDailySolvingStats(year, selectedMonth)
      .then((data) => { if (!cancelled) setDailyStats(data); })
      .catch((e) => {
        if (!cancelled) {
          setDailyStats([]);
          setError(e instanceof Error ? e.message : '일별 통계를 불러오지 못했습니다.');
        }
      });
    return () => { cancelled = true; };
  }, [year, selectedMonth]);

  const handleYearChange = useCallback((y: number) => setYear(y), []);
  const handleSelectMonth = useCallback((m: number) => setSelectedMonth(m), []);
  const handleSelectDate = useCallback((d: string) => setSelectedDate(d), []);

  return {
    year, selectedMonth, selectedDate,
    monthlyStats, dailyStats, loading, error,
    handleYearChange, handleSelectMonth, handleSelectDate,
  };
}
