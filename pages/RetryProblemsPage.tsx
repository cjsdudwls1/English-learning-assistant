import React, { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { MultiProblemEditor } from '../components/MultiProblemEditor';
import type { AnalysisResults, ProblemItem } from '../types';
import { fetchProblemsByIds } from '../services/db';

export const RetryProblemsPage: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const [items, setItems] = useState<ProblemItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  const problemIds = useMemo(() => {
    const params = new URLSearchParams(location.search);
    const ids = params.get('ids');
    return ids ? ids.split(',').filter(Boolean) : [];
  }, [location.search]);

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        if (problemIds.length === 0) {
          setItems([]);
          return;
        }
        const data = await fetchProblemsByIds(problemIds);
        setItems(data);
      } catch (e) {
        setError(e instanceof Error ? e.message : '문제를 불러오지 못했습니다.');
      } finally {
        setLoading(false);
      }
    })();
  }, [problemIds]);

  if (loading) return <div className="text-center text-slate-600 py-10">불러오는 중...</div>;
  if (error) return <div className="text-center text-red-700 py-10">{error}</div>;
  if (!items || items.length === 0) {
    return (
      <div className="text-center py-10">
        <p className="text-slate-600 mb-4">선택된 문제가 없습니다.</p>
        <button onClick={() => navigate('/stats')} className="px-4 py-2 bg-indigo-600 text-white rounded">통계로 돌아가기</button>
      </div>
    );
  }

  const initial: AnalysisResults = { items };

  return (
    <div className="mx-auto bg-white rounded-2xl shadow-lg p-4 sm:p-6 md:p-8 border border-slate-200 max-w-full lg:max-w-5xl">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-2xl font-bold">다시 풀어보기 ({items.length}문항)</h2>
        <button onClick={() => navigate('/stats')} className="px-3 py-1 text-sm bg-gray-200 rounded">뒤로</button>
      </div>
      <MultiProblemEditor
        initial={initial}
        hideMarking
        hideClassification
        hideReport
        hideSubmit
      />
    </div>
  );
};

export default RetryProblemsPage;


