import React, { useState } from 'react';
import { useLanguage } from '../../contexts/LanguageContext';
import { getTranslation } from '../../utils/translations';
import { requestEssayGrading, type EssayGradingSuggestion } from '../../services/gradeEssay';
import type { AssignmentResponse } from '../../types';

interface ProblemInfo {
  problem_id: string;
  order_index: number;
  problem?: { stem: string; problem_type?: string };
}

interface Props {
  problems: ProblemInfo[];
  responses: AssignmentResponse[];
  // 과제 작성자의 수동 채점 콜백 — 미전달 시 읽기 전용 표시
  onGrade?: (responseId: string, isCorrect: boolean) => Promise<void> | void;
}

interface AiState {
  loading?: boolean;
  suggestion?: EssayGradingSuggestion;
  error?: string;
}

export const AssignmentResponseTable: React.FC<Props> = ({ problems, responses, onGrade }) => {
  const { language } = useLanguage();
  const t = getTranslation(language);
  const [aiStates, setAiStates] = useState<Record<string, AiState>>({});
  const [gradingId, setGradingId] = useState<string | null>(null);

  const studentLabel = (r: AssignmentResponse) =>
    r.student_name || r.student_email || `${r.student_id.slice(0, 8)}...`;

  const handleAiSuggest = async (responseId: string) => {
    setAiStates(prev => ({ ...prev, [responseId]: { loading: true } }));
    try {
      const suggestion = await requestEssayGrading(responseId, language);
      setAiStates(prev => ({ ...prev, [responseId]: { suggestion } }));
    } catch (e) {
      console.error('AI grading suggestion failed:', e);
      setAiStates(prev => ({ ...prev, [responseId]: { error: t.assignments.aiSuggestFailed } }));
    }
  };

  const handleGrade = async (responseId: string, isCorrect: boolean) => {
    if (!onGrade) return;
    setGradingId(responseId);
    try {
      await onGrade(responseId, isCorrect);
    } finally {
      setGradingId(null);
    }
  };

  const verdictLabel = (verdict: EssayGradingSuggestion['verdict']) =>
    verdict === 'correct' ? t.assignments.aiVerdictCorrect
      : verdict === 'incorrect' ? t.assignments.aiVerdictIncorrect
        : t.assignments.aiVerdictUncertain;

  const gradeButton = (r: AssignmentResponse, isCorrect: boolean) => {
    const active = r.is_correct === isCorrect;
    return (
      <button
        onClick={() => handleGrade(r.id, isCorrect)}
        disabled={gradingId === r.id || active}
        className={`inline-flex min-h-[40px] items-center justify-center px-3 py-0.5 text-xs rounded transition-colors disabled:opacity-60 sm:min-h-0 sm:px-2 ${active
          ? isCorrect
            ? 'bg-green-600 text-white'
            : 'bg-red-500 text-white'
          : 'bg-slate-200 dark:bg-slate-600 text-slate-700 dark:text-slate-200 hover:bg-slate-300 dark:hover:bg-slate-500'
          }`}
      >
        {isCorrect ? t.assignments.markCorrect : t.assignments.markWrong}
      </button>
    );
  };

  return (
    <div className="space-y-3 sm:space-y-4">
      {problems.map((p, i) => {
        const relatedResponses = responses.filter(r => r.problem_id === p.problem_id);
        const isEssay = p.problem?.problem_type === 'essay';
        return (
          <div key={p.problem_id} className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-3 sm:p-4">
            <p className="font-medium text-slate-800 dark:text-slate-200 mb-2 sm:mb-3 break-words">
              {i + 1}. {p.problem?.stem ?? t.assignments.noProblemInfo}
            </p>
            {relatedResponses.length === 0 ? (
              <p className="text-sm text-slate-400">{t.assignments.noResponsesYet}</p>
            ) : (
              <div className="space-y-1">
                {relatedResponses.map(r => {
                  const ai = aiStates[r.id] || {};
                  return (
                    <div key={r.id || r.student_id} data-testid="assignment-response-row" className="p-2 rounded-lg bg-slate-50 dark:bg-slate-700/50">
                      <div className="flex flex-wrap items-center justify-between gap-2 text-sm sm:flex-nowrap">
                        <span className="text-slate-600 dark:text-slate-300 shrink-0">{studentLabel(r)}</span>
                        {/* 답안은 모바일에서 제 줄을 통째로 쓴다(basis-full → 랩 컨테이너에서 한 줄 차지).
                            원래 `flex-1 truncate`는 답안을 **한 줄로 잘랐고** 복구 수단이 title 툴팁뿐이었다.
                            터치에는 hover가 없으므로, 바로 옆 채점 버튼과 합쳐지면
                            "읽을 수 없는 답안을 정오 판정하라"는 화면이 된다.
                            데스크톱은 조밀한 표를 유지해야 하므로 sm:부터 원래대로 한 줄이다.
                            truncate 대신 line-clamp 계열을 쓰는 이유: 같은 계열이라 `sm:line-clamp-1`이
                            확실히 덮는다. truncate는 overflow/white-space를 따로 건드려 계열이 달라
                            어느 쪽이 이기는지가 Tailwind 출력 순서에 의존한다. */}
                        <span className="text-slate-700 dark:text-slate-200 basis-full sm:flex-1 line-clamp-2 sm:line-clamp-1 break-words" title={r.answer ?? ''}>{r.answer}</span>
                        <span data-testid="response-verdict" className={r.is_correct ? 'text-green-600' : r.is_correct === false ? 'text-red-500' : 'text-slate-400'}>
                          {r.is_correct ? t.stats.correct : r.is_correct === false ? t.stats.incorrect : t.assignments.notGraded}
                        </span>
                        <span className="text-slate-400 shrink-0">{t.assignments.secondsSuffix.replace('{seconds}', String(r.time_spent_seconds ?? 0))}</span>
                        {onGrade && (
                          <span className="flex gap-1 shrink-0">
                            {gradeButton(r, true)}
                            {gradeButton(r, false)}
                          </span>
                        )}
                      </div>
                      {onGrade && isEssay && (
                        <div className="mt-2 text-xs">
                          {!ai.suggestion && (
                            <button
                              onClick={() => handleAiSuggest(r.id)}
                              disabled={ai.loading}
                              className="inline-flex min-h-[40px] items-center justify-center px-3 py-0.5 rounded sm:min-h-0 sm:px-2 bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-200 dark:hover:bg-indigo-900/60 transition-colors disabled:opacity-60"
                            >
                              {ai.loading ? t.assignments.aiSuggesting : t.assignments.aiSuggest}
                            </button>
                          )}
                          {ai.error && <span className="ml-2 text-red-500">{ai.error}</span>}
                          {ai.suggestion && (
                            <div className="p-2 rounded break-words bg-indigo-50 dark:bg-indigo-900/30 text-slate-700 dark:text-slate-200">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className={`font-semibold ${ai.suggestion.verdict === 'correct' ? 'text-green-600'
                                  : ai.suggestion.verdict === 'incorrect' ? 'text-red-500' : 'text-yellow-600'
                                  }`}>
                                  {verdictLabel(ai.suggestion.verdict)}
                                </span>
                                {ai.suggestion.verdict !== 'uncertain' && (
                                  <button
                                    onClick={() => handleGrade(r.id, ai.suggestion!.verdict === 'correct')}
                                    disabled={gradingId === r.id}
                                    className="inline-flex min-h-[40px] items-center justify-center px-3 py-0.5 rounded sm:min-h-0 sm:px-2 bg-indigo-600 text-white hover:bg-indigo-700 transition-colors disabled:opacity-60"
                                  >
                                    {t.assignments.applySuggestion}
                                  </button>
                                )}
                              </div>
                              {ai.suggestion.feedback && (
                                <p className="mt-1 whitespace-pre-wrap break-words">{ai.suggestion.feedback}</p>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};
