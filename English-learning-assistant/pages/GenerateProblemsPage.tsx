import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../services/supabaseClient';
import { useLanguage } from '../contexts/LanguageContext';
import { getTranslation } from '../utils/translations';
import { getCurrentUserId } from '../services/db';
import { TestSheetView } from '../components/TestSheetView';

type ProblemType = 'multiple_choice' | 'short_answer' | 'essay' | 'ox';

interface ProblemCount {
  multiple_choice: number;
  short_answer: number;
  essay: number;
  ox: number;
}

export const GenerateProblemsPage: React.FC = () => {
  const { language } = useLanguage();
  const t = getTranslation(language);
  const navigate = useNavigate();
  const [selectedType, setSelectedType] = useState<ProblemType>('multiple_choice');
  const [problemCounts, setProblemCounts] = useState<ProblemCount>({
    multiple_choice: 5,
    short_answer: 3,
    essay: 2,
    ox: 5,
  });
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generatedProblems, setGeneratedProblems] = useState<any[]>([]);
  const [showTestSheet, setShowTestSheet] = useState(false);

  // 문제 수 조절 함수 (상하 화살표)
  const adjustCount = (type: ProblemType, delta: number) => {
    setProblemCounts(prev => ({
      ...prev,
      [type]: Math.max(1, Math.min(50, prev[type] + delta))
    }));
  };

  // 문제 수 직접 입력
  const handleCountChange = (type: ProblemType, value: string) => {
    const num = parseInt(value, 10);
    if (!isNaN(num) && num >= 1 && num <= 50) {
      setProblemCounts(prev => ({
        ...prev,
        [type]: num
      }));
    }
  };

  const handleGenerate = async () => {
    const count = problemCounts[selectedType];
    if (count < 1) {
      setError(language === 'ko' ? '문제 수는 1개 이상이어야 합니다.' : 'Problem count must be at least 1.');
      return;
    }

    setIsGenerating(true);
    setError(null);

    try {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) {
        setError(language === 'ko' ? '로그인이 필요합니다.' : 'Login required.');
        setIsGenerating(false);
        return;
      }

      const functionUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-problems-by-type`;
      
      const response = await fetch(functionUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`,
        },
        body: JSON.stringify({
          problemType: selectedType,
          problemCount: count,
          userId: userData.user.id,
          language: language,
          // classification은 선택사항이므로 나중에 추가 가능
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP error! status: ${response.status}, ${errorText}`);
      }

      const result = await response.json();
      
      if (result.success) {
        setGeneratedProblems(result.problems || []);
        setShowTestSheet(true);
      } else {
        throw new Error(result.error || '문제 생성 실패');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : (language === 'ko' ? '문제 생성 중 오류가 발생했습니다.' : 'An error occurred while generating problems.'));
    } finally {
      setIsGenerating(false);
    }
  };

  if (showTestSheet && generatedProblems.length > 0) {
    return (
      <div className="max-w-6xl mx-auto">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-2xl font-bold text-slate-800 dark:text-slate-200">
            {language === 'ko' ? '생성된 시험지' : 'Generated Test Sheet'}
          </h2>
          <button
            onClick={() => {
              setShowTestSheet(false);
              setGeneratedProblems([]);
            }}
            className="px-4 py-2 bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-lg hover:bg-slate-300 dark:hover:bg-slate-600 transition-colors"
          >
            {language === 'ko' ? '새로 생성' : 'Generate New'}
          </button>
        </div>
        <TestSheetView problems={generatedProblems} problemType={selectedType} />
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto bg-white dark:bg-slate-800 rounded-2xl shadow-lg p-6 md:p-8 border border-slate-200 dark:border-slate-700">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-slate-800 dark:text-slate-200 mb-2">
          {language === 'ko' ? '문제 생성' : 'Generate Problems'}
        </h2>
        <p className="text-slate-600 dark:text-slate-400">
          {language === 'ko' 
            ? '문제 유형을 선택하고 문제 수를 입력한 후 생성 버튼을 클릭하세요.'
            : 'Select problem type and enter the number of problems, then click generate.'}
        </p>
      </div>

      {/* 문제 유형 선택 */}
      <div className="mb-6">
        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-3">
          {language === 'ko' ? '문제 유형' : 'Problem Type'}
        </label>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <button
            type="button"
            onClick={() => setSelectedType('multiple_choice')}
            className={`px-4 py-3 rounded-lg font-medium transition-colors ${
              selectedType === 'multiple_choice'
                ? 'bg-indigo-600 dark:bg-indigo-500 text-white'
                : 'bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-300 dark:hover:bg-slate-600'
            }`}
          >
            {language === 'ko' ? '객관식' : 'Multiple Choice'}
          </button>
          <button
            type="button"
            onClick={() => setSelectedType('short_answer')}
            className={`px-4 py-3 rounded-lg font-medium transition-colors ${
              selectedType === 'short_answer'
                ? 'bg-indigo-600 dark:bg-indigo-500 text-white'
                : 'bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-300 dark:hover:bg-slate-600'
            }`}
          >
            {language === 'ko' ? '단답형' : 'Short Answer'}
          </button>
          <button
            type="button"
            onClick={() => setSelectedType('essay')}
            className={`px-4 py-3 rounded-lg font-medium transition-colors ${
              selectedType === 'essay'
                ? 'bg-indigo-600 dark:bg-indigo-500 text-white'
                : 'bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-300 dark:hover:bg-slate-600'
            }`}
          >
            {language === 'ko' ? '서술형' : 'Essay'}
          </button>
          <button
            type="button"
            onClick={() => setSelectedType('ox')}
            className={`px-4 py-3 rounded-lg font-medium transition-colors ${
              selectedType === 'ox'
                ? 'bg-indigo-600 dark:bg-indigo-500 text-white'
                : 'bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-300 dark:hover:bg-slate-600'
            }`}
          >
            {language === 'ko' ? 'O/X' : 'True/False'}
          </button>
        </div>
      </div>

      {/* 문제 수 입력 */}
      <div className="mb-6">
        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
          {language === 'ko' ? '문제 수' : 'Number of Problems'}
        </label>
        <div className="flex items-center gap-3">
          <div className="flex items-center border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700">
            <button
              type="button"
              onClick={() => adjustCount(selectedType, -1)}
              className="px-3 py-2 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-600 rounded-l-lg"
              disabled={problemCounts[selectedType] <= 1}
            >
              ↓
            </button>
            <input
              type="number"
              min="1"
              max="50"
              value={problemCounts[selectedType]}
              onChange={(e) => handleCountChange(selectedType, e.target.value)}
              className="w-20 px-3 py-2 text-center border-0 focus:ring-2 focus:ring-indigo-500 dark:focus:ring-indigo-400 bg-transparent text-slate-900 dark:text-slate-200"
            />
            <button
              type="button"
              onClick={() => adjustCount(selectedType, 1)}
              className="px-3 py-2 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-600 rounded-r-lg"
              disabled={problemCounts[selectedType] >= 50}
            >
              ↑
            </button>
          </div>
          <span className="text-sm text-slate-600 dark:text-slate-400">
            {language === 'ko' ? `(1-50개)` : '(1-50)'}
          </span>
        </div>
      </div>

      {/* 생성 버튼 */}
      <div className="mb-6">
        <button
          onClick={handleGenerate}
          disabled={isGenerating || problemCounts[selectedType] < 1}
          className="w-full px-6 py-3 bg-indigo-600 dark:bg-indigo-500 text-white rounded-lg font-semibold hover:bg-indigo-700 dark:hover:bg-indigo-600 disabled:bg-slate-400 dark:disabled:bg-gray-600 disabled:cursor-not-allowed transition-colors"
        >
          {isGenerating 
            ? (language === 'ko' ? '생성 중...' : 'Generating...')
            : (language === 'ko' ? '문제 생성' : 'Generate Problems')}
        </button>
      </div>

      {error && (
        <div className="mb-6 p-4 bg-red-100 dark:bg-red-900/30 border border-red-300 dark:border-red-800 text-red-800 dark:text-red-200 rounded-lg">
          {error}
        </div>
      )}

      {/* 문제 유형별 설명 */}
      <div className="mt-6 p-4 bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800 rounded-lg">
        <h3 className="text-sm font-semibold text-blue-800 dark:text-blue-200 mb-2">
          {language === 'ko' ? '문제 유형 설명' : 'Problem Type Description'}
        </h3>
        <ul className="text-sm text-blue-700 dark:text-blue-300 space-y-1">
          {selectedType === 'multiple_choice' && (
            <li>{language === 'ko' ? '• 객관식: 5지선다형 문제' : '• Multiple Choice: 5-choice questions'}</li>
          )}
          {selectedType === 'short_answer' && (
            <li>{language === 'ko' ? '• 단답형: 1-3단어로 답하는 문제' : '• Short Answer: Questions answered in 1-3 words'}</li>
          )}
          {selectedType === 'essay' && (
            <li>{language === 'ko' ? '• 서술형: 긴 답변을 요구하는 문제' : '• Essay: Questions requiring detailed written answers'}</li>
          )}
          {selectedType === 'ox' && (
            <li>{language === 'ko' ? '• O/X: 참/거짓을 판단하는 문제' : '• True/False: Questions requiring true/false judgment'}</li>
          )}
        </ul>
      </div>
    </div>
  );
};

