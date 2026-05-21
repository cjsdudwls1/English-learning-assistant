import { useState, useEffect, useCallback, useRef } from 'react';
import { fetchStatsByType, TypeStatsRow, fetchHierarchicalStats, StatsNode } from '../services/stats';
import { fetchAnalyzingSessions, fetchPendingLabelingSessions, fetchFailedSessions } from '../services/db';
import type { SessionWithProblems } from '../types';

// Supabase Auth SDK의 navigator.locks 충돌 에러는 무시
// (여러 탭에서 동시 세션 갱신 시 발생하는 일시적 에러)
// PostgrestError 등 plain object는 Error 인스턴스가 아니므로
// message 프로퍼티를 우선 확인하고, 없으면 JSON.stringify fallback
function normalizeError(e: unknown, language: 'ko' | 'en'): string {
  let msg: string;
  if (e instanceof Error) {
    msg = e.message;
  } else if (e && typeof e === 'object' && 'message' in e) {
    msg = String((e as { message: unknown }).message);
  } else if (e && typeof e === 'object') {
    try { msg = JSON.stringify(e); } catch { msg = String(e); }
  } else {
    msg = String(e);
  }
  return msg || (language === 'ko' ? '통계 조회 실패' : 'Failed to load stats');
}

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
  failedSessions: SessionWithProblems[];
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
  const [failedSessions, setFailedSessions] = useState<SessionWithProblems[]>([]);
  const [pendingLabelingSessions, setPendingLabelingSessions] = useState<SessionWithProblems[]>([]);
  const [pollingActive, setPollingActive] = useState(true);
  const lastAnalyzingSeenAtRef = useRef<number>(0);

  const loadData = useCallback(async (showLoading: boolean = false) => {
    try {
      if (showLoading) {
        setLoading(true);
      }
      const [statsData, hierarchicalStatsData, analyzing, pendingSessions, failed] = await Promise.all([
        fetchStatsByType(startDate || undefined, endDate || undefined, language),
        fetchHierarchicalStats(startDate || undefined, endDate || undefined, language),
        fetchAnalyzingSessions(),
        fetchPendingLabelingSessions(),
        fetchFailedSessions(),
      ]);
      setRows(statsData);
      setHierarchicalData(hierarchicalStatsData);

      // AnalyzingCard에 표시된 세션 ID 수집
      const analyzingIds = new Set(analyzing.map(s => s.id));

      // AnalyzingCard에 표시되지 않은 세션만 QuickLabelingCard에 표시
      const filteredPendingSessions = pendingSessions.filter(s => !analyzingIds.has(s.id));

      setAnalyzingSessions(analyzing);
      setPendingLabelingSessions(filteredPendingSessions);
      setFailedSessions(failed);

      // 폴링 로직 (RecentProblemsPage와 동일한 이유):
      // analyzing이 끝난 직후 completed/failed 카드가 다음 틱에 잡힐 수 있으므로,
      // 잠깐(60초) 더 폴링을 유지해서 "카드 공백" 구간을 없앰.
      const now = Date.now();
      if (analyzing.length > 0) {
        lastAnalyzingSeenAtRef.current = now;
      }
      const recentlyHadAnalyzing = lastAnalyzingSeenAtRef.current > 0 && now - lastAnalyzingSeenAtRef.current < 60_000;
      setPollingActive(analyzing.length > 0 || pendingSessions.length > 0 || recentlyHadAnalyzing);
    } catch (e) {
      const msg = normalizeError(e, language);
      if (msg.includes('Lock broken') || msg.includes('steal')) {
        console.warn('[Stats] Auth lock conflict, retrying on next poll:', msg);
        return;
      }
      setError(msg);
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
    failedSessions,
    pendingLabelingSessions,
    pollingActive,
    loadData,
    handleLabelingComplete,
  };
}

