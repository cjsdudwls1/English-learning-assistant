import { useState, useEffect, useCallback } from 'react';
import { fetchStatsByType, TypeStatsRow, fetchHierarchicalStats, StatsNode } from '../services/stats';
import { fetchAnalyzingSessions, fetchPendingLabelingSessions } from '../services/db';
import type { SessionWithProblems } from '../types';

interface UseStatsDataParams {
  startDate: Date | null;
  endDate: Date | null;
  language: 'ko' | 'en';
}

interface UseStatsDataReturn {
  rows: TypeStatsRow[];
  hierarchicalData: StatsNode[];
  loading: boolean;
  error: string | null;
  setError: (error: string | null) => void;
  analyzingSessions: SessionWithProblems[];
  pendingLabelingSessions: SessionWithProblems[];
  pollingActive: boolean;
  loadData: (showLoading?: boolean) => Promise<void>;
  handleLabelingComplete: () => Promise<void>;
}

export function useStatsData({ startDate, endDate, language }: UseStatsDataParams): UseStatsDataReturn {
  const [rows, setRows] = useState<TypeStatsRow[]>([]);
  const [hierarchicalData, setHierarchicalData] = useState<StatsNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [analyzingSessions, setAnalyzingSessions] = useState<SessionWithProblems[]>([]);
  const [pendingLabelingSessions, setPendingLabelingSessions] = useState<SessionWithProblems[]>([]);
  const [pollingActive, setPollingActive] = useState(true);

  const loadData = useCallback(async (showLoading: boolean = false) => {
    try {
      if (showLoading) {
        setLoading(true);
      }
      const [statsData, hierarchicalStatsData, analyzing, pendingSessions] = await Promise.all([
        fetchStatsByType(startDate || undefined, endDate || undefined, language),
        fetchHierarchicalStats(startDate || undefined, endDate || undefined, language),
        fetchAnalyzingSessions(),
        fetchPendingLabelingSessions(),
      ]);
      setRows(statsData);
      setHierarchicalData(hierarchicalStatsData);
      
      // AnalyzingCard에 표시된 세션 ID 수집
      const analyzingIds = new Set(analyzing.map(s => s.id));
      
      // AnalyzingCard에 표시되지 않은 세션만 QuickLabelingCard에 표시
      const filteredPendingSessions = pendingSessions.filter(s => !analyzingIds.has(s.id));
      
      setAnalyzingSessions(analyzing);
      setPendingLabelingSessions(filteredPendingSessions);
      
      // 분석 중이거나 라벨링이 필요하면 폴링 계속, 없으면 폴링 중단
      setPollingActive(analyzing.length > 0 || pendingSessions.length > 0);
    } catch (e) {
      setError(e instanceof Error ? e.message : '통계 조회 실패');
    } finally {
      if (showLoading) {
        setLoading(false);
      }
    }
  }, [startDate, endDate, language]);

  useEffect(() => {
    loadData(true); // 초기 로드 시에만 loading 표시
  }, [loadData]);

  // 폴링 로직: 분석 중이거나 라벨링이 필요한 세션이 있으면 3초마다 상태 확인 (loading 표시 없음)
  useEffect(() => {
    if (!pollingActive) return;
    
    const interval = setInterval(() => {
      loadData(false); // 폴링 시에는 loading 표시 안 함
    }, 3000);
    
    return () => clearInterval(interval);
  }, [pollingActive, loadData]);

  const handleLabelingComplete = useCallback(async () => {
    // 라벨링 완료 후 데이터 다시 로드
    await loadData();
  }, [loadData]);

  return {
    rows,
    hierarchicalData,
    loading,
    error,
    setError,
    analyzingSessions,
    pendingLabelingSessions,
    pollingActive,
    loadData,
    handleLabelingComplete,
  };
}

