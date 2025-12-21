import React, { useState, useEffect, useRef } from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import { getTranslation } from '../utils/translations';
import { ProblemEditMode } from './ProblemEditMode';
import { getCurrentUserId } from '../services/db';
import { supabase } from '../services/supabaseClient';

type ProblemType = 'multiple_choice' | 'short_answer' | 'essay' | 'ox';

interface TestSheetViewProps {
  problems: any[];
  problemType: ProblemType;
}

interface UserAnswer {
  problemId: string;
  answer: string | number | boolean | null;
}

interface QuizResult {
  problemId: string;
  userAnswer: string | number | boolean | null;
  correctAnswer: string | number | boolean | null;
  isCorrect: boolean;
  problemType: ProblemType;
  classification: any;
  explanation?: string;
}

export const TestSheetView: React.FC<TestSheetViewProps> = ({ problems, problemType }) => {
  const { language } = useLanguage();
  const t = getTranslation(language);
  const [editingProblemId, setEditingProblemId] = useState<string | null>(null);
  const [userRole, setUserRole] = useState<string | null>(null);
  const [isPrintMode, setIsPrintMode] = useState(false);
  const [problemsList, setProblemsList] = useState(problems);
  const [userAnswers, setUserAnswers] = useState<Record<string, UserAnswer>>({});
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [quizResults, setQuizResults] = useState<QuizResult[]>([]);
  const [startTime, setStartTime] = useState<number>(Date.now());
  const [elapsedTime, setElapsedTime] = useState<number>(0);
  const timerIntervalRef = useRef<NodeJS.Timeout | null>(null);

  React.useEffect(() => {
    // 출처 정보(_source)를 포함하여 문제 목록 설정
    setProblemsList(problems.map(p => ({
      ...p,
      _source: (p as any)._source || undefined, // 출처 정보 유지
    })));
    setStartTime(Date.now());
    setUserAnswers({});
    setIsSubmitted(false);
    setQuizResults([]);
  }, [problems]);

  useEffect(() => {
    if (!isSubmitted) {
      timerIntervalRef.current = setInterval(() => {
        setElapsedTime(Date.now() - startTime);
      }, 1000);
    } else {
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
        timerIntervalRef.current = null;
      }
    }

    return () => {
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
      }
    };
  }, [isSubmitted, startTime]);

  React.useEffect(() => {
    const checkUserRole = async () => {
      try {
        const userId = await getCurrentUserId();
        const { data: profile } = await supabase
          .from('profiles')
          .select('role')
          .eq('user_id', userId)
          .single();
        setUserRole(profile?.role || null);
      } catch (error) {
        console.error('Error checking user role:', error);
      }
    };
    checkUserRole();
  }, []);

  const isTeacher = userRole === 'teacher';

  const formatTime = (ms: number): string => {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}분 ${seconds}초`;
  };

  const handleAnswerChange = (problemId: string, answer: string | number | boolean) => {
    if (isSubmitted) return;
    setUserAnswers(prev => ({
      ...prev,
      [problemId]: { problemId, answer }
    }));
  };

  const handleSubmit = () => {
    const results: QuizResult[] = problemsList.map((problem) => {
      const userAnswer = userAnswers[problem.id]?.answer;
      const currentProblemType = problem.problem_type || problemType;
      
      let correctAnswer: string | number | boolean | null = null;
      let isCorrect = false;

      if (currentProblemType === 'multiple_choice') {
        correctAnswer = problem.correct_answer_index;
        isCorrect = userAnswer === correctAnswer;
      } else if (currentProblemType === 'short_answer') {
        correctAnswer = problem.correct_answer || '';
        isCorrect = String(userAnswer || '').trim().toLowerCase() === String(correctAnswer).trim().toLowerCase();
      } else if (currentProblemType === 'ox') {
        correctAnswer = problem.is_correct;
        isCorrect = userAnswer === correctAnswer;
      } else if (currentProblemType === 'essay') {
        // 서술형은 자동 채점 불가, 사용자 답안만 저장
        correctAnswer = null;
        isCorrect = false;
      }

      return {
        problemId: problem.id,
        userAnswer,
        correctAnswer,
        isCorrect,
        problemType: currentProblemType,
        classification: problem.classification || {},
        explanation: problem.explanation
      };
    });

    setQuizResults(results);
    setIsSubmitted(true);
    if (timerIntervalRef.current) {
      clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = null;
    }
    setElapsedTime(Date.now() - startTime);
  };

  const handlePrint = () => {
    setIsPrintMode(true);
    window.print();
    setTimeout(() => setIsPrintMode(false), 1000);
  };

  const handleProblemUpdate = (updatedProblem: any) => {
    setProblemsList(prev => 
      prev.map(p => p.id === updatedProblem.id ? { ...p, ...updatedProblem } : p)
    );
    setEditingProblemId(null);
  };

  const renderProblem = (problem: any, index: number) => {
    const currentProblemType = problem.problem_type || problemType;
    const userAnswer = userAnswers[problem.id]?.answer;
    const result = quizResults.find(r => r.problemId === problem.id);
    const isAnswered = userAnswer !== null && userAnswer !== undefined && userAnswer !== '';
    
    // 출처 정보 확인 (디버깅용)
    if (editingProblemId === problem.id && isTeacher) {
      return (
        <ProblemEditMode
          key={problem.id}
          problem={problem}
          problemType={currentProblemType}
          onSave={handleProblemUpdate}
          onCancel={() => setEditingProblemId(null)}
        />
      );
    }

    return (
      <div
        key={problem.id || index}
        className={`mb-6 p-4 border-2 rounded-lg ${
          isSubmitted 
            ? result?.isCorrect 
              ? 'border-green-500 bg-green-50 dark:bg-green-900/20' 
              : 'border-red-500 bg-red-50 dark:bg-red-900/20'
            : 'border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800'
        } ${isPrintMode ? 'break-inside-avoid' : ''}`}
      >
        <div className="flex items-start justify-between mb-3">
          <div className="flex-1">
          <span className="text-lg font-semibold text-slate-700 dark:text-slate-300">
            {index + 1}. {problem.stem}
          </span>
          </div>
          <div className="flex items-center gap-2">
          {isTeacher && problem.is_editable && !isSubmitted && (
            <button
              onClick={() => setEditingProblemId(problem.id)}
                className="px-3 py-1 text-xs bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 rounded hover:bg-indigo-200 dark:hover:bg-indigo-900/50 transition-colors"
            >
              {language === 'ko' ? '편집' : 'Edit'}
            </button>
          )}
          {isSubmitted && (
              <span className={`px-3 py-1 text-xs font-semibold rounded ${
              result?.isCorrect 
                ? 'bg-green-500 text-white' 
                : 'bg-red-500 text-white'
            }`}>
              {result?.isCorrect ? (language === 'ko' ? '정답' : 'Correct') : (language === 'ko' ? '오답' : 'Wrong')}
            </span>
          )}
          </div>
        </div>

        {currentProblemType === 'multiple_choice' && problem.choices && (
          <div className="space-y-2 mt-3">
            {problem.choices.map((choice: any, cIdx: number) => {
              const isSelected = userAnswer === cIdx;
              const isCorrect = problem.correct_answer_index === cIdx;
              const showAnswer = isSubmitted && isCorrect;
              
              return (
                <label
                  key={cIdx}
                  className={`flex items-center p-3 border-2 rounded cursor-pointer transition-colors ${
                    isSubmitted
                      ? showAnswer
                        ? 'border-green-500 bg-green-100 dark:bg-green-900/30'
                        : isSelected && !isCorrect
                        ? 'border-red-500 bg-red-100 dark:bg-red-900/30'
                        : 'border-slate-200 dark:border-slate-700'
                      : isSelected
                      ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/30'
                      : 'border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600'
                  } ${isSubmitted ? 'cursor-default' : ''}`}
                >
                  <input
                    type="radio"
                    name={`problem-${problem.id}`}
                    value={cIdx}
                    checked={isSelected}
                    onChange={(e) => handleAnswerChange(problem.id, parseInt(e.target.value))}
                    disabled={isSubmitted}
                    className="mr-3 w-4 h-4 text-blue-600"
                  />
                  <span className="font-medium text-slate-600 dark:text-slate-400 mr-2">
                    {String.fromCharCode(65 + cIdx)}.
                  </span>
                  <span className="flex-1">{choice.text || choice}</span>
                  {isSubmitted && showAnswer && (
                    <span className="ml-2 text-green-600 dark:text-green-400 font-semibold">
                      ✓
                    </span>
                  )}
                </label>
              );
            })}
          </div>
        )}

        {currentProblemType === 'short_answer' && (
          <div className="mt-3">
            <input
              type="text"
              value={userAnswer as string || ''}
              onChange={(e) => handleAnswerChange(problem.id, e.target.value)}
              disabled={isSubmitted}
              placeholder={language === 'ko' ? '답을 입력하세요' : 'Enter your answer'}
              className={`w-full px-4 py-2 border-2 rounded-lg ${
                isSubmitted
                  ? result?.isCorrect
                    ? 'border-green-500 bg-green-50 dark:bg-green-900/20'
                    : 'border-red-500 bg-red-50 dark:bg-red-900/20'
                  : 'border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700'
              } ${isSubmitted ? 'cursor-default' : ''}`}
            />
            {isSubmitted && problem.correct_answer && (
              <div className="mt-2 text-sm">
                <span className="font-semibold text-slate-700 dark:text-slate-300">
                  {language === 'ko' ? '정답: ' : 'Correct Answer: '}
                </span>
                <span className="text-green-600 dark:text-green-400">{problem.correct_answer}</span>
              </div>
            )}
          </div>
        )}

        {currentProblemType === 'essay' && (
          <div className="mt-3">
            {problem.guidelines && (
              <div className="mb-2 text-sm text-slate-600 dark:text-slate-400 italic">
                {problem.guidelines}
              </div>
            )}
            <textarea
              value={userAnswer as string || ''}
              onChange={(e) => handleAnswerChange(problem.id, e.target.value)}
              disabled={isSubmitted}
              placeholder={language === 'ko' ? '답을 작성하세요' : 'Write your answer'}
              rows={6}
              className={`w-full px-4 py-2 border-2 rounded-lg resize-none ${
                isSubmitted
                  ? 'border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-900/50'
                  : 'border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700'
              } ${isSubmitted ? 'cursor-default' : ''}`}
            />
          </div>
        )}

        {currentProblemType === 'ox' && (
          <div className="mt-3 flex gap-4">
            <label
              className={`flex items-center gap-2 px-4 py-2 border-2 rounded cursor-pointer transition-colors ${
                isSubmitted
                  ? problem.is_correct === true
                    ? 'border-green-500 bg-green-100 dark:bg-green-900/30'
                    : userAnswer === true && problem.is_correct !== true
                    ? 'border-red-500 bg-red-100 dark:bg-red-900/30'
                    : 'border-slate-200 dark:border-slate-700'
                  : userAnswer === true
                  ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/30'
                  : 'border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600'
              } ${isSubmitted ? 'cursor-default' : ''}`}
            >
              <input
                type="radio"
                name={`problem-${problem.id}`}
                checked={userAnswer === true}
                onChange={() => handleAnswerChange(problem.id, true)}
                disabled={isSubmitted}
                className="w-5 h-5 text-blue-600"
              />
              <span>O (True)</span>
              {isSubmitted && problem.is_correct === true && (
                <span className="ml-2 text-green-600 dark:text-green-400 font-semibold">✓</span>
              )}
            </label>
            <label
              className={`flex items-center gap-2 px-4 py-2 border-2 rounded cursor-pointer transition-colors ${
                isSubmitted
                  ? problem.is_correct === false
                    ? 'border-green-500 bg-green-100 dark:bg-green-900/30'
                    : userAnswer === false && problem.is_correct !== false
                    ? 'border-red-500 bg-red-100 dark:bg-red-900/30'
                    : 'border-slate-200 dark:border-slate-700'
                  : userAnswer === false
                  ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/30'
                  : 'border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600'
              } ${isSubmitted ? 'cursor-default' : ''}`}
            >
              <input
                type="radio"
                name={`problem-${problem.id}`}
                checked={userAnswer === false}
                onChange={() => handleAnswerChange(problem.id, false)}
                disabled={isSubmitted}
                className="w-5 h-5 text-blue-600"
              />
              <span>X (False)</span>
              {isSubmitted && problem.is_correct === false && (
                <span className="ml-2 text-green-600 dark:text-green-400 font-semibold">✓</span>
              )}
            </label>
          </div>
        )}

        {isSubmitted && problem.explanation && (
          <div className="mt-3 p-3 bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800 rounded text-sm">
            <span className="font-semibold text-blue-800 dark:text-blue-200">
              {language === 'ko' ? '해설: ' : 'Explanation: '}
            </span>
            <span className="text-blue-700 dark:text-blue-300">{problem.explanation}</span>
          </div>
        )}
      </div>
    );
  };

  const renderResultSummary = () => {
    if (!isSubmitted || quizResults.length === 0) return null;

    const totalProblems = quizResults.length;
    const correctCount = quizResults.filter(r => r.isCorrect).length;
    const wrongCount = totalProblems - correctCount;
    const accuracy = totalProblems > 0 ? Math.round((correctCount / totalProblems) * 100) : 0;

    // 문제 유형별 통계
    const typeStats: Record<string, { total: number; correct: number }> = {};
    quizResults.forEach(result => {
      const type = result.problemType;
      if (!typeStats[type]) {
        typeStats[type] = { total: 0, correct: 0 };
      }
      typeStats[type].total++;
      if (result.isCorrect) {
        typeStats[type].correct++;
      }
    });

    // 카테고리별 통계
    const categoryStats: Record<string, { total: number; correct: number }> = {};
    quizResults.forEach(result => {
      const classification = result.classification || {};
      const category = classification.depth1 || '기타';
      if (!categoryStats[category]) {
        categoryStats[category] = { total: 0, correct: 0 };
      }
      categoryStats[category].total++;
      if (result.isCorrect) {
        categoryStats[category].correct++;
      }
    });

    const typeLabels: Record<string, string> = {
      multiple_choice: language === 'ko' ? '객관식' : 'Multiple Choice',
      short_answer: language === 'ko' ? '단답형' : 'Short Answer',
      essay: language === 'ko' ? '서술형' : 'Essay',
      ox: language === 'ko' ? 'O/X' : 'True/False'
    };

    return (
      <div className="mt-8 p-6 bg-white dark:bg-slate-800 rounded-lg shadow-lg border border-slate-200 dark:border-slate-700">
        <h2 className="text-2xl font-bold text-slate-800 dark:text-slate-200 mb-6">
          {language === 'ko' ? '시험 결과' : 'Test Results'}
        </h2>

        {/* 기본 통계 */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <div className="p-4 bg-blue-50 dark:bg-blue-900/30 rounded-lg">
            <div className="text-sm text-blue-600 dark:text-blue-400 mb-1">
              {language === 'ko' ? '소요 시간' : 'Time Taken'}
            </div>
            <div className="text-2xl font-bold text-blue-800 dark:text-blue-200">
              {formatTime(elapsedTime)}
            </div>
          </div>
          <div className="p-4 bg-green-50 dark:bg-green-900/30 rounded-lg">
            <div className="text-sm text-green-600 dark:text-green-400 mb-1">
              {language === 'ko' ? '정답' : 'Correct'}
            </div>
            <div className="text-2xl font-bold text-green-800 dark:text-green-200">
              {correctCount} / {totalProblems}
            </div>
          </div>
          <div className="p-4 bg-red-50 dark:bg-red-900/30 rounded-lg">
            <div className="text-sm text-red-600 dark:text-red-400 mb-1">
              {language === 'ko' ? '오답' : 'Wrong'}
            </div>
            <div className="text-2xl font-bold text-red-800 dark:text-red-200">
              {wrongCount} / {totalProblems}
            </div>
          </div>
          <div className="p-4 bg-purple-50 dark:bg-purple-900/30 rounded-lg">
            <div className="text-sm text-purple-600 dark:text-purple-400 mb-1">
              {language === 'ko' ? '정답률' : 'Accuracy'}
            </div>
            <div className="text-2xl font-bold text-purple-800 dark:text-purple-200">
              {accuracy}%
            </div>
          </div>
        </div>

        {/* 맞춘/틀린 문제 그래프 */}
        <div className="mb-6">
          <h3 className="text-lg font-semibold text-slate-700 dark:text-slate-300 mb-3">
            {language === 'ko' ? '정답/오답 현황' : 'Correct/Wrong Status'}
          </h3>
          <div className="flex items-center gap-2 h-12 bg-slate-100 dark:bg-slate-700 rounded-lg overflow-hidden">
            <div
              className="h-full bg-green-500 flex items-center justify-center text-white font-semibold transition-all"
              style={{ width: `${(correctCount / totalProblems) * 100}%` }}
            >
              {correctCount > 0 && `${correctCount}`}
            </div>
            <div
              className="h-full bg-red-500 flex items-center justify-center text-white font-semibold transition-all"
              style={{ width: `${(wrongCount / totalProblems) * 100}%` }}
            >
              {wrongCount > 0 && `${wrongCount}`}
            </div>
          </div>
        </div>

        {/* 문제 유형별 통계 */}
        <div className="mb-6">
          <h3 className="text-lg font-semibold text-slate-700 dark:text-slate-300 mb-3">
            {language === 'ko' ? '문제 유형별 통계' : 'Statistics by Problem Type'}
          </h3>
          <div className="space-y-2">
            {Object.entries(typeStats).map(([type, stats]) => {
              const typeAccuracy = stats.total > 0 ? Math.round((stats.correct / stats.total) * 100) : 0;
              return (
                <div key={type} className="p-3 bg-slate-50 dark:bg-slate-900/50 rounded-lg">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-medium text-slate-700 dark:text-slate-300">
                      {typeLabels[type] || type}
                    </span>
                    <span className="text-sm text-slate-600 dark:text-slate-400">
                      {stats.correct} / {stats.total} ({typeAccuracy}%)
                    </span>
                  </div>
                  <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-2">
                    <div
                      className="bg-blue-500 h-2 rounded-full transition-all"
                      style={{ width: `${typeAccuracy}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* 카테고리별 통계 */}
        <div className="mb-6">
          <h3 className="text-lg font-semibold text-slate-700 dark:text-slate-300 mb-3">
            {language === 'ko' ? '카테고리별 통계' : 'Statistics by Category'}
          </h3>
          <div className="space-y-2">
            {Object.entries(categoryStats).map(([category, stats]) => {
              const categoryAccuracy = stats.total > 0 ? Math.round((stats.correct / stats.total) * 100) : 0;
              return (
                <div key={category} className="p-3 bg-slate-50 dark:bg-slate-900/50 rounded-lg">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-medium text-slate-700 dark:text-slate-300">
                      {category}
                    </span>
                    <span className="text-sm text-slate-600 dark:text-slate-400">
                      {stats.correct} / {stats.total} ({categoryAccuracy}%)
                    </span>
                  </div>
                  <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-2">
                    <div
                      className="bg-indigo-500 h-2 rounded-full transition-all"
                      style={{ width: `${categoryAccuracy}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  };

  const allAnswered = problemsList.every(problem => {
    const answer = userAnswers[problem.id]?.answer;
    return answer !== null && answer !== undefined && answer !== '';
  });

  return (
    <div className={`${isPrintMode ? 'print-mode' : ''}`}>
      {/* 인쇄 모드가 아닐 때만 표시되는 컨트롤 */}
      {!isPrintMode && (
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="text-sm text-slate-600 dark:text-slate-400">
              {language === 'ko' 
                ? `총 ${problemsList.length}문제` 
                : `Total ${problemsList.length} problems`}
            </div>
            {!isSubmitted && (
              <div className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                {language === 'ko' ? '소요 시간: ' : 'Time: '}
                {formatTime(elapsedTime)}
              </div>
            )}
          </div>
          <div className="flex gap-2">
            {!isSubmitted && (
              <button
                onClick={handleSubmit}
                disabled={!allAnswered}
                className={`px-6 py-2 rounded-lg font-semibold transition-colors ${
                  allAnswered
                    ? 'bg-blue-600 text-white hover:bg-blue-700'
                    : 'bg-slate-300 dark:bg-slate-600 text-slate-500 dark:text-slate-400 cursor-not-allowed'
                }`}
              >
                {language === 'ko' ? '제출' : 'Submit'}
              </button>
            )}
            <button
              onClick={handlePrint}
              className="px-4 py-2 bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-lg hover:bg-slate-300 dark:hover:bg-slate-600 transition-colors"
            >
              {language === 'ko' ? '인쇄' : 'Print'}
            </button>
          </div>
        </div>
      )}

      {!allAnswered && !isSubmitted && (
        <div className="mb-4 p-3 bg-yellow-50 dark:bg-yellow-900/30 border border-yellow-200 dark:border-yellow-800 rounded-lg">
          <p className="text-sm text-yellow-800 dark:text-yellow-200">
            {language === 'ko' 
              ? '모든 문제에 답을 입력해주세요.' 
              : 'Please answer all problems.'}
          </p>
        </div>
      )}

      {/* 시험지 본문 */}
      <div className={`bg-white dark:bg-slate-800 p-6 rounded-lg ${isPrintMode ? 'shadow-none' : 'shadow-lg'}`}>
        <div className="mb-6 text-center border-b-2 border-slate-300 dark:border-slate-600 pb-4">
          <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-200 mb-2">
            {language === 'ko' ? '영어 문제 시험지' : 'English Test Sheet'}
          </h1>
          <div className="text-sm text-slate-600 dark:text-slate-400">
            {language === 'ko' 
              ? `문제 유형: ${problemType === 'multiple_choice' ? '객관식' : problemType === 'short_answer' ? '단답형' : problemType === 'essay' ? '서술형' : 'O/X'} | 총 ${problemsList.length}문제`
              : `Type: ${problemType === 'multiple_choice' ? 'Multiple Choice' : problemType === 'short_answer' ? 'Short Answer' : problemType === 'essay' ? 'Essay' : 'True/False'} | Total ${problemsList.length} problems`}
          </div>
        </div>

        <div className="space-y-4">
          {problemsList.map((problem, index) => renderProblem(problem, index))}
        </div>
      </div>

      {/* 결과 요약 */}
      {renderResultSummary()}

      <style>{`
        @media print {
          .print-mode {
            page-break-after: always;
          }
          .print-mode > div {
            page-break-inside: avoid;
          }
          button {
            display: none !important;
          }
        }
      `}</style>
    </div>
  );
};
