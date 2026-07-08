import React, { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import type { ProblemItem } from '../types';
import { fetchProblemsByIds, saveRetryAttempts, fetchRetryAttempts, type RetryAttempt } from '../services/db';
import { gradeRegisteredProblem } from '../utils/grading';
import { extractOptionDigits } from '../utils/gradingSafety';
import { useLanguage } from '../contexts/LanguageContext';
import { getTranslation } from '../utils/translations';
import { translateError } from '../utils/errorI18n';

// 보기 텍스트에 번호(①~⑨/1-9)가 없으면 원문자 번호를 붙여 답으로 저장 —
// gradeRegisteredProblem의 번호 비교 경로가 동작하도록 보장
const choiceAnswerText = (choiceText: string, idx: number): string => {
  if (extractOptionDigits(choiceText).size > 0) return choiceText;
  return idx < 9 ? `${String.fromCharCode(0x2460 + idx)} ${choiceText}` : choiceText;
};

export const RetryProblemsPage: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { language } = useLanguage();
  const t = getTranslation(language);
  const [items, setItems] = useState<ProblemItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [submitted, setSubmitted] = useState(false);
  const [results, setResults] = useState<Record<string, boolean | null>>({});
  const [saveError, setSaveError] = useState(false);
  const [history, setHistory] = useState<Record<string, RetryAttempt[]>>({});

  const problemIds = useMemo(() => {
    const params = new URLSearchParams(location.search);
    const ids = params.get('ids');
    return ids ? ids.split(',').filter(Boolean) : [];
  }, [location.search]);

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        // '틀린 문제만 다시 풀기'로 URL이 바뀌면 풀이 상태 리셋
        setAnswers({});
        setSubmitted(false);
        setResults({});
        setSaveError(false);
        if (problemIds.length === 0) {
          setItems([]);
          return;
        }
        const data = await fetchProblemsByIds(problemIds);
        setItems(data);
        fetchRetryAttempts(data.map(d => d.id).filter(Boolean) as string[])
          .then(setHistory)
          .catch((e) => console.error('Failed to load retry history:', e));
      } catch (e) {
        setError(translateError(e, language, t, t.edit.loadError));
      } finally {
        setLoading(false);
      }
    })();
  }, [problemIds]);

  const keyOf = (item: ProblemItem, index: number) => item.id ?? `idx-${index}`;

  const handleSubmit = async () => {
    if (!items) return;
    const newResults: Record<string, boolean | null> = {};
    items.forEach((item, index) => {
      const answer = answers[keyOf(item, index)] ?? '';
      newResults[keyOf(item, index)] = gradeRegisteredProblem(item, answer);
    });
    setResults(newResults);
    setSubmitted(true);

    // 재풀이 이력 저장 — 별도 테이블(retry_attempts), 기존 통계에 섞지 않음. 실패해도 결과는 표시.
    const savable = items
      .filter((item) => item.id && (answers[item.id] ?? '').trim() !== '')
      .map((item) => ({
        problemId: item.id!,
        answer: answers[item.id!],
        isCorrect: newResults[item.id!],
      }));
    if (savable.length > 0) {
      try {
        await saveRetryAttempts(savable);
      } catch (e) {
        console.error('Failed to save retry attempts:', e);
        setSaveError(true);
      }
    }
  };

  const handleRetryWrongOnly = () => {
    if (!items) return;
    const wrongIds = items
      .filter((item) => item.id && results[item.id] === false)
      .map((item) => item.id!);
    if (wrongIds.length > 0) navigate(`/retry?ids=${wrongIds.join(',')}`);
  };

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

  const answeredResults = Object.values(results);
  const correctCount = answeredResults.filter(r => r === true).length;
  const wrongCount = answeredResults.filter(r => r === false).length;
  const manualCount = answeredResults.filter(r => r === null).length;

  const resultBadge = (r: boolean | null | undefined, answered: boolean) => {
    if (!answered) return <span className="px-2 py-0.5 text-xs rounded bg-slate-300 dark:bg-slate-600 text-slate-700 dark:text-slate-200">{t.retry.notAnswered}</span>;
    if (r === true) return <span className="px-2 py-0.5 text-xs rounded bg-green-500 text-white">{t.stats.correct}</span>;
    if (r === false) return <span className="px-2 py-0.5 text-xs rounded bg-red-500 text-white">{t.stats.incorrect}</span>;
    return <span className="px-2 py-0.5 text-xs rounded bg-yellow-500 text-white">{t.retry.manualCheck}</span>;
  };

  return (
    <div className="mx-auto bg-white dark:bg-slate-800 rounded-2xl shadow-lg p-4 sm:p-6 md:p-8 border border-slate-200 dark:border-slate-700 max-w-full lg:max-w-5xl">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-2xl font-bold text-slate-800 dark:text-slate-200">{t.retry.title} ({t.retry.itemCountUnit.replace('{count}', String(items.length))})</h2>
        <button onClick={() => navigate('/stats')} className="px-3 py-1 text-sm bg-gray-200 dark:bg-slate-600 dark:text-slate-200 rounded">{t.session.back}</button>
      </div>

      {submitted && (
        <div className="mb-4 p-4 rounded-xl bg-indigo-50 dark:bg-indigo-900/30 border border-indigo-200 dark:border-indigo-800">
          <p className="font-semibold text-slate-800 dark:text-slate-200">
            {t.retry.resultSummary
              .replace('{correct}', String(correctCount))
              .replace('{wrong}', String(wrongCount))
              .replace('{manual}', String(manualCount))}
          </p>
          {saveError && <p className="mt-1 text-sm text-red-500">{t.retry.saveFailed}</p>}
          <div className="mt-3 flex flex-wrap gap-2">
            {wrongCount > 0 && (
              <button onClick={handleRetryWrongOnly} className="px-4 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700">
                {t.retry.retryWrongOnly}
              </button>
            )}
            <button onClick={() => navigate('/stats')} className="px-4 py-2 text-sm bg-slate-200 dark:bg-slate-600 text-slate-700 dark:text-slate-200 rounded-lg hover:bg-slate-300 dark:hover:bg-slate-500">
              {t.retry.generateSimilar}
            </button>
          </div>
        </div>
      )}

      <div className="space-y-5">
        {items.map((item, index) => {
          const key = keyOf(item, index);
          const answer = answers[key] ?? '';
          const answered = answer.trim() !== '';
          const result = results[key];
          const choices = item.문제_보기 || [];
          const attempts = item.id ? history[item.id] : undefined;

          return (
            <div key={key} className={`p-4 border-2 rounded-xl ${submitted
              ? result === true
                ? 'border-green-500 bg-green-50 dark:bg-green-900/20'
                : result === false
                  ? 'border-red-500 bg-red-50 dark:bg-red-900/20'
                  : answered
                    ? 'border-yellow-500 bg-yellow-50 dark:bg-yellow-900/20'
                    : 'border-slate-300 dark:border-slate-600'
              : 'border-slate-300 dark:border-slate-600'
              }`}>
              <div className="flex items-start justify-between gap-2 mb-2">
                <p className="font-semibold text-slate-800 dark:text-slate-200">
                  {index + 1}. {item.instruction || item.문제내용?.text}
                </p>
                <div className="flex items-center gap-2 shrink-0">
                  {attempts && attempts.length > 0 && (
                    <span className="text-xs text-slate-500 dark:text-slate-400">
                      {t.retry.previousAttempts}: {t.retry.attemptCountUnit.replace('{count}', String(attempts.length))}
                    </span>
                  )}
                  {submitted && resultBadge(result, answered)}
                </div>
              </div>

              {item.instruction && item.문제내용?.text && item.문제내용.text !== item.instruction && (
                <p className="mb-2 text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap">{item.문제내용.text}</p>
              )}

              {item.passage && (
                <div className="mb-3 p-3 bg-slate-50 dark:bg-slate-900/40 border-l-4 border-indigo-400 rounded-r-lg text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap">
                  {item.passage}
                </div>
              )}

              {choices.length > 0 ? (
                <div className="space-y-2">
                  {choices.map((choice, cIdx) => {
                    const value = choiceAnswerText(choice.text, cIdx);
                    const isSelected = answer === value;
                    return (
                      <button
                        key={cIdx}
                        onClick={() => !submitted && setAnswers(prev => ({ ...prev, [key]: value }))}
                        disabled={submitted}
                        className={`w-full text-left p-2.5 border-2 rounded-lg text-sm transition-colors ${isSelected
                          ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/30'
                          : 'border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600'
                          } ${submitted ? 'cursor-default' : ''} text-slate-700 dark:text-slate-300`}
                      >
                        {choice.text}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <input
                  type="text"
                  value={answer}
                  onChange={(e) => setAnswers(prev => ({ ...prev, [key]: e.target.value }))}
                  disabled={submitted}
                  placeholder={t.assignments.shortAnswerPlaceholder}
                  className="w-full px-3 py-2 border-2 border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-200"
                />
              )}

              {submitted && (
                <div className="mt-3 text-sm space-y-1">
                  {item.correct_answer && (
                    <p>
                      <span className="font-semibold text-slate-700 dark:text-slate-300">{t.assignments.correctAnswer}: </span>
                      <span className="text-green-600 dark:text-green-400 whitespace-pre-wrap">{item.correct_answer}</span>
                    </p>
                  )}
                  {result === null && answered && (
                    <p className="text-yellow-700 dark:text-yellow-300">{t.retry.manualCheckHint}</p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {!submitted && (
        <div className="mt-6 text-center">
          <button onClick={handleSubmit} className="px-8 py-3 bg-blue-600 text-white rounded-xl font-semibold hover:bg-blue-700 transition-colors">
            {t.retry.grade}
          </button>
        </div>
      )}
    </div>
  );
};

export default RetryProblemsPage;
