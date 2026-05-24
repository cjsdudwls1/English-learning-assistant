import React, { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getSessionProgress } from '../services/db';
import { supabase } from '../services/supabaseClient';

// ─── Phase 3: Supabase Realtime 구독 (polling 제거) ───
// - 기존: 2초마다 getSessionProgress 폴링 → DB 부하 + 응답 지연
// - 신규: postgres_changes UPDATE 이벤트 구독 → 상태 변경 즉시 반응
// - 안전망: Realtime 연결 실패 대비 15초 주기 longer-polling fallback
export const AnalyzingPage: React.FC = () => {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const [dots, setDots] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [currentModel, setCurrentModel] = useState<string | null>(null);
  const navigatedRef = useRef(false);

  useEffect(() => {
    const interval = setInterval(() => {
      setDots(prev => prev === 3 ? 1 : prev + 1);
    }, 500);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!sessionId) {
      navigate('/stats');
      return;
    }

    let mounted = true;

    const handleStatusUpdate = (status: string | null | undefined, analysisModel?: string | null) => {
      if (!mounted || navigatedRef.current) return;
      if (analysisModel) setCurrentModel(analysisModel);
      if (status === 'completed') {
        navigatedRef.current = true;
        navigate(`/session/${sessionId}`);
      } else if (status === 'failed') {
        setError('분석 중 오류가 발생했습니다. 다시 시도해주세요.');
      }
    };

    // 초기 1회 조회: 페이지 진입 시점에 이미 완료/실패된 경우 즉시 반영
    (async () => {
      try {
        const { status, analysisModel } = await getSessionProgress(sessionId);
        handleStatusUpdate(status, analysisModel);
      } catch (err) {
        console.error('[AnalyzingPage] 초기 상태 조회 실패:', err);
      }
    })();

    // Realtime 구독: sessions 테이블의 UPDATE 이벤트 → status/analysis_model 변경 시 즉시 처리
    const channel = supabase
      .channel(`session-status:${sessionId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'sessions', filter: `id=eq.${sessionId}` },
        (payload) => {
          const next = payload.new as { status?: string | null; analysis_model?: string | null };
          handleStatusUpdate(next.status, next.analysis_model);
        },
      )
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          console.warn('[AnalyzingPage] Realtime 구독 실패:', status);
        }
      });

    // Realtime 연결 안정성 안전망: 15초마다 fallback polling
    const fallbackInterval = setInterval(async () => {
      if (navigatedRef.current) return;
      try {
        const { status, analysisModel } = await getSessionProgress(sessionId);
        handleStatusUpdate(status, analysisModel);
      } catch (err) {
        console.error('[AnalyzingPage] fallback polling 실패:', err);
      }
    }, 15_000);

    return () => {
      mounted = false;
      clearInterval(fallbackInterval);
      supabase.removeChannel(channel);
    };
  }, [sessionId, navigate]);

  const handleRetry = () => {
    navigate('/upload');
  };

  const handleGoToStats = () => {
    navigate('/stats');
  };

  if (error) {
    return (
      <div className="max-w-4xl mx-auto bg-white rounded-2xl shadow-lg p-6 md:p-8 border border-slate-200">
        <div className="text-center">
          <div className="text-6xl mb-4">⚠️</div>
          <h2 className="text-2xl font-bold text-red-600 mb-4">분석 실패</h2>
          <p className="text-slate-700 mb-6">{error}</p>
          <div className="flex gap-4 justify-center">
            <button
              onClick={handleRetry}
              className="px-6 py-3 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
            >
              다시 시도
            </button>
            <button
              onClick={handleGoToStats}
              className="px-6 py-3 bg-slate-600 text-white rounded-lg hover:bg-slate-700"
            >
              통계로 이동
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto bg-white rounded-2xl shadow-lg p-6 md:p-8 border border-slate-200">
      <div className="text-center">
        <div className="text-6xl mb-6">🔍</div>
        <h2 className="text-3xl font-bold text-slate-800 mb-4">
          분석중{'.'.repeat(dots)}
        </h2>
        <p className="text-slate-600 mb-6 text-lg">
          AI가 이미지를 분석하고 있습니다
        </p>

        {currentModel && (
          <div className="mb-8 inline-flex items-center px-4 py-2 rounded-full bg-indigo-50 border border-indigo-100 text-indigo-700">
            <span className="mr-2 animate-pulse">🤖</span>
            <span className="font-medium">분석 중인 AI: {currentModel}</span>
          </div>
        )}

        <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-6 text-left max-w-lg mx-auto">
          <p className="text-green-800 text-sm font-medium flex items-center gap-2">
            ✅ 분석이 백그라운드에서 진행 중입니다
          </p>
          <p className="text-green-700 text-xs mt-1 pl-6">
            💡 웹에서 나가셔도 분석이 자동으로 완료됩니다. 통계 페이지에서 결과를 확인하세요.
          </p>
        </div>
        <div className="flex gap-4 justify-center">
          <button
            onClick={() => navigate('/stats')}
            className="px-6 py-3 bg-slate-600 text-white rounded-lg hover:bg-slate-700"
          >
            통계 페이지로 이동
          </button>
        </div>
        <div className="flex justify-center mt-6">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
        </div>
      </div>
    </div>
  );
};
