import React from 'react';
import { getTranslation } from '../utils/translations';

interface StatsActionButtonsProps {
  language: 'ko' | 'en';
  isReclassifying: boolean;
  isGeneratingExamples: boolean;
  isConsulting: boolean;
  isPlanning: boolean;
  selectedNodesCount: number;
  onReclassify: () => void;
  onGenerateExamples: () => void;
  onConsult: () => void;
  onPlan: () => void;
  onShowHistory: () => void;
  onGenerateSimilarProblems: () => void;
}

export const StatsActionButtons: React.FC<StatsActionButtonsProps> = ({
  language,
  isReclassifying,
  isGeneratingExamples,
  isConsulting,
  isPlanning,
  selectedNodesCount,
  onReclassify,
  onGenerateExamples,
  onConsult,
  onPlan,
  onShowHistory,
  onGenerateSimilarProblems,
}) => {
  const t = getTranslation(language);
  // 컨설턴트와 플래너는 둘 다 돈을 쓰는 에이전트다. 동시에 돌릴 이유가 없어 서로를 잠근다.
  const agentBusy = isConsulting || isPlanning;

  // 모바일: 6개 버튼이 제각각 줄바꿈되며 세로를 먹던 것을 2열 그리드로 고정한다
  return (
    <div className="grid grid-cols-2 gap-2 w-full sm:flex sm:flex-wrap sm:w-auto">
      <button
        onClick={onReclassify}
        disabled={isReclassifying}
        className="min-h-[40px] sm:min-h-0 px-2.5 sm:px-4 py-2 text-sm sm:text-base bg-orange-700 dark:bg-orange-600 text-white rounded-lg hover:bg-orange-800 dark:hover:bg-orange-700 disabled:bg-gray-400 dark:disabled:bg-gray-600 disabled:cursor-not-allowed transition-colors"
        title={language === 'ko' ? '기존 문제들을 새로운 분류 체계로 재분류합니다' : 'Reclassify all problems with the new classification system'}
      >
        {isReclassifying ? t.stats.reclassifying : t.stats.reclassifyAll}
      </button>
      <button
        onClick={onGenerateExamples}
        disabled={selectedNodesCount === 0 || isGeneratingExamples}
        className="min-h-[40px] sm:min-h-0 px-2.5 sm:px-4 py-2 text-sm sm:text-base bg-green-600 dark:bg-green-500 text-white rounded-lg hover:bg-green-700 dark:hover:bg-green-600 disabled:bg-gray-400 dark:disabled:bg-gray-600 disabled:cursor-not-allowed transition-colors"
      >
        {isGeneratingExamples ? t.example.generating : t.example.generate}
      </button>
      <button
        onClick={onConsult}
        disabled={agentBusy}
        className="min-h-[40px] sm:min-h-0 px-2.5 sm:px-4 py-2 text-sm sm:text-base bg-violet-600 dark:bg-violet-500 text-white rounded-lg hover:bg-violet-700 dark:hover:bg-violet-600 disabled:bg-gray-400 dark:disabled:bg-gray-600 disabled:cursor-not-allowed transition-colors"
        title={language === 'ko' ? '선택한 카테고리(미선택 시 전체)에 대한 맞춤형 학습 컨설팅 보고서를 생성합니다' : 'Generate a personalized learning consulting report for the selected category (or all if none selected)'}
      >
        {isConsulting ? t.stats.consulting : t.stats.learningConsultant}
      </button>
      <button
        onClick={onPlan}
        disabled={agentBusy}
        className="min-h-[40px] sm:min-h-0 px-2.5 sm:px-4 py-2 text-sm sm:text-base bg-fuchsia-700 dark:bg-fuchsia-600 text-white rounded-lg hover:bg-fuchsia-800 dark:hover:bg-fuchsia-700 disabled:bg-gray-400 dark:disabled:bg-gray-600 disabled:cursor-not-allowed transition-colors"
        title={t.stats.studyPlanHint}
      >
        {isPlanning ? t.stats.planning : t.stats.studyPlan}
      </button>
      <button
        onClick={onShowHistory}
        className="min-h-[40px] sm:min-h-0 px-2.5 sm:px-4 py-2 text-sm sm:text-base border border-violet-500 text-violet-600 dark:text-violet-400 rounded-lg hover:bg-violet-50 dark:hover:bg-violet-900/20 transition-colors"
      >
        {t.stats.consultingHistory}
      </button>
      <button
        onClick={onGenerateSimilarProblems}
        className="min-h-[40px] sm:min-h-0 px-2.5 sm:px-4 py-2 text-sm sm:text-base bg-indigo-600 dark:bg-indigo-500 text-white rounded-lg hover:bg-indigo-700 dark:hover:bg-indigo-600 transition-colors"
      >
        {t.stats.generateSimilar}
      </button>
    </div>
  );
};

