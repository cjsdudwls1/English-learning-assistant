import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getSessionStatus } from '../services/db';

export const AnalyzingPage: React.FC = () => {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const [dots, setDots] = useState(1);
  const [error, setError] = useState<string | null>(null);

  // 애니메이션 텍스트 효과
  useEffect(() => {
    const interval = setInterval(() => {
      setDots(prev => prev === 3 ? 1 : prev + 1);
    }, 500);

    return () => clearInterval(interval);
  }, []);

  // 상태 폴링
  useEffect(() => {
    if (!sessionId) {
      navigate('/stats');
      return;
    }

    const checkStatus = async () => {
      try {
        const status = await getSessionStatus(sessionId);
        
        if (status === 'completed') {
          navigate(`/session/${sessionId}`);
        } else if (status === 'failed') {
          setError('분석 중 오류가 발생했습니다. 다시 시도해주세요.');
        }
      } catch (err) {
        console.error('Status check error:', err);
        setError('상태 확인 중 오류가 발생했습니다.');
      }
    };

    // 즉시 한 번 체크
    checkStatus();

    // 2초마다 상태 확인
    const interval = setInterval(checkStatus, 2000);

    return () => clearInterval(interval);
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
        <p className="text-slate-600 mb-8 text-lg">
          AI가 이미지를 분석하고 있습니다
        </p>
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
          <p className="text-blue-800 text-sm">
            💡 웹에서 나가셔도 분석이 자동으로 수행됩니다
          </p>
        </div>
        <div className="flex justify-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
        </div>
      </div>
    </div>
  );
};
