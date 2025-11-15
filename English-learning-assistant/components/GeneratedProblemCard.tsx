import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import { getTranslation } from '../utils/translations';
import { startProblemSolving, completeProblemSolving } from '../services/db';

interface Choice {
  text: string;
  is_correct: boolean;
}

interface GeneratedProblem {
  stem: string;
  choices: Choice[];
  explanation?: string;
  wrong_explanations?: Record<string, string>;
  wrong_explanation?: Record<string, string>;
  correct_answer_index?: number;
  classification?: {
    depth1?: string;
    depth2?: string;
    depth3?: string;
    depth4?: string;
  };
}

export interface GeneratedProblemResult {
  selectedIndex: number;
  isCorrect: boolean;
  timeSpentSeconds: number;
}

interface GeneratedProblemCardProps {
  problem: GeneratedProblem;
  index: number;
  problemId?: string; // generated_problems 테이블의 id
  onNext?: () => void;
  isActive?: boolean; // 현재 표시 중인 문제인지
  mode?: 'practice' | 'review';
  onResult?: (result: GeneratedProblemResult) => void;
  result?: GeneratedProblemResult;
}

export const GeneratedProblemCard: React.FC<GeneratedProblemCardProps> = ({ 
  problem, 
  index,
  problemId,
  onNext,
  isActive = true,
  mode = 'practice',
  onResult,
  result,
}) => {
  const { language } = useLanguage();
  const t = getTranslation(language);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [timeSpent, setTimeSpent] = useState<number>(0);
  const [isCompleted, setIsCompleted] = useState(false);
  const startTimeRef = useRef<number | null>(null);
  const intervalRef = useRef<number | null>(null);
  const [hasRecorded, setHasRecorded] = useState(false);
  const [hasAutoAdvanced, setHasAutoAdvanced] = useState(false);
  
  // 문제 시작 시 타이머 시작
  useEffect(() => {
    if (mode !== 'practice') {
      return;
    }

    if (isActive && !isCompleted && problemId) {
      startTimeRef.current = Date.now();
      // 타이머 시작
      intervalRef.current = window.setInterval(() => {
        if (startTimeRef.current) {
          const elapsed = Math.floor((Date.now() - startTimeRef.current) / 1000);
          setTimeSpent(elapsed);
        }
      }, 1000);
      
      // DB에 시작 시간 저장
      startProblemSolving(problemId).catch(console.error);
      
      return () => {
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
        }
      };
    }
  }, [isActive, isCompleted, problemId, mode]);

  // 연습 모드 전환 시 상태 초기화
  useEffect(() => {
    if (mode === 'practice') {
      setSelectedIndex(null);
      setIsCompleted(false);
      setTimeSpent(0);
      setHasRecorded(false);
      setHasAutoAdvanced(false);
      startTimeRef.current = null;
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    }
  }, [problemId, mode]);

  const correctIndex = problem.correct_answer_index !== undefined
    ? problem.correct_answer_index
    : problem.choices.findIndex(c => c.is_correct);

  const reviewSelectedIndex = mode === 'review' ? result?.selectedIndex ?? null : selectedIndex;
  const reviewIsCorrect = mode === 'review'
    ? result?.isCorrect ?? false
    : (selectedIndex !== null &&
      (problem.correct_answer_index !== undefined
        ? selectedIndex === problem.correct_answer_index
        : problem.choices[selectedIndex]?.is_correct));

  const displayTimeSpent = useMemo(() => {
    const seconds = mode === 'review'
      ? result?.timeSpentSeconds ?? 0
      : timeSpent;

    return seconds;
  }, [mode, result?.timeSpentSeconds, timeSpent]);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const handleChoiceClick = async (choiceIndex: number) => {
    if (mode !== 'practice') return;
    if (selectedIndex !== null || isCompleted) return; // 이미 선택한 경우 무시
    
    setSelectedIndex(choiceIndex);
    setIsCompleted(true);
    
    // 타이머 중지
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    
    const now = Date.now();
    const elapsedSeconds = startTimeRef.current
      ? Math.max(0, Math.floor((now - startTimeRef.current) / 1000))
      : timeSpent;
    setTimeSpent(elapsedSeconds);

    const isCorrect = choiceIndex === correctIndex;

    // 시간 계산 및 DB 저장
    if (!hasRecorded && problemId) {
      try {
        await completeProblemSolving(problemId, isCorrect, elapsedSeconds);
        setHasRecorded(true);
      } catch (error) {
        console.error('Error saving problem solving time:', error);
      }
    }

    onResult?.({
      selectedIndex: choiceIndex,
      isCorrect,
      timeSpentSeconds: elapsedSeconds,
    });

    if (!hasAutoAdvanced && onNext) {
      setHasAutoAdvanced(true);
      window.setTimeout(() => {
        try {
          onNext();
        } catch (error) {
          console.error('Error advancing to next problem:', error);
        }
      }, 200);
    }
  };

  // 비활성 문제는 표시하지 않음
  if (mode === 'practice' && !isActive) {
    return null;
  }

  const renderChoice = (choice: Choice, cIdx: number) => {
    if (mode === 'review') {
      const isSelected = reviewSelectedIndex === cIdx;
      const isCorrectChoice = cIdx === correctIndex;
      const showCorrect = reviewSelectedIndex !== null && isCorrectChoice;

      return (
        <div
          key={cIdx}
          className={`w-full text-left p-3 rounded-lg border-2 transition-all ${
            isSelected
              ? reviewIsCorrect
                ? 'border-green-500 dark:border-green-400 bg-green-50 dark:bg-green-900/30 text-green-800 dark:text-green-200'
                : 'border-red-500 dark:border-red-400 bg-red-50 dark:bg-red-900/30 text-red-800 dark:text-red-200'
              : showCorrect
              ? 'border-green-500 dark:border-green-400 bg-green-50 dark:bg-green-900/30 text-green-800 dark:text-green-200'
              : 'border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800'
          }`}
        >
          <div className="flex items-center gap-2">
            <span className="font-semibold text-slate-600 dark:text-slate-400">
              {String.fromCharCode(65 + cIdx)}.
            </span>
            <span>{choice.text}</span>
            {reviewSelectedIndex !== null && (
              <>
                {isSelected && reviewIsCorrect && (
                  <span className="ml-auto text-green-600 dark:text-green-400 font-bold">✓</span>
                )}
                {isSelected && !reviewIsCorrect && (
                  <span className="ml-auto text-red-600 dark:text-red-400 font-bold">✗</span>
                )}
                {showCorrect && !isSelected && (
                  <span className="ml-auto text-green-600 dark:text-green-400 font-bold">{t.practice.answer}</span>
                )}
              </>
            )}
          </div>
        </div>
      );
    }

    const isSelected = selectedIndex === cIdx;

    return (
      <button
        key={cIdx}
        onClick={() => handleChoiceClick(cIdx)}
        disabled={selectedIndex !== null}
        className={`w-full text-left p-3 rounded-lg border-2 transition-all ${
          selectedIndex === null
            ? 'border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 hover:border-indigo-500 dark:hover:border-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 cursor-pointer'
            : isSelected
            ? 'border-indigo-500 dark:border-indigo-400 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-800 dark:text-indigo-200'
            : 'border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 opacity-60 cursor-not-allowed'
        }`}
      >
        <div className="flex items-center gap-2">
          <span className={`font-semibold ${selectedIndex === null ? 'text-slate-600 dark:text-slate-400' : ''}`}>
            {String.fromCharCode(65 + cIdx)}.
          </span>
          <span>{choice.text}</span>
        </div>
      </button>
    );
  };

  const explanationContent = useMemo(() => {
    if (mode !== 'review' || reviewSelectedIndex === null) {
      return null;
    }

    const explanationMap =
      problem.wrong_explanations ??
      problem.wrong_explanation ??
      {};

    return (
      <div className="mt-4 space-y-3">
        {problem.explanation && (
          <div className="p-4 bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-800 rounded-lg">
            <p className="text-sm font-semibold text-green-800 dark:text-green-200 mb-2">
              ✓ {t.practice.explanation}:
            </p>
            <p className="text-sm text-green-700 dark:text-green-300">
              {problem.explanation}
            </p>
          </div>
        )}

        {problem.wrong_explanations && reviewSelectedIndex !== null && (
          <div className={`p-4 border rounded-lg ${
            reviewIsCorrect 
              ? 'bg-green-50 dark:bg-green-900/30 border-green-200 dark:border-green-800'
              : 'bg-red-50 dark:bg-red-900/30 border-red-200 dark:border-red-800'
          }`}>
            <p className={`text-sm font-semibold mb-2 ${
              reviewIsCorrect 
                ? 'text-green-800 dark:text-green-200'
                : 'text-red-800 dark:text-red-200'
            }`}>
              {reviewIsCorrect ? `✓ ${t.practice.selectedAnswer}:` : `✗ ${t.practice.wrongExplanation}:`}
            </p>
            <p className={`text-sm ${
              reviewIsCorrect 
                ? 'text-green-700 dark:text-green-300'
                : 'text-red-700 dark:text-red-300'
            }`}>
              {explanationMap[reviewSelectedIndex.toString()] ||
               (reviewIsCorrect 
                 ? problem.explanation
                 : t.practice.noExplanation)}
            </p>
          </div>
        )}
      </div>
    );
  }, [mode, problem.explanation, problem.wrong_explanations, reviewIsCorrect, reviewSelectedIndex, t.practice.explanation, t.practice.noExplanation, t.practice.selectedAnswer, t.practice.wrongExplanation]);
  
  return (
    <div className="border border-slate-200 dark:border-slate-700 rounded-lg p-4 bg-slate-50/50 dark:bg-slate-900/30">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-medium text-indigo-600 dark:text-indigo-400">
          {t.practice.problem} {index + 1}
        </span>
        {displayTimeSpent > 0 && (
          <span className="text-xs text-slate-500 dark:text-slate-400">
            {t.practice.timeSpent}: {formatTime(displayTimeSpent)}
          </span>
        )}
        {problem.classification && (
          <span className="ml-2 text-xs text-slate-500 dark:text-slate-400">
            ({problem.classification.depth1} 
            {problem.classification.depth2 && ` > ${problem.classification.depth2}`}
            {problem.classification.depth3 && ` > ${problem.classification.depth3}`}
            {problem.classification.depth4 && ` > ${problem.classification.depth4}`})
          </span>
        )}
      </div>
      
      <div className="text-slate-700 dark:text-slate-300 mb-4">
        <p className="font-medium mb-3 text-lg">{problem.stem}</p>
        
        {/* 선택지 */}
        <div className="space-y-2">
          {problem.choices.map((choice, cIdx) => renderChoice(choice, cIdx))}
        </div>
      </div>

      {mode === 'practice' && isCompleted && (
        <p className="mt-4 text-sm text-slate-600 dark:text-slate-300">{t.practice.answerLocked}</p>
      )}

      {mode === 'review' && explanationContent}

      {/* 다음 문제 버튼 */}
    </div>
  );
};

