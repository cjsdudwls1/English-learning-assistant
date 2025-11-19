import { useState, useCallback } from 'react';
import { useProblemGeneration } from './useProblemGeneration';
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
  generationError: string | null;
  handleGenerateProblems: () => Promise<void>;
  handleGenerateSimilarProblems: () => void;
  resetGeneration: () => void;
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
    multiple_choice: 5,
    short_answer: 3,
    essay: 2,
    ox: 5,
  });
  const [showTestSheet, setShowTestSheet] = useState(false);
  const [generatedProblems, setGeneratedProblems] = useState<GeneratedProblem[]>([]);

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
    generationError,
    handleGenerateProblems: baseHandleGenerateProblems,
    handleGenerateSimilarProblems,
    resetGeneration,
  };
}

