import React from 'react';
import type { GeneratedProblem } from '../../types';
import { useLanguage } from '../../contexts/LanguageContext';
import { getTranslation } from '../../utils/translations';

interface Props {
  problem: GeneratedProblem;
  selectedAnswer: string;
  onSelect: (answer: string) => void;
}

export const AnswerInput: React.FC<Props> = ({ problem, selectedAnswer, onSelect }) => {
  const { language } = useLanguage();
  const t = getTranslation(language);
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
        placeholder={t.assignments.essayPlaceholder}
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
      placeholder={t.assignments.shortAnswerPlaceholder}
      className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-sm"
    />
  );
};

// OX 값 정규화: 'O'/'X' 입력과 'true'/'false'(및 흔한 변형) 정답 형식을 통일
// O = 참(true), X = 거짓(false). 인식 불가 값은 null
export function normalizeOX(value: string | null | undefined): 'O' | 'X' | null {
  if (value == null) return null;
  const v = value.trim().toLowerCase();
  if (['o', '○', 'true', 't', 'yes', 'y', '1', '참', '맞음', '정답'].includes(v)) return 'O';
  if (['x', '×', 'false', 'f', 'no', 'n', '0', '거짓', '틀림', '오답'].includes(v)) return 'X';
  return null;
}

export function checkAnswer(problem: GeneratedProblem, answer: string): boolean | null {
  const type = problem.problem_type ?? 'multiple_choice';

  if (type === 'essay') return null;

  if (type === 'multiple_choice') {
    const idx = problem.correct_answer_index;
    if (idx === null || idx === undefined) return answer === problem.correct_answer;
    return answer === problem.choices[idx]?.text;
  }

  if (type === 'ox') {
    const correct = normalizeOX(problem.correct_answer);
    if (correct === null) return null; // 정답 미설정 → 채점 불가(미채점)
    return normalizeOX(answer) === correct;
  }

  // short_answer
  return problem.correct_answer?.trim().toLowerCase() === answer.trim().toLowerCase();
}
