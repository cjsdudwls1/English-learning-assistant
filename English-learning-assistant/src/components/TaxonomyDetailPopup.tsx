import React, { useState, useEffect } from 'react';
import { fetchTaxonomyByCode } from '../services/db';
import { useLanguage } from '../contexts/LanguageContext';
import { getTranslation } from '../utils/translations';
import type { Taxonomy } from '../types';

interface TaxonomyDetailPopupProps {
  code: string | null | undefined;
  onClose: () => void;
}

export const TaxonomyDetailPopup: React.FC<TaxonomyDetailPopupProps> = ({ code, onClose }) => {
  const { language } = useLanguage();
  const t = getTranslation(language);
  const [taxonomy, setTaxonomy] = useState<Taxonomy | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!code) {
      setError(t.taxonomy.noCodeError);
      setLoading(false);
      return;
    }

    const loadTaxonomy = async () => {
      try {
        setLoading(true);
        setError(null);
        const data = await fetchTaxonomyByCode(code);
        if (data) {
          setTaxonomy(data);
        } else {
          setError(t.taxonomy.notFoundError);
        }
      } catch (err) {
        console.error('Error loading taxonomy:', err);
        setError(t.taxonomy.loadError);
      } finally {
        setLoading(false);
      }
    };

    loadTaxonomy();
  }, [code]);

  if (!code) {
    return null;
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-2 sm:p-4">
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl max-w-3xl w-full max-h-[90vh] overflow-auto border border-slate-200 dark:border-slate-700">
        <div className="sticky top-0 bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 px-4 py-3 sm:px-6 sm:py-4 flex items-center justify-between gap-2">
          <h2 className="text-base sm:text-xl font-bold text-slate-800 dark:text-slate-200 min-w-0 break-words">
            {language === 'ko' ? '분류 상세 정보' : 'Classification Details'}
          </h2>
          {/* × 글리프는 32px 줄높이라 세로만 12px 모자란다. min-h를 걸면 sticky 헤더가
              32px에서 44px로 커지지만, py-1.5 + -my-1.5는 탭 상자만 44px로 넓히고
              행 높이는 헤더 그대로 둔다(패딩 6px은 헤더 py-3=12px 안에 들어간다).
              가로는 min-w로 채운다 — 배경이 없어 폭이 늘어도 눈에 보이지 않고,
              글리프 실제 폭은 폰트마다 달라 패딩으로 44px을 맞출 수가 없다.
              단 데스크톱에서는 푼다: 마우스에 탭 하한을 걸면 제목 폭만 뺏긴다. */}
          <button
            onClick={onClose}
            className="min-w-[44px] sm:min-w-0 shrink-0 py-1.5 -my-1.5 text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 text-2xl font-bold"
          >
            ×
          </button>
        </div>

        <div className="p-4 sm:p-6">
          {loading && (
            <div className="text-center py-4 sm:py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600 dark:border-indigo-400 mx-auto"></div>
              <p className="mt-4 text-slate-600 dark:text-slate-400">{t.common.loading}</p>
            </div>
          )}

          {error && (
            <div className="text-center py-4 sm:py-8">
              <p className="text-red-600 dark:text-red-400">{error}</p>
            </div>
          )}

          {taxonomy && !loading && !error && (
            <div className="space-y-4 sm:space-y-6">
              {/* 분류 계층 */}
              <div>
                <h3 className="text-sm sm:text-lg font-semibold mb-2 sm:mb-3 text-slate-800 dark:text-slate-200">
                  {language === 'ko' ? '분류 계층' : 'Classification Hierarchy'}
                </h3>
                <div className="bg-slate-50 dark:bg-slate-900/50 rounded-lg p-3 sm:p-4 space-y-2 text-sm sm:text-base break-words">
                  <div>
                    <span className="text-sm text-slate-600 dark:text-slate-400">depth1:</span>
                    <span className="ml-2 font-medium text-slate-800 dark:text-slate-200">
                      {language === 'ko' ? taxonomy.depth1 : taxonomy.depth1_en}
                    </span>
                  </div>
                  <div>
                    <span className="text-sm text-slate-600 dark:text-slate-400">depth2:</span>
                    <span className="ml-2 font-medium text-slate-800 dark:text-slate-200">
                      {language === 'ko' ? taxonomy.depth2 : taxonomy.depth2_en}
                    </span>
                  </div>
                  <div>
                    <span className="text-sm text-slate-600 dark:text-slate-400">depth3:</span>
                    <span className="ml-2 font-medium text-slate-800 dark:text-slate-200">
                      {language === 'ko' ? taxonomy.depth3 : taxonomy.depth3_en}
                    </span>
                  </div>
                  <div>
                    <span className="text-sm text-slate-600 dark:text-slate-400">depth4:</span>
                    <span className="ml-2 font-medium text-slate-800 dark:text-slate-200">
                      {language === 'ko' ? taxonomy.depth4 : taxonomy.depth4_en}
                    </span>
                  </div>
                </div>
              </div>

              {/* 정의 */}
              {(taxonomy.definition_ko || taxonomy.definition_en) && (
                <div>
                  <h3 className="text-sm sm:text-lg font-semibold mb-2 sm:mb-3 text-slate-800 dark:text-slate-200">
                    {language === 'ko' ? '정의' : 'Definition'}
                  </h3>
                  <p className="text-sm sm:text-base break-words text-slate-700 dark:text-slate-300 bg-slate-50 dark:bg-slate-900/50 rounded-lg p-3 sm:p-4">
                    {language === 'ko' ? taxonomy.definition_ko : taxonomy.definition_en}
                  </p>
                </div>
              )}

              {/* 핵심 규칙 */}
              {(taxonomy.core_rule_ko || taxonomy.core_rule_en) && (
                <div>
                  <h3 className="text-sm sm:text-lg font-semibold mb-2 sm:mb-3 text-slate-800 dark:text-slate-200">
                    {language === 'ko' ? '핵심 규칙' : 'Core Rule'}
                  </h3>
                  <p className="text-sm sm:text-base break-words text-slate-700 dark:text-slate-300 bg-slate-50 dark:bg-slate-900/50 rounded-lg p-3 sm:p-4 whitespace-pre-line">
                    {language === 'ko' ? taxonomy.core_rule_ko : taxonomy.core_rule_en}
                  </p>
                </div>
              )}

              {/* 오류 신호 */}
              {(taxonomy.error_signals_ko || taxonomy.error_signals_en) && (
                <div>
                  <h3 className="text-sm sm:text-lg font-semibold mb-2 sm:mb-3 text-slate-800 dark:text-slate-200">
                    {language === 'ko' ? '오류 신호' : 'Error Signals'}
                  </h3>
                  <p className="text-sm sm:text-base break-words text-slate-700 dark:text-slate-300 bg-slate-50 dark:bg-slate-900/50 rounded-lg p-3 sm:p-4">
                    {language === 'ko' ? taxonomy.error_signals_ko : taxonomy.error_signals_en}
                  </p>
                </div>
              )}

              {/* 예시 */}
              {(taxonomy.example_wrong || taxonomy.example_correct) && (
                <div>
                  <h3 className="text-sm sm:text-lg font-semibold mb-2 sm:mb-3 text-slate-800 dark:text-slate-200">
                    {language === 'ko' ? '예시' : 'Examples'}
                  </h3>
                  <div className="bg-slate-50 dark:bg-slate-900/50 rounded-lg p-3 sm:p-4 space-y-3 text-sm sm:text-base break-words">
                    {taxonomy.example_wrong && (
                      <div>
                        <span className="text-sm font-medium text-red-600 dark:text-red-400">❌ {language === 'ko' ? '오류 예시' : 'Wrong'}:</span>
                        <p className="mt-1 text-slate-700 dark:text-slate-300">{taxonomy.example_wrong}</p>
                      </div>
                    )}
                    {taxonomy.example_correct && (
                      <div>
                        <span className="text-sm font-medium text-green-600 dark:text-green-400">✅ {language === 'ko' ? '정답 예시' : 'Correct'}:</span>
                        <p className="mt-1 text-slate-700 dark:text-slate-300">{taxonomy.example_correct}</p>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* 관련 규칙 */}
              {taxonomy.related_rules && (
                <div>
                  <h3 className="text-sm sm:text-lg font-semibold mb-2 sm:mb-3 text-slate-800 dark:text-slate-200">
                    {language === 'ko' ? '관련 규칙' : 'Related Rules'}
                  </h3>
                  <p className="text-sm sm:text-base break-words text-slate-700 dark:text-slate-300 bg-slate-50 dark:bg-slate-900/50 rounded-lg p-3 sm:p-4">
                    {taxonomy.related_rules}
                  </p>
                </div>
              )}

              {/* 메타데이터 */}
              <div className="border-t border-slate-200 dark:border-slate-700 pt-4">
                <h3 className="text-sm sm:text-lg font-semibold mb-2 sm:mb-3 text-slate-800 dark:text-slate-200">
                  {language === 'ko' ? '메타데이터' : 'Metadata'}
                </h3>
                <div className="grid grid-cols-2 gap-2 sm:gap-4 text-xs sm:text-sm break-words">
                  {taxonomy.cefr && (
                    <div>
                      <span className="text-slate-600 dark:text-slate-400">CEFR:</span>
                      <span className="ml-2 font-medium text-slate-800 dark:text-slate-200">{taxonomy.cefr}</span>
                    </div>
                  )}
                  {taxonomy.difficulty !== null && (
                    <div>
                      <span className="text-slate-600 dark:text-slate-400">{language === 'ko' ? '난이도' : 'Difficulty'}:</span>
                      <span className="ml-2 font-medium text-slate-800 dark:text-slate-200">{taxonomy.difficulty}/5</span>
                    </div>
                  )}
                  {taxonomy.tags && taxonomy.tags.length > 0 && (
                    <div className="col-span-2">
                      <span className="text-slate-600 dark:text-slate-400">{language === 'ko' ? '태그' : 'Tags'}:</span>
                      <span className="ml-2 font-medium text-slate-800 dark:text-slate-200">
                        {taxonomy.tags.join(', ')}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

