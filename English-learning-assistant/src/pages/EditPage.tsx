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
    // 저장이 실패해도 예외를 삼키면 화면은 그대로인데 통계로 넘어가 버려
    // 사용자는 저장된 줄 안다. 실패는 실패대로 알리고 페이지에 남는다.
    try {
      await updateProblemLabels(sessionId, items);
      navigate('/stats');
    } catch (e) {
      alert(translateError(e, language, t, t.edit.saveError));
    }
  };

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto bg-white dark:bg-slate-800 rounded-2xl shadow-lg p-3 sm:p-6 md:p-8 border border-slate-200 dark:border-slate-700">
        <p className="text-center text-slate-600 dark:text-slate-400">{t.common.loading}</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="max-w-4xl mx-auto bg-white dark:bg-slate-800 rounded-2xl shadow-lg p-3 sm:p-6 md:p-8 border border-slate-200 dark:border-slate-700">
        <p className="text-center text-red-600 dark:text-red-400">{error || t.edit.notFound}</p>
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
    <div className="max-w-4xl mx-auto bg-white dark:bg-slate-800 rounded-2xl shadow-lg p-3 sm:p-6 md:p-8 border border-slate-200 dark:border-slate-700">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4 sm:mb-6">
        <h2 className="text-lg sm:text-2xl font-bold text-slate-900 dark:text-white">{t.edit.title}</h2>
        <button
          onClick={() => navigate('/stats')}
          className="px-2 py-2 sm:px-4 text-sm sm:text-base text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 underline"
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

