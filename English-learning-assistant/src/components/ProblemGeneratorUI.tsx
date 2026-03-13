import React, { useState } from 'react';
import type { AIGenerationOptions } from '../services/problemLoader';

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
  onGenerateWithOptions?: (options: AIGenerationOptions) => void;
  onLoadExisting?: () => void;
  isGenerating: boolean;
  isLoadingExisting?: boolean;
  error: string | null;
  selectedNodesCount: number;
  language: 'ko' | 'en';
  onClose: () => void;
  useExistingProblems?: boolean;
  onToggleUseExisting?: (value: boolean) => void;
}

const PASSAGE_TOPICS = [
  {
    id: 'social',
    ko: '사회과학',
    en: 'Social Science',
    subs: [
      { ko: '경제', en: 'Economics' },
      { ko: '심리학', en: 'Psychology' },
      { ko: '사회학', en: 'Sociology' },
      { ko: '정치학', en: 'Political Science' },
      { ko: '교육학', en: 'Education' },
    ],
  },
  {
    id: 'humanities',
    ko: '인문학',
    en: 'Humanities',
    subs: [
      { ko: '철학', en: 'Philosophy' },
      { ko: '역사', en: 'History' },
      { ko: '문학', en: 'Literature' },
      { ko: '언어학', en: 'Linguistics' },
    ],
  },
  {
    id: 'science',
    ko: '자연과학',
    en: 'Natural Science',
    subs: [
      { ko: '생물학', en: 'Biology' },
      { ko: '물리학', en: 'Physics' },
      { ko: '화학', en: 'Chemistry' },
      { ko: '환경과학', en: 'Environmental Science' },
      { ko: '천문학', en: 'Astronomy' },
    ],
  },
  {
    id: 'arts',
    ko: '예술/기술',
    en: 'Arts & Technology',
    subs: [
      { ko: '미술', en: 'Art' },
      { ko: '음악', en: 'Music' },
      { ko: '건축', en: 'Architecture' },
      { ko: '기술/공학', en: 'Technology/Engineering' },
      { ko: '미디어', en: 'Media' },
    ],
  },
];

const PASSAGE_GENRES = [
  { id: 'dialogue', ko: '대화문', en: 'Dialogue' },
  { id: 'news', ko: '기사', en: 'News Article' },
  { id: 'interview', ko: '인터뷰', en: 'Interview' },
  { id: 'fiction', ko: '소설/단편', en: 'Fiction' },
  { id: 'essay', ko: '에세이', en: 'Essay' },
  { id: 'advertisement', ko: '광고', en: 'Advertisement' },
  { id: 'notice', ko: '안내문', en: 'Notice' },
  { id: 'letter', ko: '편지/이메일', en: 'Letter/Email' },
  { id: 'speech', ko: '연설', en: 'Speech' },
  { id: 'journal', ko: '논문/학술', en: 'Journal/Academic' },
];

export const ProblemGeneratorUI: React.FC<ProblemGeneratorUIProps> = ({
  problemCounts,
  onCountChange,
  onGenerate,
  onGenerateWithOptions,
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
  // AI 생성 옵션 state
  const [includePassage, setIncludePassage] = useState(false);
  const [passageLength, setPassageLength] = useState(1000);
  const [passageTopic, setPassageTopic] = useState<{ category: string; subfield: string } | null>(null);
  const [passageGenre, setPassageGenre] = useState<string | null>(null);
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);
  const [difficultyLevel, setDifficultyLevel] = useState(3);
  const [vocabLevel, setVocabLevel] = useState(3);
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
            className={`flex-1 px-4 py-2 rounded-lg font-medium transition-colors ${useExistingProblems
                ? 'bg-green-600 dark:bg-green-500 text-white'
                : 'bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-300 dark:hover:bg-slate-600'
              }`}
          >
            {language === 'ko' ? '기존 문제 불러오기' : 'Load Existing'}
          </button>
          <button
            type="button"
            onClick={() => onToggleUseExisting(false)}
            className={`flex-1 px-4 py-2 rounded-lg font-medium transition-colors ${!useExistingProblems
                ? 'bg-indigo-600 dark:bg-indigo-500 text-white'
                : 'bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-300 dark:hover:bg-slate-600'
              }`}
          >
            {language === 'ko' ? 'AI로 시험지 생성' : 'Generate New with AI'}
          </button>
        </div>
      )}

      {/* AI 생성 옵션 (AI 모드일 때만 표시) */}
      {!useExistingProblems && (
        <div className="mb-4 space-y-4 p-4 bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800 rounded-lg">
          <h4 className="text-sm font-bold text-indigo-800 dark:text-indigo-300">
            {language === 'ko' ? 'AI 생성 옵션' : 'AI Generation Options'}
          </h4>

          {/* 지문 포함 토글 */}
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={includePassage}
              onChange={(e) => setIncludePassage(e.target.checked)}
              className="w-4 h-4 text-indigo-600 rounded"
            />
            <span className="text-sm text-slate-700 dark:text-slate-300">
              {language === 'ko' ? '영어 지문 포함 생성' : 'Include English passage'}
            </span>
          </label>

          {/* 지문 길이 슬라이더 */}
          {includePassage && (
            <div className="pl-7 space-y-3">
              <div>
                <div className="flex justify-between items-center mb-1">
                  <span className="text-xs text-slate-600 dark:text-slate-400">{language === 'ko' ? '지문 길이' : 'Passage length'}</span>
                  <span className="text-xs font-mono text-indigo-600 dark:text-indigo-400">
                    {passageLength}{language === 'ko' ? '자' : ' chars'}
                  </span>
                </div>
                <input
                  type="range"
                  min={700}
                  max={2000}
                  step={100}
                  value={passageLength}
                  onChange={(e) => setPassageLength(Number(e.target.value))}
                  className="w-full h-2 bg-slate-200 dark:bg-slate-600 rounded-lg appearance-none cursor-pointer accent-indigo-600"
                />
                <div className="flex justify-between text-[10px] text-slate-400">
                  <span>700</span><span>1000</span><span>1500</span><span>2000</span>
                </div>
              </div>

              {/* 지문 분야 선택 */}
              <div>
                <span className="text-xs text-slate-600 dark:text-slate-400 block mb-2">
                  {language === 'ko' ? '지문 분야 (선택)' : 'Passage topic (optional)'}
                </span>
                <div className="grid grid-cols-2 gap-2">
                  {PASSAGE_TOPICS.map((cat) => (
                    <div key={cat.id}>
                      <button
                        type="button"
                        onClick={() => setExpandedCategory(expandedCategory === cat.id ? null : cat.id)}
                        className={`w-full px-3 py-2 text-xs font-medium rounded-lg transition-colors ${expandedCategory === cat.id || passageTopic?.category === (language === 'ko' ? cat.ko : cat.en)
                          ? 'bg-indigo-600 text-white'
                          : 'bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-300 hover:bg-indigo-100 dark:hover:bg-slate-600'
                          }`}
                      >
                        {language === 'ko' ? cat.ko : cat.en}
                      </button>
                      {expandedCategory === cat.id && (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {cat.subs.map((sub) => (
                            <button
                              key={sub.ko}
                              type="button"
                              onClick={() => {
                                setPassageTopic({
                                  category: language === 'ko' ? cat.ko : cat.en,
                                  subfield: language === 'ko' ? sub.ko : sub.en,
                                });
                                setExpandedCategory(null);
                              }}
                              className={`px-2 py-1 text-xs rounded-full transition-colors ${passageTopic?.subfield === (language === 'ko' ? sub.ko : sub.en)
                                ? 'bg-indigo-500 text-white'
                                : 'bg-slate-100 dark:bg-slate-600 text-slate-600 dark:text-slate-300 hover:bg-indigo-200'
                                }`}
                            >
                              {language === 'ko' ? sub.ko : sub.en}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
                {passageTopic && (
                  <div className="mt-2 flex items-center gap-2">
                    <span className="text-xs text-indigo-600 dark:text-indigo-400">
                      {language === 'ko'
                        ? `선택: ${passageTopic.category} > ${passageTopic.subfield}`
                        : `Selected: ${passageTopic.category} > ${passageTopic.subfield}`}
                    </span>
                    <button type="button" onClick={() => setPassageTopic(null)} className="text-xs text-red-500 hover:underline">
                      {language === 'ko' ? '초기화' : 'Reset'}
                    </button>
                  </div>
                )}
              </div>

              {/* 지문 종류 선택 (genre) */}
              <div>
                <span className="text-xs text-slate-600 dark:text-slate-400 block mb-2">
                  {language === 'ko' ? '지문 종류 (선택)' : 'Passage genre (optional)'}
                </span>
                <div className="flex flex-wrap gap-2">
                  {PASSAGE_GENRES.map((genre) => (
                    <button
                      key={genre.id}
                      type="button"
                      onClick={() => setPassageGenre(passageGenre === genre.id ? null : genre.id)}
                      className={`px-3 py-1.5 text-xs rounded-full transition-colors ${
                        passageGenre === genre.id
                          ? 'bg-indigo-600 text-white'
                          : 'bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-300 hover:bg-indigo-100 dark:hover:bg-slate-600 border border-slate-200 dark:border-slate-600'
                      }`}
                    >
                      {language === 'ko' ? genre.ko : genre.en}
                    </button>
                  ))}
                </div>
                {passageGenre && (
                  <div className="mt-2 flex items-center gap-2">
                    <span className="text-xs text-indigo-600 dark:text-indigo-400">
                      {language === 'ko'
                        ? `선택: ${PASSAGE_GENRES.find(g => g.id === passageGenre)?.[language === 'ko' ? 'ko' : 'en'] || passageGenre}`
                        : `Selected: ${PASSAGE_GENRES.find(g => g.id === passageGenre)?.en || passageGenre}`}
                    </span>
                    <button type="button" onClick={() => setPassageGenre(null)} className="text-xs text-red-500 hover:underline">
                      {language === 'ko' ? '초기화' : 'Reset'}
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* 난이도 슬라이더 */}
          <div>
            <div className="flex justify-between items-center mb-1">
              <span className="text-xs text-slate-600 dark:text-slate-400">
                {language === 'ko' ? '문제 난이도' : 'Difficulty level'}
              </span>
              <span className="text-xs font-mono text-indigo-600 dark:text-indigo-400">
                {difficultyLevel}/5
              </span>
            </div>
            <input
              type="range"
              min={1}
              max={5}
              step={1}
              value={difficultyLevel}
              onChange={(e) => setDifficultyLevel(Number(e.target.value))}
              className="w-full h-2 bg-slate-200 dark:bg-slate-600 rounded-lg appearance-none cursor-pointer accent-indigo-600"
            />
            <div className="flex justify-between text-[10px] text-slate-400">
              <span>{language === 'ko' ? '기초' : 'Basic'}</span>
              <span>{language === 'ko' ? '수능' : 'CSAT'}</span>
              <span>{language === 'ko' ? '최고난도' : 'Hardest'}</span>
            </div>
          </div>

          {/* 어휘 수준 슬라이더 */}
          <div>
            <div className="flex justify-between items-center mb-1">
              <span className="text-xs text-slate-600 dark:text-slate-400">
                {language === 'ko' ? '어휘 수준' : 'Vocabulary level'}
              </span>
              <span className="text-xs font-mono text-indigo-600 dark:text-indigo-400">
                {vocabLevel}/5
              </span>
            </div>
            <input
              type="range"
              min={1}
              max={5}
              step={1}
              value={vocabLevel}
              onChange={(e) => setVocabLevel(Number(e.target.value))}
              className="w-full h-2 bg-slate-200 dark:bg-slate-600 rounded-lg appearance-none cursor-pointer accent-indigo-600"
            />
            <div className="flex justify-between text-[10px] text-slate-400">
              <span>{language === 'ko' ? '중학' : 'Middle'}</span>
              <span>{language === 'ko' ? '수능' : 'CSAT'}</span>
              <span>{language === 'ko' ? 'GRE/학술' : 'GRE'}</span>
            </div>
          </div>
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
          onClick={() => {
            if (!useExistingProblems && onGenerateWithOptions) {
              onGenerateWithOptions({
                includePassage,
                ...(includePassage && { passageLength }),
                ...(includePassage && passageTopic && { passageTopic }),
                ...(includePassage && passageGenre && { passageGenre: PASSAGE_GENRES.find(g => g.id === passageGenre)?.[language === 'ko' ? 'ko' : 'en'] || passageGenre }),
                difficultyLevel,
                vocabLevel,
              });
            } else {
              onGenerate();
            }
          }}
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

