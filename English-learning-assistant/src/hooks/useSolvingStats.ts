import { useCallback, useEffect, useState } from 'react';
import { fetchMonthlySolvingStats, fetchDailySolvingStats } from '../services/db';
import { useLanguage } from '../contexts/LanguageContext';
import { getTranslation } from '../utils/translations';
import { translateError } from '../utils/errorI18n';
import { withAuthLockRetry, isAuthLockError } from '../utils/authLockRetry';
import type { MonthlyStats, DailyStats } from '../types';

export function useSolvingStats() {
  const { language } = useLanguage();
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
    withAuthLockRetry(() => fetchMonthlySolvingStats(year))
      .then((data) => { if (!cancelled) setMonthlyStats(data); })
      .catch((e) => {
        if (cancelled) return;
        if (isAuthLockError(e)) {
          console.warn('[SolvingStats] Auth lock conflict on monthly fetch:', e);
          setMonthlyStats([]);
          return;
        }
        setMonthlyStats([]);
        setError(translateError(e, language, getTranslation(language), getTranslation(language).stats.monthlyLoadError));
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [year, language]);

  useEffect(() => {
    if (!selectedMonth) { setDailyStats([]); return; }
    let cancelled = false;
    setSelectedDate(null);
    withAuthLockRetry(() => fetchDailySolvingStats(year, selectedMonth))
      .then((data) => { if (!cancelled) setDailyStats(data); })
      .catch((e) => {
        if (cancelled) return;
        if (isAuthLockError(e)) {
          console.warn('[SolvingStats] Auth lock conflict on daily fetch:', e);
          setDailyStats([]);
          return;
        }
        setDailyStats([]);
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
