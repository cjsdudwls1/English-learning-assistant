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

                  {/* 대안 B: 인라인 강조 — 본문(좌측 보더) + 정답(배지) → hr → 메타 */}

                  {/* 본문 — 좌측 indigo 보더 하이라이트 */}
                  {item.content?.stem && (
                    <div className="border-l-4 border-indigo-400 pl-3 mb-2">
                      <p className="text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap">
                        {item.content.stem}
                      </p>
                      {item.content.choices && item.content.choices.length > 0 && (
                        <ol className="mt-1.5 list-decimal list-inside space-y-0.5 text-sm text-slate-600 dark:text-slate-400">
                          {item.content.choices.map((choice, i: number) => {
                            const text = typeof choice === 'string' ? choice : (choice?.text ?? '');
                            return <li key={i}>{text}</li>;
                          })}
                        </ol>
                      )}
                    </div>
                  )}

                  {/* 사용자 답안 vs 정답 — 인라인 배지 */}
                  {(item.correct_answer || item.user_answer) && (
                    <div className="flex flex-wrap items-center gap-3 mb-3">
                      {item.user_answer && (
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                            {language === 'ko' ? '내 답' : 'My Answer'}
                          </span>
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold border ${
                              item.is_correct
                                ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 border-emerald-300 dark:border-emerald-700'
                                : 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 border-red-300 dark:border-red-700'
                            }`}
                          >
                            {item.user_answer}
                          </span>
                        </div>
                      )}
                      {item.correct_answer && (
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                            {language === 'ko' ? '정답' : 'Answer'}
                          </span>
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-700">
                            {item.correct_answer}
                          </span>
                        </div>
                      )}
                    </div>
                  )}

                  {/* 원본 이미지 썸네일 (세션 단위) */}
                  {item.session.image_urls && item.session.image_urls.length > 0 && (
                    <div className="mb-3">
                      <div className="text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1.5">
                        {language === 'ko' ? '원본 이미지' : 'Original Image'}
                        {item.session.image_urls.length > 1 && ` (${item.session.image_urls.length})`}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {item.session.image_urls.map((url, i) => (
                          <a
                            key={i}
                            href={url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="block w-20 h-20 rounded-md overflow-hidden border border-slate-300 dark:border-slate-600 hover:ring-2 hover:ring-indigo-400 transition"
                            title={language === 'ko' ? '새 탭에서 원본 보기' : 'Open original in new tab'}
                          >
                            <img
                              src={url}
                              alt={`page ${i + 1}`}
                              className="w-full h-full object-cover"
                              loading="lazy"
                            />
                          </a>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* 구분선 */}
                  {(item.content?.stem || item.correct_answer || item.user_answer || item.session.image_urls?.length) && (
                    <hr className="border-slate-200 dark:border-slate-700 mb-3" />
                  )}

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

