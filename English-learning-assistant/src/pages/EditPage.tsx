import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import type { ProblemItem } from '../types';
import { MultiProblemEditor } from '../components/MultiProblemEditor';
import { fetchSessionProblems, updateProblemLabels } from '../services/db';
import { useLanguage } from '../contexts/LanguageContext';
import { getTranslation } from '../utils/translations';
import { translateError } from '../utils/errorI18n';

export const EditPage: React.FC = () => {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const { language } = useLanguage();
  const t = getTranslation(language);
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
        setError(translateError(e, language, t, t.edit.loadError));
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
        <p className="text-center text-slate-600">{t.common.loading}</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="max-w-4xl mx-auto bg-white rounded-2xl shadow-lg p-6 md:p-8 border border-slate-200">
        <p className="text-center text-red-600">{error || t.edit.notFound}</p>
        <div className="text-center mt-4">
          <button
            onClick={() => navigate('/stats')}
            className="px-6 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
          >
            {t.edit.backToStats}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto bg-white rounded-2xl shadow-lg p-6 md:p-8 border border-slate-200">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold">{t.edit.title}</h2>
        <button
          onClick={() => navigate('/stats')}
          className="px-4 py-2 text-slate-600 hover:text-slate-800 underline"
        >
          {t.common.cancel}
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

