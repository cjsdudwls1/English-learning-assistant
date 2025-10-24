import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import type { ProblemItem } from '../types';
import { MultiProblemEditor } from '../components/MultiProblemEditor';
import { fetchSessionProblems, updateProblemLabels } from '../services/db';

export const EditPage: React.FC = () => {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<ProblemItem[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!sessionId) {
      navigate('/stats');
      return;
    }

    // sessionId 변경 시 이전 데이터 초기화
    setData(null);
    setError(null);

    (async () => {
      try {
        setLoading(true);
        const items = await fetchSessionProblems(sessionId);
        setData(items);
      } catch (e) {
        setError(e instanceof Error ? e.message : '문제를 불러오는데 실패했습니다.');
      } finally {
        setLoading(false);
      }
    })();
  }, [sessionId, navigate]);

  const handleSubmit = async (items: ProblemItem[]) => {
    if (!sessionId) return;
    await updateProblemLabels(sessionId, items);
    navigate('/stats');
  };

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto bg-white rounded-2xl shadow-lg p-6 md:p-8 border border-slate-200">
        <p className="text-center text-slate-600">불러오는 중...</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="max-w-4xl mx-auto bg-white rounded-2xl shadow-lg p-6 md:p-8 border border-slate-200">
        <p className="text-center text-red-600">{error || '문제를 찾을 수 없습니다.'}</p>
        <div className="text-center mt-4">
          <button
            onClick={() => navigate('/stats')}
            className="px-6 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
          >
            통계로 돌아가기
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto bg-white rounded-2xl shadow-lg p-6 md:p-8 border border-slate-200">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold">문제 수정</h2>
        <button
          onClick={() => navigate('/stats')}
          className="px-4 py-2 text-slate-600 hover:text-slate-800 underline"
        >
          취소
        </button>
      </div>
      <MultiProblemEditor 
        initial={{ items: data }} 
        onSubmit={handleSubmit} 
        onChange={(items) => setData(items)} 
      />
    </div>
  );
};

