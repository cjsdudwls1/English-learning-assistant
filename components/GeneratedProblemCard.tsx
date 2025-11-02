import React, { useState } from 'react';

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
}

export const GeneratedProblemCard: React.FC<GeneratedProblemCardProps> = ({ 
  problem, 
  index 
}) => {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [showExplanation, setShowExplanation] = useState(false);

  const handleChoiceClick = (choiceIndex: number) => {
    if (selectedIndex !== null) return; // 이미 선택한 경우 무시
    
    setSelectedIndex(choiceIndex);
    setShowExplanation(true);
  };

  const isCorrect = selectedIndex !== null && 
    (problem.correct_answer_index !== undefined 
      ? selectedIndex === problem.correct_answer_index
      : problem.choices[selectedIndex]?.is_correct);

  const correctIndex = problem.correct_answer_index !== undefined
    ? problem.correct_answer_index
    : problem.choices.findIndex(c => c.is_correct);

  return (
    <div className="border border-slate-200 dark:border-slate-700 rounded-lg p-4 bg-slate-50/50 dark:bg-slate-900/30">
      <div className="mb-2">
        <span className="text-sm font-medium text-indigo-600 dark:text-indigo-400">
          문제 {index + 1}
        </span>
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
                        <span className="ml-auto text-green-600 dark:text-green-400 font-bold">정답</span>
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
                ✓ 정답 해설:
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
                {isCorrect ? '✓ 선택하신 답 해설:' : '✗ 선택하신 답 오답 해설:'}
              </p>
              <p className={`text-sm ${
                isCorrect 
                  ? 'text-green-700 dark:text-green-300'
                  : 'text-red-700 dark:text-red-300'
              }`}>
                {problem.wrong_explanations[selectedIndex.toString()] || 
                 (isCorrect 
                   ? problem.explanation 
                   : '이 선택지가 왜 오답인지에 대한 설명이 없습니다.')}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

