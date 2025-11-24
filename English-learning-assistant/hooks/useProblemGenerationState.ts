import { useState, useCallback } from 'react';
import { useProblemGeneration } from './useProblemGeneration';
import { loadProblemsWithExisting } from '../services/problemLoader';
import type { GeneratedProblem } from '../types';

type ProblemType = 'multiple_choice' | 'short_answer' | 'essay' | 'ox';

interface ProblemCount {
  multiple_choice: number;
  short_answer: number;
  essay: number;
  ox: number;
}

interface UseProblemGenerationStateParams {
  userId: string;
  language: 'ko' | 'en';
  classifications: Array<{ depth1: string; depth2: string; depth3: string; depth4: string }>;
  onError: (error: string) => void;
}

interface UseProblemGenerationStateReturn {
  showProblemGenerator: boolean;
  setShowProblemGenerator: (show: boolean) => void;
  selectedProblemType: ProblemType;
  setSelectedProblemType: (type: ProblemType) => void;
  problemCounts: ProblemCount;
  handleCountChange: (type: ProblemType, value: number) => void;
  showTestSheet: boolean;
  setShowTestSheet: (show: boolean) => void;
  generatedProblems: GeneratedProblem[];
  setGeneratedProblems: (problems: GeneratedProblem[]) => void;
  isGeneratingProblems: boolean;
  isLoadingExistingProblems: boolean;
  generationError: string | null;
  handleGenerateProblems: () => Promise<void>;
  handleLoadExistingProblems: () => Promise<void>;
  handleGenerateSimilarProblems: () => void;
  resetGeneration: () => void;
  useExistingProblems: boolean;
  setUseExistingProblems: (value: boolean) => void;
}

export function useProblemGenerationState({
  userId,
  language,
  classifications,
  onError,
}: UseProblemGenerationStateParams): UseProblemGenerationStateReturn {
  const [showProblemGenerator, setShowProblemGenerator] = useState(false);
  const [selectedProblemType, setSelectedProblemType] = useState<ProblemType>('multiple_choice');
  const [problemCounts, setProblemCounts] = useState<ProblemCount>({
    multiple_choice: 0,
    short_answer: 0,
    essay: 0,
    ox: 0,
  });
  const [showTestSheet, setShowTestSheet] = useState(false);
  const [generatedProblems, setGeneratedProblems] = useState<GeneratedProblem[]>([]);
  const [isLoadingExistingProblems, setIsLoadingExistingProblems] = useState(false);
  const [useExistingProblems, setUseExistingProblems] = useState(true);

  const {
    isGenerating: isGeneratingProblems,
    error: generationError,
    handleGenerateProblems: baseHandleGenerateProblems,
    reset: resetGeneration,
  } = useProblemGeneration({
    userId,
    language,
    problemCounts,
    classifications,
    onComplete: (problems) => {
      setGeneratedProblems(problems);
      setShowTestSheet(true);
      setShowProblemGenerator(false);
    },
    onError,
  });

  const handleCountChange = useCallback((type: ProblemType, value: number) => {
    setProblemCounts(prev => ({
      ...prev,
      [type]: value,
    }));
  }, []);

  const handleGenerateSimilarProblems = useCallback(() => {
    setShowProblemGenerator(true);
    setShowTestSheet(false);
    setGeneratedProblems([]);
    resetGeneration();
  }, [resetGeneration]);

  const handleLoadExistingProblems = useCallback(async () => {
    const totalCount = Object.values(problemCounts).reduce((sum, count) => sum + count, 0);
    if (totalCount < 1) {
      onError(language === 'ko' 
        ? '최소 하나의 문제 유형에서 1개 이상의 문제를 선택해야 합니다.' 
        : 'At least one problem type must have 1 or more problems.');
      return;
    }

    setIsLoadingExistingProblems(true);
    try {
      const classificationToUse = classifications.length > 0 ? {
        depth1: classifications[0].depth1,
        depth2: classifications[0].depth2,
        depth3: classifications[0].depth3,
        depth4: classifications[0].depth4,
      } : undefined;

      const result = await loadProblemsWithExisting(
        {
          problemCounts,
          classification: classificationToUse,
          language,
          userId,
          exactMatchOnly: false,
        },
        (stage, message, details) => {
          console.log(`[Load Existing] Stage ${stage}: ${message}`, details);
        }
      );

      setGeneratedProblems(result.problems);
      setShowTestSheet(true);
      setShowProblemGenerator(false);
    } catch (error) {
      console.error('Error loading existing problems:', error);
      onError(error instanceof Error ? error.message : (language === 'ko' ? '문제 불러오기 중 오류가 발생했습니다.' : 'An error occurred while loading problems.'));
    } finally {
      setIsLoadingExistingProblems(false);
    }
  }, [problemCounts, classifications, language, userId, onError]);

  return {
    showProblemGenerator,
    setShowProblemGenerator,
    selectedProblemType,
    setSelectedProblemType,
    problemCounts,
    handleCountChange,
    showTestSheet,
    setShowTestSheet,
    generatedProblems,
    setGeneratedProblems,
    isGeneratingProblems,
    isLoadingExistingProblems,
    generationError,
    handleGenerateProblems: baseHandleGenerateProblems,
    handleLoadExistingProblems,
    handleGenerateSimilarProblems,
    resetGeneration,
    useExistingProblems,
    setUseExistingProblems,
  };
}

