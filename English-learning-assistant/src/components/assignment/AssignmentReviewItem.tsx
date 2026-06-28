import React from 'react';
import type { GeneratedProblem, AssignmentResponse } from '../../types';
import { useLanguage } from '../../contexts/LanguageContext';
import { getTranslation } from '../../utils/translations';

interface Props {
  problem: GeneratedProblem;
  response?: AssignmentResponse;
  index?: number;
}

// 정답 선택지 인덱스 산출: correct_answer_index 우선, 없으면 is_correct 플래그, 그래도 없으면 correct_answer 텍스트 매칭
function getCorrectChoiceIndex(problem: GeneratedProblem): number | null {
  if (problem.correct_answer_index !== null && problem.correct_answer_index !== undefined) {
    return problem.correct_answer_index;
  }
  const byFlag = problem.choices.findIndex((c) => c.is_correct);
  if (byFlag >= 0) return byFlag;
  if (problem.correct_answer != null) {
    const byText = problem.choices.findIndex((c) => c.text === problem.correct_answer);
    if (byText >= 0) return byText;
  }
  return null;
}

export const AssignmentReviewItem: React.FC<Props> = ({ problem, response, index }) => {
  const { language } = useLanguage();
  const t = getTranslation(language);
  const type = problem.problem_type ?? 'multiple_choice';
  const myAnswer = response?.answer ?? '';
  const isCorrect = response?.is_correct;

  const badge =
    isCorrect === true ? (
      <span className="shrink-0 px-2.5 py-1 rounded-full bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 text-xs font-medium">
        {t.assignments.markCorrect}
      </span>
    ) : isCorrect === false ? (
      <span className="shrink-0 px-2.5 py-1 rounded-full bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 text-xs font-medium">
        {t.assignments.markWrong}
      </span>
    ) : (
      <span className="shrink-0 px-2.5 py-1 rounded-full bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 text-xs font-medium">
        {t.assignments.notGraded}
      </span>
    );

  const correctIdx = type === 'multiple_choice' ? getCorrectChoiceIndex(problem) : null;

  return (
    <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-5 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <p className="font-medium text-slate-800 dark:text-slate-200">
          {index != null ? `${index + 1}. ` : ''}
          {problem.stem}
        </p>
        {badge}
      </div>

      {problem.passage && (
        <div className="p-4 bg-slate-50 dark:bg-slate-900/40 border-l-4 border-indigo-400 dark:border-indigo-600 rounded-r-lg">
          <div className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 mb-2 uppercase tracking-wide">
            {t.assignments.passage}
          </div>
          <p className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed whitespace-pre-wrap">
            {problem.passage}
          </p>
        </div>
      )}

      {type === 'multiple_choice' ? (
        <div className="space-y-2">
          {problem.choices.map((c, i) => {
            const isAnswerChoice = correctIdx === i;
            const isMine = myAnswer === c.text;
            let cls = 'border-slate-200 dark:border-slate-600 text-slate-700 dark:text-slate-300';
            if (isAnswerChoice) {
              cls = 'border-green-500 bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300';
            } else if (isMine) {
              cls = 'border-red-400 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300';
            }
            return (
              <div key={i} className={`flex items-center gap-2 p-3 rounded-xl border text-sm ${cls}`}>
                <span className="font-medium">{i + 1}.</span>
                <span className="flex-1">{c.text}</span>
                {isAnswerChoice && (
                  <span className="shrink-0 text-xs font-semibold">✓ {t.assignments.correctAnswer}</span>
                )}
                {isMine && !isAnswerChoice && (
                  <span className="shrink-0 text-xs font-semibold">✗ {t.assignments.yourAnswer}</span>
                )}
                {isMine && isAnswerChoice && (
                  <span className="shrink-0 text-xs font-semibold">({t.assignments.yourAnswer})</span>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="space-y-2 text-sm">
          <div className="flex flex-wrap gap-x-2 gap-y-1">
            <span className="font-medium text-slate-500 dark:text-slate-400">{t.assignments.yourAnswer}:</span>
            <span
              className={`whitespace-pre-wrap ${
                isCorrect === false ? 'text-red-600 dark:text-red-400' : 'text-slate-800 dark:text-slate-200'
              }`}
            >
              {myAnswer || t.assignments.noAnswerSubmitted}
            </span>
          </div>
          {type !== 'essay' && problem.correct_answer != null && (
            <div className="flex flex-wrap gap-x-2 gap-y-1">
              <span className="font-medium text-slate-500 dark:text-slate-400">{t.assignments.correctAnswer}:</span>
              <span className="text-green-700 dark:text-green-400 whitespace-pre-wrap">{problem.correct_answer}</span>
            </div>
          )}
          {type === 'essay' && problem.guidelines && (
            <div className="flex flex-wrap gap-x-2 gap-y-1">
              <span className="font-medium text-slate-500 dark:text-slate-400">{t.assignments.gradingGuide}:</span>
              <span className="text-slate-700 dark:text-slate-300 whitespace-pre-wrap">{problem.guidelines}</span>
            </div>
          )}
        </div>
      )}

      {problem.explanation && (
        <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-900/30">
          <div className="text-xs font-semibold text-amber-700 dark:text-amber-400 mb-1">
            {t.assignments.explanationLabel}
          </div>
          <p className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed whitespace-pre-wrap">
            {problem.explanation}
          </p>
        </div>
      )}
    </div>
  );
};
