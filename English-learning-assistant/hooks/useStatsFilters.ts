import { useState, useCallback } from 'react';

interface UseStatsFiltersReturn {
  startDate: Date | null;
  endDate: Date | null;
  setStartDate: (date: Date | null) => void;
  setEndDate: (date: Date | null) => void;
  handleSetDateRange: (months: number) => void;
  handleClearFilter: () => void;
}

export function useStatsFilters(): UseStatsFiltersReturn {
  const [startDate, setStartDate] = useState<Date | null>(null);
  const [endDate, setEndDate] = useState<Date | null>(null);

  const handleSetDateRange = useCallback((months: number) => {
    const end = new Date();
    const start = new Date();
    start.setMonth(start.getMonth() - months);
    setStartDate(start);
    setEndDate(end);
  }, []);

  const handleClearFilter = useCallback(() => {
    setStartDate(null);
    setEndDate(null);
  }, []);

  return {
    startDate,
    endDate,
    setStartDate,
    setEndDate,
    handleSetDateRange,
    handleClearFilter,
  };
}

