import React from 'react';
import { getTranslation } from '../utils/translations';

interface StatsActionButtonsProps {
  language: 'ko' | 'en';
  isReclassifying: boolean;
  isGeneratingExamples: boolean;
  selectedNodesCount: number;
  onReclassify: () => void;
  onGenerateExamples: () => void;
  onGenerateSimilarProblems: () => void;
}

export const StatsActionButtons: React.FC<StatsActionButtonsProps> = ({
  language,
  isReclassifying,
  isGeneratingExamples,
  selectedNodesCount,
  onReclassify,
  onGenerateExamples,
  onGenerateSimilarProblems,
}) => {
  const t = getTranslation(language);

  return (
    <div className="flex gap-2">
      <button
        onClick={onReclassify}
        disabled={isReclassifying}
        className="px-4 py-2 bg-orange-600 dark:bg-orange-500 text-white rounded-lg hover:bg-orange-700 dark:hover:bg-orange-600 disabled:bg-gray-400 dark:disabled:bg-gray-600 disabled:cursor-not-allowed transition-colors"
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
        onClick={onGenerateSimilarProblems}
        className="px-4 py-2 bg-indigo-600 dark:bg-indigo-500 text-white rounded-lg hover:bg-indigo-700 dark:hover:bg-indigo-600 transition-colors"
      >
        {t.stats.generateSimilar}
      </button>
    </div>
  );
};

