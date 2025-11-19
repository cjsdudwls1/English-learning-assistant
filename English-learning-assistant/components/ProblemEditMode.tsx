import React, { useState, useEffect } from 'react';
import { supabase } from '../services/supabaseClient';
import { useLanguage } from '../contexts/LanguageContext';
import { getTranslation } from '../utils/translations';

type ProblemType = 'multiple_choice' | 'short_answer' | 'essay' | 'ox';

interface ProblemEditModeProps {
  problem: any;
  problemType: ProblemType;
  onSave: (updatedProblem: any) => void;
  onCancel: () => void;
}

export const ProblemEditMode: React.FC<ProblemEditModeProps> = ({
  problem,
  problemType,
  onSave,
  onCancel,
}) => {
  const { language } = useLanguage();
  const t = getTranslation(language);
  const [stem, setStem] = useState(problem.stem || '');
  const [choices, setChoices] = useState(problem.choices || []);
  const [correctAnswerIndex, setCorrectAnswerIndex] = useState(problem.correct_answer_index ?? null);
  const [correctAnswer, setCorrectAnswer] = useState(problem.correct_answer || '');
  const [guidelines, setGuidelines] = useState(problem.guidelines || '');
  const [isCorrect, setIsCorrect] = useState(problem.is_correct ?? null);
  const [explanation, setExplanation] = useState(problem.explanation || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    if (!problem.id) {
      setError(language === 'ko' ? '문제 ID가 없습니다.' : 'Problem ID is missing.');
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const updateData: any = {
        stem,
        explanation: explanation || null,
      };

      if (problemType === 'multiple_choice') {
        updateData.choices = choices;
        updateData.correct_answer_index = correctAnswerIndex;
      } else if (problemType === 'short_answer') {
        updateData.correct_answer = correctAnswer;
      } else if (problemType === 'essay') {
        updateData.guidelines = guidelines;
      } else if (problemType === 'ox') {
        updateData.is_correct = isCorrect;
      }

      const { error: updateError } = await supabase
        .from('generated_problems')
        .update(updateData)
        .eq('id', problem.id);

      if (updateError) throw updateError;

      onSave({ ...problem, ...updateData });
    } catch (e) {
      setError(e instanceof Error ? e.message : (language === 'ko' ? '저장 중 오류가 발생했습니다.' : 'An error occurred while saving.'));
    } finally {
      setSaving(false);
    }
  };

  const handleChoiceChange = (index: number, text: string) => {
    const newChoices = [...choices];
    newChoices[index] = { ...newChoices[index], text };
    setChoices(newChoices);
  };

  const handleAddChoice = () => {
    if (choices.length < 5) {
      setChoices([...choices, { text: '', is_correct: false }]);
    }
  };

  const handleRemoveChoice = (index: number) => {
    if (choices.length > 2) {
      const newChoices = choices.filter((_: any, i: number) => i !== index);
      setChoices(newChoices);
      if (correctAnswerIndex === index) {
        setCorrectAnswerIndex(null);
      } else if (correctAnswerIndex !== null && correctAnswerIndex > index) {
        setCorrectAnswerIndex(correctAnswerIndex - 1);
      }
    }
  };

  return (
    <div className="mb-6 p-4 border-2 border-indigo-500 dark:border-indigo-400 rounded-lg bg-indigo-50 dark:bg-indigo-900/20">
      <h3 className="text-lg font-semibold text-indigo-800 dark:text-indigo-200 mb-4">
        {language === 'ko' ? '문제 편집' : 'Edit Problem'}
      </h3>

      {/* 문제 본문 */}
      <div className="mb-4">
        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
          {language === 'ko' ? '문제 본문' : 'Problem Stem'}
        </label>
        <textarea
          value={stem}
          onChange={(e) => setStem(e.target.value)}
          className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-200 focus:ring-2 focus:ring-indigo-500 dark:focus:ring-indigo-400"
          rows={3}
        />
      </div>

      {/* 문제 유형별 입력 필드 */}
      {problemType === 'multiple_choice' && (
        <div className="mb-4">
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
            {language === 'ko' ? '선택지' : 'Choices'}
          </label>
          <div className="space-y-2">
            {choices.map((choice: any, index: number) => (
              <div key={index} className="flex items-center gap-2">
                <input
                  type="radio"
                  checked={correctAnswerIndex === index}
                  onChange={() => setCorrectAnswerIndex(index)}
                  className="w-4 h-4 text-indigo-600"
                />
                <input
                  type="text"
                  value={choice.text}
                  onChange={(e) => handleChoiceChange(index, e.target.value)}
                  className="flex-1 px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-200"
                  placeholder={`${String.fromCharCode(65 + index)}. ${language === 'ko' ? '선택지 입력' : 'Enter choice'}`}
                />
                {choices.length > 2 && (
                  <button
                    type="button"
                    onClick={() => handleRemoveChoice(index)}
                    className="px-3 py-2 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 rounded hover:bg-red-200 dark:hover:bg-red-900/50"
                  >
                    {language === 'ko' ? '삭제' : 'Delete'}
                  </button>
                )}
              </div>
            ))}
            {choices.length < 5 && (
              <button
                type="button"
                onClick={handleAddChoice}
                className="px-3 py-2 bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 rounded hover:bg-slate-200 dark:hover:bg-slate-600"
              >
                {language === 'ko' ? '+ 선택지 추가' : '+ Add Choice'}
              </button>
            )}
          </div>
        </div>
      )}

      {problemType === 'short_answer' && (
        <div className="mb-4">
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
            {language === 'ko' ? '정답' : 'Correct Answer'}
          </label>
          <input
            type="text"
            value={correctAnswer}
            onChange={(e) => setCorrectAnswer(e.target.value)}
            className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-200"
            placeholder={language === 'ko' ? '1-3단어로 입력' : 'Enter 1-3 words'}
          />
        </div>
      )}

      {problemType === 'essay' && (
        <div className="mb-4">
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
            {language === 'ko' ? '답변 가이드라인' : 'Guidelines'}
          </label>
          <textarea
            value={guidelines}
            onChange={(e) => setGuidelines(e.target.value)}
            className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-200"
            rows={3}
            placeholder={language === 'ko' ? '답변 가이드라인 입력' : 'Enter guidelines'}
          />
        </div>
      )}

      {problemType === 'ox' && (
        <div className="mb-4">
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
            {language === 'ko' ? '정답' : 'Correct Answer'}
          </label>
          <div className="flex gap-4">
            <label className="flex items-center gap-2">
              <input
                type="radio"
                checked={isCorrect === true}
                onChange={() => setIsCorrect(true)}
                className="w-4 h-4 text-indigo-600"
              />
              <span>O (True)</span>
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                checked={isCorrect === false}
                onChange={() => setIsCorrect(false)}
                className="w-4 h-4 text-indigo-600"
              />
              <span>X (False)</span>
            </label>
          </div>
        </div>
      )}

      {/* 해설 */}
      <div className="mb-4">
        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
          {language === 'ko' ? '해설' : 'Explanation'}
        </label>
        <textarea
          value={explanation}
          onChange={(e) => setExplanation(e.target.value)}
          className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-200"
          rows={2}
        />
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-100 dark:bg-red-900/30 border border-red-300 dark:border-red-800 text-red-800 dark:text-red-200 rounded text-sm">
          {error}
        </div>
      )}

      {/* 버튼 */}
      <div className="flex gap-3">
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-4 py-2 bg-indigo-600 dark:bg-indigo-500 text-white rounded-lg hover:bg-indigo-700 dark:hover:bg-indigo-600 disabled:bg-slate-400 disabled:cursor-not-allowed transition-colors"
        >
          {saving ? (language === 'ko' ? '저장 중...' : 'Saving...') : (language === 'ko' ? '저장' : 'Save')}
        </button>
        <button
          onClick={onCancel}
          className="px-4 py-2 bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-lg hover:bg-slate-300 dark:hover:bg-slate-600 transition-colors"
        >
          {language === 'ko' ? '취소' : 'Cancel'}
        </button>
      </div>
    </div>
  );
};

