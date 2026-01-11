import React from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import { getTranslation } from '../utils/translations';

interface AnalyzingCardProps {
  sessionId: string;
  imageUrl: string;
  onDelete?: (sessionId: string) => void;
}

export const AnalyzingCard: React.FC<AnalyzingCardProps> = ({ 
  sessionId,
  imageUrl,
  onDelete,
}) => {
  const { language } = useLanguage();
  const t = getTranslation(language);
  
  return (
    <div className="relative bg-white dark:bg-slate-800 rounded-2xl shadow-lg p-6 md:p-8 border border-slate-200 dark:border-slate-700 mb-6">
      {onDelete && (
        <button
          type="button"
          onClick={() => onDelete(sessionId)}
          aria-label={language === 'ko' ? '세션 삭제' : 'Delete session'}
          title={language === 'ko' ? '삭제' : 'Delete'}
          className="absolute right-3 top-3 inline-flex h-9 w-9 items-center justify-center rounded-full bg-red-50 text-red-700 hover:bg-red-100 dark:bg-red-900/20 dark:text-red-200 dark:hover:bg-red-900/40"
        >
          <span className="text-xl leading-none">×</span>
        </button>
      )}
      <div className="flex items-start gap-6">
        {/* 이미지 썸네일 */}
        <img 
          src={imageUrl} 
          alt={language === 'ko' ? '문제 이미지' : 'Problem Image'} 
          className="w-24 h-24 object-cover rounded border border-slate-300 dark:border-slate-600 flex-shrink-0"
        />
        
        {/* 분석 중 메시지 */}
        <div className="flex-1">
          <div className="flex items-center gap-3 mb-2">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-indigo-600 dark:border-indigo-400"></div>
            <h3 className="text-xl font-bold text-slate-800 dark:text-slate-200">
              {language === 'ko' ? 'AI 분석 중...' : 'AI Analyzing...'}
            </h3>
          </div>
          <p className="text-slate-600 dark:text-slate-400">
            {language === 'ko' 
              ? '이미지를 분석하고 있습니다. 잠시만 기다려주세요.'
              : 'Analyzing the image. Please wait a moment.'}
          </p>
        </div>
      </div>
    </div>
  );
};
