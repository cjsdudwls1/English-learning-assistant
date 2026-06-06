import React, { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { MultiProblemEditor } from '../components/MultiProblemEditor';
import type { AnalysisResults, ProblemItem } from '../types';
import { fetchProblemsByIds } from '../services/db';
import { useLanguage } from '../contexts/LanguageContext';
import { getTranslation } from '../utils/translations';
import { translateError } from '../utils/errorI18n';

export const RetryProblemsPage: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { language } = useLanguage();
  const t = getTranslation(language);
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
        setError(translateError(e, language, t, t.edit.loadError));
      } finally {
        setLoading(false);
      }
    })();
  }, [problemIds]);

  if (loading) return <div className="text-center text-slate-600 py-10">{t.common.loading}</div>;
  if (error) return <div className="text-center text-red-700 py-10">{error}</div>;
  if (!items || items.length === 0) {
    return (
      <div className="text-center py-10">
        <p className="text-slate-600 mb-4">{t.retry.empty}</p>
        <button onClick={() => navigate('/stats')} className="px-4 py-2 bg-indigo-600 text-white rounded">{t.edit.backToStats}</button>
      </div>
    );
  }

  const initial: AnalysisResults = { items };

  return (
    <div className="mx-auto bg-white rounded-2xl shadow-lg p-4 sm:p-6 md:p-8 border border-slate-200 max-w-full lg:max-w-5xl">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-2xl font-bold">{t.retry.title} ({t.retry.itemCountUnit.replace('{count}', String(items.length))})</h2>
        <button onClick={() => navigate('/stats')} className="px-3 py-1 text-sm bg-gray-200 rounded">{t.session.back}</button>
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


