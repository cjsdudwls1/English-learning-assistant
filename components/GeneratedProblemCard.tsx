import React, { useState, useEffect, useRef } from 'react';
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
  correct_answer_index?: number;
  classification?: {
    depth1?: string;
    depth2?: string;
    depth3?: string;
    depth4?: string;
  };
}

interface GeneratedProblemCardProps {
  problem: GeneratedProblem;
  index: number;
  problemId?: string; // generated_problems 테이블의 id
  onNext?: () => void;
  isActive?: boolean; // 현재 표시 중인 문제인지
}

export const GeneratedProblemCard: React.FC<GeneratedProblemCardProps> = ({ 
  problem, 
  index,
  problemId,
  onNext,
  isActive = true
}) => {
  const { language } = useLanguage();
  const t = getTranslation(language);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [showExplanation, setShowExplanation] = useState(false);
  const [timeSpent, setTimeSpent] = useState<number>(0);
  const [isCompleted, setIsCompleted] = useState(false);
  const startTimeRef = useRef<number | null>(null);
  const intervalRef = useRef<number | null>(null);
  
  // 문제 시작 시 타이머 시작
  useEffect(() => {
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
  }, [isActive, isCompleted, problemId]);

  const correctIndex = problem.correct_answer_index !== undefined
    ? problem.correct_answer_index
    : problem.choices.findIndex(c => c.is_correct);

  const handleChoiceClick = async (choiceIndex: number) => {
    if (selectedIndex !== null || isCompleted) return; // 이미 선택한 경우 무시
    
    setSelectedIndex(choiceIndex);
    setShowExplanation(true);
    setIsCompleted(true);
    
    // 타이머 중지
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    
    // 시간 계산 및 DB 저장
    if (startTimeRef.current && problemId) {
      const elapsedSeconds = Math.floor((Date.now() - startTimeRef.current) / 1000);
      setTimeSpent(elapsedSeconds);
      
      const isCorrect = choiceIndex === correctIndex;
      
      // DB에 완료 시간 저장
      try {
        await completeProblemSolving(problemId, isCorrect, elapsedSeconds);
      } catch (error) {
        console.error('Error saving problem solving time:', error);
      }
    }
  };

  const isCorrect = selectedIndex !== null && 
    (problem.correct_answer_index !== undefined 
      ? selectedIndex === problem.correct_answer_index
      : problem.choices[selectedIndex]?.is_correct);

  // 비활성 문제는 표시하지 않음
  if (!isActive) {
    return null;
  }
  
  return (
    <div className="border border-slate-200 dark:border-slate-700 rounded-lg p-4 bg-slate-50/50 dark:bg-slate-900/30">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-medium text-indigo-600 dark:text-indigo-400">
          {t.practice.problem} {index + 1}
        </span>
        {timeSpent > 0 && (
          <span className="text-xs text-slate-500 dark:text-slate-400">
            {t.practice.timeSpent}: {Math.floor(timeSpent / 60)}:{(timeSpent % 60).toString().padStart(2, '0')}
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
          {problem.choices.map((choice, cIdx) => {
            const isSelected = selectedIndex === cIdx;
            const isCorrectChoice = cIdx === correctIndex;
            const showCorrect = selectedIndex !== null && isCorrectChoice;
            
            return (
              <button
                key={cIdx}
                onClick={() => handleChoiceClick(cIdx)}
                disabled={selectedIndex !== null}
                className={`w-full text-left p-3 rounded-lg border-2 transition-all ${
                  selectedIndex === null
                    ? 'border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 hover:border-indigo-500 dark:hover:border-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 cursor-pointer'
                    : isSelected
                    ? isCorrect
                      ? 'border-green-500 dark:border-green-400 bg-green-50 dark:bg-green-900/30 text-green-800 dark:text-green-200'
                      : 'border-red-500 dark:border-red-400 bg-red-50 dark:bg-red-900/30 text-red-800 dark:text-red-200'
                    : showCorrect
                    ? 'border-green-500 dark:border-green-400 bg-green-50 dark:bg-green-900/30 text-green-800 dark:text-green-200'
                    : 'border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 opacity-60 cursor-not-allowed'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className={`font-semibold ${selectedIndex === null ? 'text-slate-600 dark:text-slate-400' : ''}`}>
                    {String.fromCharCode(65 + cIdx)}.
                  </span>
                  <span>{choice.text}</span>
                  {selectedIndex !== null && (
                    <>
                      {isSelected && isCorrect && (
                        <span className="ml-auto text-green-600 dark:text-green-400 font-bold">✓</span>
                      )}
                      {isSelected && !isCorrect && (
                        <span className="ml-auto text-red-600 dark:text-red-400 font-bold">✗</span>
                      )}
                      {showCorrect && !isSelected && (
                        <span className="ml-auto text-green-600 dark:text-green-400 font-bold">{t.practice.answer}</span>
                      )}
                    </>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* 해설 표시 */}
      {showExplanation && selectedIndex !== null && (
        <div className="mt-4 space-y-3">
          {/* 정답 해설 */}
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
          
          {/* 선택한 답 해설 */}
          {problem.wrong_explanations && selectedIndex !== null && (
            <div className={`p-4 border rounded-lg ${
              isCorrect 
                ? 'bg-green-50 dark:bg-green-900/30 border-green-200 dark:border-green-800'
                : 'bg-red-50 dark:bg-red-900/30 border-red-200 dark:border-red-800'
            }`}>
              <p className={`text-sm font-semibold mb-2 ${
                isCorrect 
                  ? 'text-green-800 dark:text-green-200'
                  : 'text-red-800 dark:text-red-200'
              }`}>
                {isCorrect ? `✓ ${t.practice.selectedAnswer}:` : `✗ ${t.practice.wrongExplanation}:`}
              </p>
              <p className={`text-sm ${
                isCorrect 
                  ? 'text-green-700 dark:text-green-300'
                  : 'text-red-700 dark:text-red-300'
              }`}>
                {problem.wrong_explanations[selectedIndex.toString()] || 
                 (isCorrect 
                   ? problem.explanation 
                   : t.practice.noExplanation)}
              </p>
            </div>
          )}
        </div>
      )}
      
      {/* 다음 문제 버튼 */}
      {isCompleted && onNext && (
        <div className="mt-4 flex justify-end">
          <button
            onClick={onNext}
            className="px-4 py-2 bg-indigo-600 dark:bg-indigo-500 text-white rounded-lg hover:bg-indigo-700 dark:hover:bg-indigo-600 transition-colors"
          >
            {t.practice.nextProblem}
          </button>
        </div>
      )}
    </div>
  );
};

