import React from 'react';
import { useLanguage } from '../../contexts/LanguageContext';
import { getTranslation } from '../../utils/translations';
import type { AssignmentResponse } from '../../types';

interface ProblemInfo {
  problem_id: string;
  order_index: number;
  problem?: { stem: string };
}

interface Props {
  problems: ProblemInfo[];
  responses: AssignmentResponse[];
}

export const AssignmentResponseTable: React.FC<Props> = ({ problems, responses }) => {
  const { language } = useLanguage();
  const t = getTranslation(language);
  return (
    <div className="space-y-4">
      {problems.map((p, i) => {
        const relatedResponses = responses.filter(r => r.problem_id === p.problem_id);
        return (
          <div key={p.problem_id} className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-4">
            <p className="font-medium text-slate-800 dark:text-slate-200 mb-3">
              {i + 1}. {p.problem?.stem ?? t.assignments.noProblemInfo}
            </p>
            {relatedResponses.length === 0 ? (
              <p className="text-sm text-slate-400">{t.assignments.noResponsesYet}</p>
            ) : (
              <div className="space-y-1">
                {relatedResponses.map(r => (
                  <div key={r.id || r.student_id} className="flex items-center justify-between text-sm p-2 rounded-lg bg-slate-50 dark:bg-slate-700/50">
                    <span className="text-slate-600 dark:text-slate-300">{r.student_id.slice(0, 8)}...</span>
                    <span className="text-slate-700 dark:text-slate-200">{r.answer}</span>
                    <span className={r.is_correct ? 'text-green-600' : r.is_correct === false ? 'text-red-500' : 'text-slate-400'}>
                      {r.is_correct ? t.stats.correct : r.is_correct === false ? t.stats.incorrect : t.assignments.notGraded}
                    </span>
                    <span className="text-slate-400">{t.assignments.secondsSuffix.replace('{seconds}', String(r.time_spent_seconds ?? 0))}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};
