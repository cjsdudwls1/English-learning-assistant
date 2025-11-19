import React, { useCallback, useMemo } from 'react';
import { GeneratedProblemCard } from './GeneratedProblemCard';
import type { GeneratedProblemResult } from './GeneratedProblemCard';
import type { GeneratedProblem } from '../types';
import { getTranslation } from '../utils/translations';

interface StatsGeneratedProblemsProps {
  language: 'ko' | 'en';
  generatedProblems: GeneratedProblem[];
  currentProblemIndex: number;
  quizResults: (GeneratedProblemResult | null)[];
  showResultSummary: boolean;
  onProblemResult: (problemIndex: number, result: GeneratedProblemResult) => void;
  onNextProblem: () => void;
  onClose: () => void;
}

export const StatsGeneratedProblems: React.FC<StatsGeneratedProblemsProps> = ({
  language,
  generatedProblems,
  currentProblemIndex,
  quizResults,
  showResultSummary,
  onProblemResult,
  onNextProblem,
  onClose,
}) => {
  const t = getTranslation(language);

  const summaryStats = useMemo(() => {
    if (!showResultSummary || generatedProblems.length === 0) {
      return null;
    }

    const validResults = quizResults.filter((result): result is GeneratedProblemResult => Boolean(result));
    const correctCount = validResults.filter(result => result.isCorrect).length;
    const totalCount = generatedProblems.length;
    const totalTime = validResults.reduce((sum, result) => sum + (result?.timeSpentSeconds || 0), 0);

    return {
      correctCount,
      incorrectCount: totalCount - correctCount,
      totalCount,
      totalTime,
    };
  }, [generatedProblems.length, quizResults, showResultSummary]);

  const formatSeconds = useCallback((seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }, []);

  if (generatedProblems.length === 0) return null;

  return (
    <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-lg p-6 md:p-8 border border-slate-200 dark:border-slate-700">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-xl font-bold text-slate-800 dark:text-slate-200">
          {t.stats.generatedProblems} ({generatedProblems.length}{language === 'ko' ? '개' : ''})
        </h3>
        <button
          onClick={onClose}
          className="px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
        >
          {t.common.close}
        </button>
      </div>

      {!showResultSummary && (
        <div className="space-y-4">
          <GeneratedProblemCard
            key={currentProblemIndex}
            problem={generatedProblems[currentProblemIndex]}
            index={currentProblemIndex}
            problemId={generatedProblems[currentProblemIndex].id}
            isActive={true}
            onNext={onNextProblem}
            onResult={(result) => onProblemResult(currentProblemIndex, result)}
          />
          {generatedProblems.length > 1 && (
            <div className="text-center text-sm text-slate-500 dark:text-slate-400">
              {language === 'ko' 
                ? `문제 ${currentProblemIndex + 1} / ${generatedProblems.length}`
                : `Problem ${currentProblemIndex + 1} / ${generatedProblems.length}`}
            </div>
          )}
        </div>
      )}

      {showResultSummary && summaryStats && (
        <div className="space-y-4">
          <div className="p-4 bg-slate-50 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-700 rounded-lg flex flex-wrap items-center justify-between gap-3">
            <h4 className="text-lg font-semibold text-slate-800 dark:text-slate-200">
              {t.practice.summaryTitle}
            </h4>
            <div className="flex flex-wrap gap-4 text-sm text-slate-600 dark:text-slate-300">
              <span>{t.practice.correct}: {summaryStats.correctCount}</span>
              <span>{t.practice.incorrect}: {summaryStats.incorrectCount}</span>
              <span>{t.practice.timeSpent}: {formatSeconds(summaryStats.totalTime)}</span>
            </div>
          </div>

          <div className="space-y-4">
            {generatedProblems.map((problem, idx) => (
              <GeneratedProblemCard
                key={problem.id ?? idx}
                problem={problem}
                index={idx}
                problemId={problem.id}
                mode="review"
                result={quizResults[idx] ?? undefined}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

