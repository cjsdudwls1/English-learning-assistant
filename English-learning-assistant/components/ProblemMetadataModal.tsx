import React from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import { getTranslation } from '../utils/translations';
import type { ProblemMetadataItem } from '../services/db';

interface ProblemMetadataModalProps {
  items: ProblemMetadataItem[];
  isCorrect: boolean;
  onClose: () => void;
}

export const ProblemMetadataModal: React.FC<ProblemMetadataModalProps> = ({ 
  items, 
  isCorrect,
  onClose 
}) => {
  const { language } = useLanguage();
  const t = getTranslation(language);

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString(language === 'ko' ? 'ko-KR' : 'en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const getDifficultyColor = (difficulty: string) => {
    switch (difficulty) {
      case '상':
      case 'high':
        return 'text-red-600 dark:text-red-400';
      case '중':
      case 'medium':
        return 'text-yellow-600 dark:text-yellow-400';
      case '하':
      case 'low':
        return 'text-green-600 dark:text-green-400';
      default:
        return 'text-slate-600 dark:text-slate-400';
    }
  };

  const getWordDifficultyColor = (level: number) => {
    if (level >= 7) return 'text-red-600 dark:text-red-400';
    if (level >= 4) return 'text-yellow-600 dark:text-yellow-400';
    return 'text-green-600 dark:text-green-400';
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-slate-800 rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        {/* 헤더 */}
        <div className="p-6 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
          <h2 className="text-2xl font-bold text-slate-800 dark:text-slate-200">
            {isCorrect 
              ? (language === 'ko' ? '정답 문제 분석' : 'Correct Answer Analysis')
              : (language === 'ko' ? '오답 문제 분석' : 'Incorrect Answer Analysis')
            } ({items.length}{language === 'ko' ? '개' : ''})
          </h2>
          <button
            onClick={onClose}
            className="text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 text-2xl font-bold"
          >
            ×
          </button>
        </div>

        {/* 내용 */}
        <div className="flex-1 overflow-y-auto p-6">
          {items.length === 0 ? (
            <div className="text-center text-slate-500 dark:text-slate-400 py-10">
              {language === 'ko' ? '분석 정보가 없습니다.' : 'No analysis information available.'}
            </div>
          ) : (
            <div className="space-y-4">
              {items.map((item, index) => (
                <div
                  key={item.problem_id}
                  className="border border-slate-200 dark:border-slate-700 rounded-lg p-4 bg-slate-50 dark:bg-slate-900/50"
                >
                  {/* 문제 정보 헤더 (메타데이터 유무와 관계없이 표시) */}
                  <div className="flex items-center justify-between text-sm text-slate-500 dark:text-slate-400 mb-3">
                    <span>
                      {language === 'ko' ? '문제 #' : 'Problem #'}{index + 1}
                    </span>
                    <span>{formatDate(item.session.created_at)}</span>
                  </div>

                  {/* 메타데이터가 없는 경우 */}
                  {!item.metadata ? (
                    <div className="p-3 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg">
                      <div className="flex items-start gap-2">
                        <span className="text-yellow-600 dark:text-yellow-400">⚠️</span>
                        <div className="flex-1">
                          <p className="text-sm font-medium text-yellow-800 dark:text-yellow-300 mb-1">
                            {language === 'ko' 
                              ? '분석 정보 없음' 
                              : 'No Analysis Information'}
                          </p>
                          <p className="text-xs text-yellow-700 dark:text-yellow-400">
                            {language === 'ko' 
                              ? '이 문제는 메타데이터 기능 추가 이전에 업로드된 문제입니다. 새로운 문제를 업로드하면 자동으로 분석 정보가 생성됩니다.' 
                              : 'This problem was uploaded before the metadata feature was added. New problems will automatically have analysis information generated.'}
                          </p>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {/* 난이도 */}
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-slate-700 dark:text-slate-300">
                          {t.problemMetadata.difficulty}:
                        </span>
                        <span className={getDifficultyColor(item.metadata.difficulty)}>
                          {item.metadata.difficulty}
                        </span>
                      </div>

                      {/* 단어 난이도 */}
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-slate-700 dark:text-slate-300">
                          {t.problemMetadata.wordDifficulty}:
                        </span>
                        <span className={getWordDifficultyColor(item.metadata.word_difficulty)}>
                          {item.metadata.word_difficulty} / 9
                        </span>
                      </div>

                      {/* 문제 유형 */}
                      <div>
                        <span className="font-semibold text-slate-700 dark:text-slate-300">
                          {t.problemMetadata.problemType}:
                        </span>
                        <p className="text-slate-600 dark:text-slate-400 mt-1">
                          {item.metadata.problem_type}
                        </p>
                      </div>

                      {/* 분석 정보 */}
                      <div>
                        <span className="font-semibold text-slate-700 dark:text-slate-300">
                          {t.problemMetadata.analysis}:
                        </span>
                        <p className="text-slate-600 dark:text-slate-400 mt-1 whitespace-pre-wrap">
                          {item.metadata.analysis}
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

