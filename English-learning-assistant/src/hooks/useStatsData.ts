import { useState, useEffect, useCallback, useRef } from 'react';
import { fetchStatsByType, TypeStatsRow, fetchHierarchicalStats, StatsNode, StatsComposition, fetchUnifiedProblemSummary, UnifiedSummary } from '../services/stats';
import { fetchAnalyzingSessions, fetchPendingLabelingSessions, fetchFailedSessions } from '../services/db';
import { getTranslation } from '../utils/translations';
import { translateError } from '../utils/errorI18n';
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

// 폴링 간격 — 한 틱마다 무거운 질의 6개가 나가므로 3초는 모바일에서 스크롤을 끊었다.
// 분석 진행 중에만 도는 값이라 5초면 완료 반영 체감 지연 없이 요청 수를 40% 줄인다.
const POLL_INTERVAL_MS = 5000;

const EMPTY_SUMMARY: UnifiedSummary = {
  registered: 0, regCorrect: 0, regIncorrect: 0, regUngraded: 0,
  gen: 0, genCorrect: 0, genIncorrect: 0, genUngraded: 0,
  total: 0, correct: 0, incorrect: 0, ungraded: 0,
};

interface UseStatsDataReturn {
  rows: TypeStatsRow[];
  composition: StatsComposition;
  summary: UnifiedSummary;
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
  const [composition, setComposition] = useState<StatsComposition>({ labelMarked: 0, genSolved: 0 });
  const [summary, setSummary] = useState<UnifiedSummary>(EMPTY_SUMMARY);
  const [hierarchicalData, setHierarchicalData] = useState<StatsNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [analyzingSessions, setAnalyzingSessions] = useState<SessionWithProblems[]>([]);
  const [failedSessions, setFailedSessions] = useState<SessionWithProblems[]>([]);
  const [pendingLabelingSessions, setPendingLabelingSessions] = useState<SessionWithProblems[]>([]);
  // 초기값 true는 의도적이다 — 첫 로드가 auth lock 충돌로 조용히 return하면(아래 catch)
  // 다음 폴링 틱이 유일한 재시도 경로다. 첫 로드가 끝나면 진행 중 여부로 즉시 갱신된다.
  const [pollingActive, setPollingActive] = useState(true);
  const lastAnalyzingSeenAtRef = useRef<number>(0);

  const loadData = useCallback(async (showLoading: boolean = false) => {
    try {
      if (showLoading) {
        setLoading(true);
      }
      const [statsResult, hierarchicalStatsData, unifiedSummary, analyzing, pendingSessions, failed] = await Promise.all([
        fetchStatsByType(startDate || undefined, endDate || undefined, language),
        fetchHierarchicalStats(startDate || undefined, endDate || undefined, language),
        fetchUnifiedProblemSummary(startDate || undefined, endDate || undefined),
        fetchAnalyzingSessions(),
        fetchPendingLabelingSessions(),
        fetchFailedSessions(),
      ]);
      setRows(statsResult.rows);
      setComposition(statsResult.composition);
      setSummary(unifiedSummary);
      setHierarchicalData(hierarchicalStatsData);

      // AnalyzingCard에 표시된 세션 ID 수집
      const analyzingIds = new Set(analyzing.map(s => s.id));

      // AnalyzingCard에 표시되지 않은 세션만 QuickLabelingCard에 표시
      const filteredPendingSessions = pendingSessions.filter(s => !analyzingIds.has(s.id));

      setAnalyzingSessions(analyzing);
      setPendingLabelingSessions(filteredPendingSessions);
      setFailedSessions(failed);

      // 폴링은 '분석이 진행 중'일 때만 유지한다.
      // 라벨링 대기(pendingSessions)는 사용자가 검수를 눌러야 사라지는 정적 상태라,
      // 조건에 넣으면 대기 세션이 하나만 있어도 폴링이 영영 안 꺼져 무거운 질의 6개를 계속 반복했다.
      // analyzing이 끝난 직후 completed/failed/라벨링 카드가 다음 틱에 잡히는 "카드 공백"은
      // recentlyHadAnalyzing(60초)이 덮는다. 같은 탭의 라벨링 완료는 handleLabelingComplete가 갱신한다.
      const now = Date.now();
      if (analyzing.length > 0) {
        lastAnalyzingSeenAtRef.current = now;
      }
      const recentlyHadAnalyzing = lastAnalyzingSeenAtRef.current > 0 && now - lastAnalyzingSeenAtRef.current < 60_000;
      setPollingActive(analyzing.length > 0 || recentlyHadAnalyzing);
    } catch (e) {
      const msg = normalizeError(e, language);
      if (msg.includes('Lock broken') || msg.includes('steal')) {
        console.warn('[Stats] Auth lock conflict, retrying on next poll:', msg);
        return;
      }
      // 서비스 레이어 한글 throw가 en 모드에 누출되지 않도록 번역/차단(fallback=normalizeError 결과)
      setError(translateError(e, language, getTranslation(language), msg));
    } finally {
      if (showLoading) {
        setLoading(false);
      }
    }
  }, [startDate, endDate, language]);

  useEffect(() => {
    loadData(true); // 초기 로드 시에만 loading 표시
  }, [loadData]);

  // 폴링 로직: 분석이 진행 중일 때만 주기적으로 상태 확인 (loading 표시 없음)
  useEffect(() => {
    if (!pollingActive) return;

    const interval = setInterval(() => {
      loadData(false); // 폴링 시에는 loading 표시 안 함
    }, POLL_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [pollingActive, loadData]);

  const handleLabelingComplete = useCallback(async () => {
    // 라벨링 완료 후 데이터 다시 로드
    await loadData();
  }, [loadData]);

  return {
    rows,
    composition,
    summary,
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

