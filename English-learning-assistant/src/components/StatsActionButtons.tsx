import React from 'react';
import { getTranslation } from '../utils/translations';

interface StatsActionButtonsProps {
  language: 'ko' | 'en';
  isReclassifying: boolean;
  isGeneratingExamples: boolean;
  isConsulting: boolean;
  selectedNodesCount: number;
  onReclassify: () => void;
  onGenerateExamples: () => void;
  onConsult: () => void;
  onShowHistory: () => void;
  onGenerateSimilarProblems: () => void;
}

export const StatsActionButtons: React.FC<StatsActionButtonsProps> = ({
  language,
  isReclassifying,
  isGeneratingExamples,
  isConsulting,
  selectedNodesCount,
  onReclassify,
  onGenerateExamples,
  onConsult,
  onShowHistory,
  onGenerateSimilarProblems,
}) => {
  const t = getTranslation(language);

  return (
    <div className="flex gap-2">
      <button
        onClick={onReclassify}
        disabled={isReclassifying}
        className="px-4 py-2 bg-orange-700 dark:bg-orange-600 text-white rounded-lg hover:bg-orange-800 dark:hover:bg-orange-700 disabled:bg-gray-400 dark:disabled:bg-gray-600 disabled:cursor-not-allowed transition-colors"
        title={language === 'ko' ? '기존 문제들을 새로운 분류 체계로 재분류합니다' : 'Reclassify all problems with the new classification system'}
      >
        {isReclassifying ? t.stats.reclassifying : t.stats.reclassifyAll}
      </button>
      <button
        onClick={onGenerateExamples}
        disabled={selectedNodesCount === 0 || isGeneratingExamples}
        className="px-4 py-2 bg-green-600 dark:bg-green-500 text-white rounded-lg hover:bg-green-700 dark:hover:bg-green-600 disabled:bg-gray-400 dark:disabled:bg-gray-600 disabled:cursor-not-allowed transition-colors"
      >
        {isGeneratingExamples ? t.example.generating : t.example.generate}
      </button>
      <button
        onClick={onConsult}
        disabled={isConsulting}
        className="px-4 py-2 bg-violet-600 dark:bg-violet-500 text-white rounded-lg hover:bg-violet-700 dark:hover:bg-violet-600 disabled:bg-gray-400 dark:disabled:bg-gray-600 disabled:cursor-not-allowed transition-colors"
        title={language === 'ko' ? '선택한 카테고리(미선택 시 전체)에 대한 맞춤형 학습 컨설팅 보고서를 생성합니다' : 'Generate a personalized learning consulting report for the selected category (or all if none selected)'}
      >
        {isConsulting ? t.stats.consulting : t.stats.learningConsultant}
      </button>
      <button
        onClick={onShowHistory}
        className="px-4 py-2 border border-violet-500 text-violet-600 dark:text-violet-400 rounded-lg hover:bg-violet-50 dark:hover:bg-violet-900/20 transition-colors"
      >
        {t.stats.consultingHistory}
      </button>
      <button
        onClick={onGenerateSimilarProblems}
        className="px-4 py-2 bg-indigo-600 dark:bg-indigo-500 text-white rounded-lg hover:bg-indigo-700 dark:hover:bg-indigo-600 transition-colors"
      >
        {t.stats.generateSimilar}
      </button>
    </div>
  );
};

