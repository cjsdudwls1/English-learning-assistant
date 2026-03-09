import { useState, useCallback } from 'react';
import { useProblemGeneration } from './useProblemGeneration';
import { loadProblemsWithExisting } from '../services/problemLoader';
import type { AIGenerationOptions } from '../services/problemLoader';
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
  handleGenerateWithOptions: (options: AIGenerationOptions) => void;
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
  const [aiOptions, setAiOptions] = useState<AIGenerationOptions | undefined>(undefined);

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
      setAiOptions(undefined);
    },
    onError,
    aiOptions,
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

  const handleGenerateWithOptions = useCallback((options: AIGenerationOptions) => {
    setAiOptions(options);
    // aiOptions state가 업데이트된 후 다음 렌더링에서 useProblemGeneration이 새 aiOptions를 반영
    // 직접 생성 호출은 setTimeout으로 다음 tick에서 실행
    setTimeout(() => {
      baseHandleGenerateProblems();
    }, 0);
  }, [baseHandleGenerateProblems]);

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
      // "기존 문제 불러오기"는 분류 필터 없이 유형별로 DB 전체에서 조회
      // (분류 필터를 걸면 자동 선택된 구체적 분류에 매칭되는 문제만 나와 대부분 부족 처리됨)
      const result = await loadProblemsWithExisting(
        {
          problemCounts,
          // classification을 전달하지 않아 유형별 전체 조회
          language,
          userId,
          exactMatchOnly: false,
        },
        (stage, message, details) => {
          console.log(`[Load Existing] Stage ${stage}: ${message}`, details);
        }
      );

      // 부족분 확인
      const shortageEntries = Object.entries(result.shortage);
      if (shortageEntries.length > 0) {
        const typeLabels: Record<string, string> = {
          multiple_choice: language === 'ko' ? '객관식' : 'Multiple Choice',
          short_answer: language === 'ko' ? '단답형' : 'Short Answer',
          essay: language === 'ko' ? '서술형' : 'Essay',
          ox: 'O/X',
        };
        const shortageTotal = shortageEntries.reduce((sum, [, count]) => sum + count, 0);
        const shortageDetails = shortageEntries
          .map(([type, count]) => `${typeLabels[type] || type} ${count}개`)
          .join(', ');

        const confirmMsg = language === 'ko'
          ? `DB에 ${shortageTotal}개 문제가 부족합니다.\n(${shortageDetails})\n\nAI로 부족분을 생성하시겠습니까?\n(취소하면 있는 문제만으로 시험지를 구성합니다)`
          : `${shortageTotal} problems are missing.\n(${shortageDetails})\n\nGenerate missing problems with AI?\n(Cancel to use only existing problems)`;

        if (window.confirm(confirmMsg)) {
          // AI로 부족분 생성
          const { generateShortageProblems } = await import('../services/problemLoader');
          const newProblems = await generateShortageProblems(
            result.shortage,
            undefined, // 분류 필터 없이 생성
            userId,
            language,
            (stage, message, details) => {
              console.log(`[Generate Shortage] Stage ${stage}: ${message}`, details);
            }
          );
          result.problems.push(...newProblems);
        }
      }

      setGeneratedProblems(result.problems);
      if (result.problems.length > 0) {
        setShowTestSheet(true);
        setShowProblemGenerator(false);
      } else {
        onError(language === 'ko'
          ? 'DB에 해당 조건의 문제가 없습니다. AI로 시험지 생성을 이용해주세요.'
          : 'No matching problems found. Please use AI generation.');
      }
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
    handleGenerateWithOptions,
    handleLoadExistingProblems,
    handleGenerateSimilarProblems,
    resetGeneration,
    useExistingProblems,
    setUseExistingProblems,
  };
}

