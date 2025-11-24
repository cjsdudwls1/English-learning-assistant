import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../services/supabaseClient';
import { useLanguage } from '../contexts/LanguageContext';
import { getTranslation } from '../utils/translations';
import { getCurrentUserId } from '../services/db';
import { TestSheetView } from '../components/TestSheetView';
import { loadProblemsWithExisting } from '../services/problemLoader';
import type { GeneratedProblem } from '../types';

type ProblemType = 'multiple_choice' | 'short_answer' | 'essay' | 'ox';

interface ProblemCount {
  multiple_choice: number;
  short_answer: number;
  essay: number;
  ox: number;
}

// 문제 유형 레이블 헬퍼 함수
const getProblemTypeLabel = (type: string, language: 'ko' | 'en' = 'ko'): string => {
  const labels: Record<string, { ko: string; en: string }> = {
    multiple_choice: { ko: '객관식', en: 'Multiple Choice' },
    short_answer: { ko: '단답형', en: 'Short Answer' },
    essay: { ko: '서술형', en: 'Essay' },
    ox: { ko: 'O/X', en: 'True/False' },
  };
  return labels[type]?.[language] || type;
};

export const GenerateProblemsPage: React.FC = () => {
  const { language } = useLanguage();
  const t = getTranslation(language);
  const navigate = useNavigate();
  const [selectedType, setSelectedType] = useState<ProblemType>('multiple_choice');
  const [problemCounts, setProblemCounts] = useState<ProblemCount>({
    multiple_choice: 0,
    short_answer: 0,
    essay: 0,
    ox: 0,
  });
  const [isGenerating, setIsGenerating] = useState(false);
  const [isLoadingExisting, setIsLoadingExisting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generatedProblems, setGeneratedProblems] = useState<any[]>([]);
  const [showTestSheet, setShowTestSheet] = useState(false);
  const [progressMessage, setProgressMessage] = useState<string | null>(null);
  const [progressStage, setProgressStage] = useState<number>(0);
  const [progressDetails, setProgressDetails] = useState<any>(null);
  const [loadStats, setLoadStats] = useState<{
    existing: number;
    newlyGenerated: number;
  } | null>(null);
  
  // 기존 문제 불러오기 옵션
  const [useExistingProblems, setUseExistingProblems] = useState(true);
  const [excludeSolved, setExcludeSolved] = useState(false);
  const [excludeRecentDays, setExcludeRecentDays] = useState<number | null>(null);

  // 문제 수 조절 함수 (상하 화살표)
  const adjustCount = (type: ProblemType, delta: number) => {
    setProblemCounts(prev => ({
      ...prev,
      [type]: Math.max(0, Math.min(50, prev[type] + delta))
    }));
  };

  // 문제 수 직접 입력
  const handleCountChange = (type: ProblemType, value: string) => {
    const num = parseInt(value, 10);
    if (!isNaN(num) && num >= 0 && num <= 50) {
      setProblemCounts(prev => ({
        ...prev,
        [type]: num
      }));
    }
  };

  const handleLoadExistingProblems = async () => {
    const count = problemCounts[selectedType];
    if (count < 1) {
      setError(language === 'ko' ? '문제 수는 1개 이상이어야 합니다.' : 'Problem count must be at least 1.');
      return;
    }

    setIsLoadingExisting(true);
    setError(null);
    setProgressMessage(null);
    setProgressStage(0);
    setProgressDetails(null);
    setLoadStats(null);

    try {
      const userId = await getCurrentUserId();
      
      setProgressStage(1);
      setProgressMessage(language === 'ko' ? '1/3 단계: 기존 문제 검색 중...' : 'Step 1/3: Searching for existing problems...');

      const result = await loadProblemsWithExisting(
        {
          problemCounts: {
            [selectedType]: count,
            multiple_choice: selectedType === 'multiple_choice' ? count : 0,
            short_answer: selectedType === 'short_answer' ? count : 0,
            essay: selectedType === 'essay' ? count : 0,
            ox: selectedType === 'ox' ? count : 0,
          },
          language,
          excludeSolved,
          excludeRecentDays: excludeRecentDays || undefined,
          userId,
          exactMatchOnly: false,
        },
        (stage, message, details) => {
          setProgressStage(stage);
          setProgressMessage(message);
          setProgressDetails(details);
        }
      );

      console.log('[GenerateProblemsPage] 문제 불러오기 결과:', {
        total: result.problems.length,
        existing: result.stats.existing,
        newlyGenerated: result.stats.newlyGenerated,
        problems: result.problems.map(p => ({ id: p.id, _source: (p as any)._source })),
      });
      
      setLoadStats(result.stats);
      setGeneratedProblems(result.problems);
      setShowTestSheet(true);
      setProgressMessage(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : (language === 'ko' ? '문제 불러오기 중 오류가 발생했습니다.' : 'An error occurred while loading problems.'));
      setProgressMessage(null);
    } finally {
      setIsLoadingExisting(false);
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
        <TestSheetView 
          problems={generatedProblems.map(p => ({
            ...p,
            _source: (p as any)._source, // 출처 정보 유지
          }))} 
          problemType={selectedType} 
        />
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto bg-white dark:bg-slate-800 rounded-2xl shadow-lg p-6 md:p-8 border border-slate-200 dark:border-slate-700">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-slate-800 dark:text-slate-200 mb-2">
          {language === 'ko' ? '문제 생성' : 'Generate Problems'}
        </h2>
        <p className="text-slate-600 dark:text-slate-400 mb-4">
          {language === 'ko' 
            ? '문제 유형을 선택하고 문제 수를 입력한 후 생성 버튼을 클릭하세요.'
            : 'Select problem type and enter the number of problems, then click generate.'}
        </p>
        
        {/* 모드 선택 */}
        <div className="flex gap-2 mb-4">
          <button
            type="button"
            onClick={() => setUseExistingProblems(true)}
            className={`px-4 py-2 rounded-lg font-medium transition-colors ${
              useExistingProblems
                ? 'bg-green-600 dark:bg-green-500 text-white'
                : 'bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-300 dark:hover:bg-slate-600'
            }`}
          >
            {language === 'ko' ? '기존 문제 불러오기' : 'Load Existing'}
          </button>
          <button
            type="button"
            onClick={() => setUseExistingProblems(false)}
            className={`px-4 py-2 rounded-lg font-medium transition-colors ${
              !useExistingProblems
                ? 'bg-indigo-600 dark:bg-indigo-500 text-white'
                : 'bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-300 dark:hover:bg-slate-600'
            }`}
          >
            {language === 'ko' ? 'AI로 시험지 생성' : 'Generate New with AI'}
          </button>
        </div>
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
                disabled={problemCounts[selectedType] <= 0}
              >
                ↓
              </button>
            <input
              type="number"
              min="0"
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

      {/* 설정 옵션 (기존 문제 불러오기 시) */}
      {useExistingProblems && (
        <div className="mb-6 p-4 bg-slate-50 dark:bg-slate-900/50 rounded-lg border border-slate-200 dark:border-slate-700">
          <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-3">
            {language === 'ko' ? '기존 문제 불러오기 설정' : 'Load Existing Problems Settings'}
          </h3>
          <div className="space-y-2">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={excludeSolved}
                onChange={(e) => setExcludeSolved(e.target.checked)}
                className="w-4 h-4 text-indigo-600 rounded focus:ring-indigo-500"
              />
              <span className="text-sm text-slate-700 dark:text-slate-300">
                {language === 'ko' ? '이미 풀이한 문제 제외' : 'Exclude already solved problems'}
              </span>
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={excludeRecentDays !== null}
                onChange={(e) => setExcludeRecentDays(e.target.checked ? 7 : null)}
                className="w-4 h-4 text-indigo-600 rounded focus:ring-indigo-500"
              />
              <span className="text-sm text-slate-700 dark:text-slate-300">
                {language === 'ko' ? '최근 7일 내 출제된 문제 제외' : 'Exclude problems from last 7 days'}
              </span>
            </label>
          </div>
        </div>
      )}

      {/* 진행 상태 표시 */}
      {(progressMessage || progressStage > 0) && isLoadingExisting && (
        <div className="mb-6 p-4 bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800 rounded-lg">
          <div className="flex items-center gap-3 mb-2">
            <div className="flex-1">
              <div className="text-sm font-semibold text-blue-800 dark:text-blue-200 mb-1">
                {progressMessage || (language === 'ko' ? '처리 중...' : 'Processing...')}
              </div>
              {progressDetails && progressDetails.stage === 'searching' && progressDetails.found !== undefined && (
                <div className="text-xs text-blue-700 dark:text-blue-300">
                  {language === 'ko' 
                    ? `→ ${getProblemTypeLabel(progressDetails.problemType, language)}: ${progressDetails.found}개 발견`
                    : `→ ${getProblemTypeLabel(progressDetails.problemType, language)}: ${progressDetails.found} found`}
                </div>
              )}
              {progressDetails && progressDetails.stage === 'generating' && (
                <div className="text-xs text-blue-700 dark:text-blue-300">
                  {language === 'ko'
                    ? `→ ${getProblemTypeLabel(progressDetails.problemType, language)}: ${progressDetails.current || 0}/${progressDetails.expected || 0} 생성 중...`
                    : `→ ${getProblemTypeLabel(progressDetails.problemType, language)}: ${progressDetails.current || 0}/${progressDetails.expected || 0} generating...`}
                </div>
              )}
            </div>
            {progressStage > 0 && progressStage < 3 && (
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
              </div>
            )}
          </div>
          {/* 진행 바 */}
          <div className="w-full bg-blue-200 dark:bg-blue-800 rounded-full h-2 mt-2">
            <div
              className="bg-blue-600 dark:bg-blue-400 h-2 rounded-full transition-all duration-300"
              style={{ width: `${(progressStage / 3) * 100}%` }}
            ></div>
          </div>
        </div>
      )}

      {/* 버튼들 */}
      <div className="mb-6 space-y-3">
        {/* 기존 문제 불러오기 버튼 */}
        {useExistingProblems && (
          <button
            onClick={handleLoadExistingProblems}
            disabled={isLoadingExisting || isGenerating || problemCounts[selectedType] < 1}
            className="w-full px-6 py-3 bg-green-600 dark:bg-green-500 text-white rounded-lg font-semibold hover:bg-green-700 dark:hover:bg-green-600 disabled:bg-slate-400 dark:disabled:bg-gray-600 disabled:cursor-not-allowed transition-colors"
          >
            {isLoadingExisting 
              ? (language === 'ko' ? '불러오는 중...' : 'Loading...')
              : (language === 'ko' ? '기존 문제 불러오기 (빠르고 무료)' : 'Load Existing Problems (Fast & Free)')}
          </button>
        )}
        
        {/* AI로 시험지 생성 버튼 */}
        <button
          onClick={handleGenerate}
          disabled={isGenerating || isLoadingExisting || problemCounts[selectedType] < 1}
          className="w-full px-6 py-3 bg-indigo-600 dark:bg-indigo-500 text-white rounded-lg font-semibold hover:bg-indigo-700 dark:hover:bg-indigo-600 disabled:bg-slate-400 dark:disabled:bg-gray-600 disabled:cursor-not-allowed transition-colors"
        >
          {isGenerating 
            ? (language === 'ko' ? '생성 중...' : 'Generating...')
            : (language === 'ko' ? 'AI로 시험지 생성 (새로운 문제 생성)' : 'Generate New Problems with AI')}
        </button>
      </div>

      {/* 통계 표시 */}
      {loadStats && (
        <div className="mb-6 p-4 bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-800 rounded-lg">
          <div className="text-sm text-green-800 dark:text-green-200">
            <div>
              {language === 'ko' ? '기존 문제 재사용' : 'Existing problems reused'}: {loadStats.existing}
            </div>
            <div>
              {language === 'ko' ? '새로 생성' : 'Newly generated'}: {loadStats.newlyGenerated}
            </div>
            <div className="font-semibold mt-1">
              {language === 'ko' ? '총' : 'Total'}: {loadStats.existing + loadStats.newlyGenerated}
            </div>
          </div>
        </div>
      )}

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

