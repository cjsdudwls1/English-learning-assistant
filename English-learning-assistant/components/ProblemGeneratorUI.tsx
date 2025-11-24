import React from 'react';

type ProblemType = 'multiple_choice' | 'short_answer' | 'essay' | 'ox';

interface ProblemCount {
  multiple_choice: number;
  short_answer: number;
  essay: number;
  ox: number;
}

interface ProblemGeneratorUIProps {
  problemCounts: ProblemCount;
  onCountChange: (type: ProblemType, value: number) => void;
  onGenerate: () => void;
  onLoadExisting?: () => void; // 기존 문제 불러오기 핸들러 (선택)
  isGenerating: boolean;
  isLoadingExisting?: boolean; // 기존 문제 불러오기 중 여부
  error: string | null;
  selectedNodesCount: number;
  language: 'ko' | 'en';
  onClose: () => void;
  useExistingProblems?: boolean; // 기존 문제 불러오기 모드 여부
  onToggleUseExisting?: (value: boolean) => void; // 모드 토글
}

export const ProblemGeneratorUI: React.FC<ProblemGeneratorUIProps> = ({
  problemCounts,
  onCountChange,
  onGenerate,
  onLoadExisting,
  isGenerating,
  isLoadingExisting = false,
  error,
  selectedNodesCount,
  language,
  onClose,
  useExistingProblems = false,
  onToggleUseExisting,
}) => {
  const adjustCount = (type: ProblemType, delta: number) => {
    const newValue = Math.max(0, Math.min(50, problemCounts[type] + delta));
    onCountChange(type, newValue);
  };

  const handleCountInputChange = (type: ProblemType, value: string) => {
    const num = parseInt(value, 10);
    if (!isNaN(num) && num >= 0 && num <= 50) {
      onCountChange(type, num);
    }
  };

  const totalCount = Object.values(problemCounts).reduce((sum, count) => sum + count, 0);

  return (
    <div className="mt-6 p-6 bg-slate-50 dark:bg-slate-900/50 rounded-lg border border-slate-200 dark:border-slate-700">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-xl font-bold text-slate-800 dark:text-slate-200">
          {language === 'ko' ? '문제 생성' : 'Generate Problems'}
        </h3>
        <button
          onClick={onClose}
          className="px-3 py-1 text-sm bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
        >
          {language === 'ko' ? '닫기' : 'Close'}
        </button>
      </div>

      <div className="mb-4 p-3 bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800 rounded-lg">
        <p className="text-sm text-blue-800 dark:text-blue-200">
          {selectedNodesCount > 0 
            ? (language === 'ko' 
                ? '✓ 선택한 카테고리 기반으로 문제가 생성됩니다.'
                : '✓ Problems will be generated based on selected categories.')
            : (language === 'ko'
                ? '✓ 카테고리를 선택하지 않았습니다. 정답률이 낮은 유형부터 자동으로 선택되어 문제가 생성됩니다.'
                : '✓ No category selected. Problems will be generated based on low accuracy types, starting from the lowest.')
            }
        </p>
      </div>

      {/* 문제 유형별 문제 수 입력 */}
      <div className="mb-6">
        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-3">
          {language === 'ko' ? '문제 유형별 문제 수 설정' : 'Set Problem Count by Type'}
        </label>
        <div className="space-y-3">
          {(['multiple_choice', 'short_answer', 'essay', 'ox'] as ProblemType[]).map((type) => (
            <div key={type} className="flex items-center justify-between p-3 bg-white dark:bg-slate-700 rounded-lg border border-slate-200 dark:border-slate-600">
              <span className="text-sm font-medium text-slate-700 dark:text-slate-300 flex-1">
                {type === 'multiple_choice' && (language === 'ko' ? '객관식' : 'Multiple Choice')}
                {type === 'short_answer' && (language === 'ko' ? '단답형' : 'Short Answer')}
                {type === 'essay' && (language === 'ko' ? '서술형' : 'Essay')}
                {type === 'ox' && (language === 'ko' ? 'O/X' : 'True/False')}
              </span>
              <div className="flex items-center gap-2">
                <div className="flex items-center border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800">
                  <button
                    type="button"
                    onClick={() => adjustCount(type, -1)}
                    className="px-3 py-2 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-600 rounded-l-lg"
                    disabled={problemCounts[type] <= 0}
                  >
                    ↓
                  </button>
                  <input
                    type="number"
                    min="0"
                    max="50"
                    value={problemCounts[type]}
                    onChange={(e) => handleCountInputChange(type, e.target.value)}
                    className="w-20 px-3 py-2 text-center border-0 focus:ring-2 focus:ring-indigo-500 dark:focus:ring-indigo-400 bg-transparent text-slate-900 dark:text-slate-200"
                  />
                  <button
                    type="button"
                    onClick={() => adjustCount(type, 1)}
                    className="px-3 py-2 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-600 rounded-r-lg"
                    disabled={problemCounts[type] >= 50}
                  >
                    ↑
                  </button>
                </div>
                <span className="text-xs text-slate-500 dark:text-slate-400 w-12 text-right">
                  {language === 'ko' ? '(0-50)' : '(0-50)'}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 모드 선택 (기존 문제 불러오기 기능이 있는 경우) */}
      {onLoadExisting && onToggleUseExisting && (
        <div className="mb-4 flex gap-2">
          <button
            type="button"
            onClick={() => onToggleUseExisting(true)}
            className={`flex-1 px-4 py-2 rounded-lg font-medium transition-colors ${
              useExistingProblems
                ? 'bg-green-600 dark:bg-green-500 text-white'
                : 'bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-300 dark:hover:bg-slate-600'
            }`}
          >
            {language === 'ko' ? '기존 문제 불러오기' : 'Load Existing'}
          </button>
          <button
            type="button"
            onClick={() => onToggleUseExisting(false)}
            className={`flex-1 px-4 py-2 rounded-lg font-medium transition-colors ${
              !useExistingProblems
                ? 'bg-indigo-600 dark:bg-indigo-500 text-white'
                : 'bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-300 dark:hover:bg-slate-600'
            }`}
          >
            {language === 'ko' ? 'AI로 시험지 생성' : 'Generate New with AI'}
          </button>
        </div>
      )}

      {/* 생성 버튼 */}
      <div className="mb-4 space-y-3">
        {/* 기존 문제 불러오기 버튼 */}
        {useExistingProblems && onLoadExisting && (
          <button
            onClick={onLoadExisting}
            disabled={isLoadingExisting || isGenerating || totalCount < 1}
            className="w-full px-6 py-3 bg-green-600 dark:bg-green-500 text-white rounded-lg font-semibold hover:bg-green-700 dark:hover:bg-green-600 disabled:bg-slate-400 dark:disabled:bg-gray-600 disabled:cursor-not-allowed transition-colors"
          >
            {isLoadingExisting 
              ? (language === 'ko' ? '불러오는 중...' : 'Loading...')
              : (language === 'ko' ? '기존 문제 불러오기 (빠르고 무료)' : 'Load Existing Problems (Fast & Free)')}
          </button>
        )}
        
        {/* AI로 시험지 생성 버튼 */}
        <button
          onClick={onGenerate}
          disabled={isGenerating || isLoadingExisting || totalCount < 1}
          className="w-full px-6 py-3 bg-indigo-600 dark:bg-indigo-500 text-white rounded-lg font-semibold hover:bg-indigo-700 dark:hover:bg-indigo-600 disabled:bg-slate-400 dark:disabled:bg-gray-600 disabled:cursor-not-allowed transition-colors"
        >
          {isGenerating 
            ? (language === 'ko' ? '생성 중...' : 'Generating...')
            : (language === 'ko' ? 'AI로 시험지 생성 (새로운 문제 생성)' : 'Generate New Problems with AI')}
        </button>
      </div>

      {error && (
        <div className="mb-4 p-4 bg-red-100 dark:bg-red-900/30 border border-red-300 dark:border-red-800 text-red-800 dark:text-red-200 rounded-lg">
          {error}
        </div>
      )}
    </div>
  );
};

