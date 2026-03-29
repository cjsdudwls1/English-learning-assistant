import React from 'react';
import type { GeneratedProblem } from '../../types';

interface Props {
  problem: GeneratedProblem;
  selectedAnswer: string;
  onSelect: (answer: string) => void;
}

export const AnswerInput: React.FC<Props> = ({ problem, selectedAnswer, onSelect }) => {
  const type = problem.problem_type ?? 'multiple_choice';

  if (type === 'multiple_choice') {
    return (
      <div className="space-y-2">
        {problem.choices.map((c, i) => (
          <button key={i} onClick={() => onSelect(c.text)}
            className={`w-full text-left p-3 rounded-xl border text-sm transition-colors ${selectedAnswer === c.text ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-300' : 'border-slate-200 dark:border-slate-600 hover:border-slate-400'}`}>
            {i + 1}. {c.text}
          </button>
        ))}
      </div>
    );
  }

  if (type === 'ox') {
    return (
      <div className="flex gap-3">
        {['O', 'X'].map((v) => (
          <button key={v} onClick={() => onSelect(v)}
            className={`flex-1 py-4 text-2xl font-bold rounded-xl border transition-colors ${selectedAnswer === v ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-300' : 'border-slate-200 dark:border-slate-600 hover:border-slate-400'}`}>
            {v}
          </button>
        ))}
      </div>
    );
  }

  if (type === 'essay') {
    return (
      <textarea
        value={selectedAnswer}
        onChange={(e) => onSelect(e.target.value)}
        placeholder="답변을 입력하세요..."
        rows={4}
        className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-sm resize-none"
      />
    );
  }

  // short_answer (default)
  return (
    <input
      type="text"
      value={selectedAnswer}
      onChange={(e) => onSelect(e.target.value)}
      placeholder="답을 입력하세요..."
      className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-sm"
    />
  );
};

export function checkAnswer(problem: GeneratedProblem, answer: string): boolean | null {
  const type = problem.problem_type ?? 'multiple_choice';

  if (type === 'essay') return null;

  if (type === 'multiple_choice') {
    const idx = problem.correct_answer_index;
    if (idx === null || idx === undefined) return answer === problem.correct_answer;
    return answer === problem.choices[idx]?.text;
  }

  if (type === 'ox') {
    return answer === problem.correct_answer;
  }

  // short_answer
  return problem.correct_answer?.trim().toLowerCase() === answer.trim().toLowerCase();
}
