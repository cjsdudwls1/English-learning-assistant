import React, { useState } from 'react';
import { ImageLightbox } from './ImageLightbox';
import { useLanguage } from '../contexts/LanguageContext';

interface AnalyzingCardProps {
  sessionId: string;
  imageUrl: string;
  imageUrls?: string[];
  onDelete?: (sessionId: string) => void;
  analysisModel?: string | null;
}

export const AnalyzingCard: React.FC<AnalyzingCardProps> = ({
  sessionId,
  imageUrl,
  imageUrls,
  onDelete,
  analysisModel,
}) => {
  const [lightboxImageUrl, setLightboxImageUrl] = useState<string | null>(null);
  const { language } = useLanguage();

  // 실제 표시할 이미지 목록 결정
  const displayImageUrls = (imageUrls && imageUrls.length > 0) ? imageUrls : (imageUrl ? [imageUrl] : []);

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
          <span className="text-xl leading-none">&times;</span>
        </button>
      )}
      <div className="flex items-start gap-6">
        {/* 다중 이미지 썸네일 */}
        <div className="flex gap-2 flex-shrink-0">
          {displayImageUrls.map((url, idx) => (
            <img
              key={`${idx}-${url}`}
              src={url}
              alt={language === 'ko' ? `문제 이미지 ${idx + 1}` : `Problem Image ${idx + 1}`}
              className="w-24 h-24 object-cover rounded border border-slate-300 dark:border-slate-600 cursor-pointer hover:opacity-80 hover:ring-2 hover:ring-indigo-400 transition-all"
              onClick={() => setLightboxImageUrl(url)}
              title={language === 'ko' ? '클릭하여 원본 보기' : 'Click to view original'}
            />
          ))}
        </div>

        {/* 분석 중 메시지 */}
        <div className="flex-1">
          <div className="flex items-center gap-3 mb-2">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-indigo-600 dark:border-indigo-400"></div>
            <h3 className="text-xl font-bold text-slate-800 dark:text-slate-200">
              {language === 'ko' ? 'AI 분석 중...' : 'AI Analyzing...'}
            </h3>
          </div>
          <p className="text-slate-600 dark:text-slate-400 mb-2">
            {language === 'ko'
              ? '이미지를 분석하고 있습니다. 잠시만 기다려주세요.'
              : 'Analyzing the image. Please wait a moment.'}
          </p>
          {displayImageUrls.length > 1 && (
            <p className="text-xs text-slate-400 dark:text-slate-500 mb-2">
              {language === 'ko'
                ? `이미지 ${displayImageUrls.length}장 (클릭하여 확대)`
                : `${displayImageUrls.length} images (click to enlarge)`}
            </p>
          )}
          {analysisModel && (
            <div className="inline-flex items-center px-3 py-1 rounded-full bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 text-sm font-medium">
              <span className="mr-1.5">&#129302;</span>
              {language === 'ko' ? '분석 중인 AI: ' : 'AI Model: '}
              {analysisModel}
            </div>
          )}
        </div>
      </div>
      {lightboxImageUrl && (
        <ImageLightbox
          imageUrl={lightboxImageUrl}
          alt={language === 'ko' ? '문제 이미지' : 'Problem Image'}
          onClose={() => setLightboxImageUrl(null)}
        />
      )}
    </div>
  );
};
