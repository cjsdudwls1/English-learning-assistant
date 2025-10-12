import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import type { AnalysisResults, ProblemItem } from '../types';
import { MultiProblemEditor } from '../components/MultiProblemEditor';
import { saveFinalLabels } from '../services/saveFlow';

export const ReviewPage: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const state = location.state as { imageFile: File; results: AnalysisResults } | undefined;
  const [data, setData] = useState<AnalysisResults | null>(state?.results ?? null);

  useEffect(() => {
    if (!state?.imageFile || !state?.results) {
      navigate('/upload');
    }
  }, [state, navigate]);

  if (!state?.imageFile || !data) return null;

  const handleSubmit = async (items: ProblemItem[]) => {
    await saveFinalLabels(state.imageFile, items);
    navigate('/stats');
  };

  return (
    <div className="max-w-4xl mx-auto bg-white rounded-2xl shadow-lg p-6 md:p-8 border border-slate-200">
      <h2 className="text-2xl font-bold mb-4">분석 결과 검수 및 라벨링</h2>
      <MultiProblemEditor initial={data} onSubmit={handleSubmit} onChange={(items)=> setData({ items })} />
    </div>
  );
};


