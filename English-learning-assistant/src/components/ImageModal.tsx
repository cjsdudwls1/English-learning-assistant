import React, { useEffect } from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import { getTranslation } from '../utils/translations';

interface ImageModalProps {
  isOpen: boolean;
  onClose: () => void;
  imageUrl: string;
  sessionId?: string;
}

export const ImageModal: React.FC<ImageModalProps> = ({
  isOpen,
  onClose,
  imageUrl,
  sessionId
}) => {
  const { language } = useLanguage();
  const t = getTranslation(language);
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
      document.body.style.overflow = 'hidden';
    }

    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.body.style.overflow = 'unset';
    };
  }, [isOpen, onClose]);

  const handleDownload = () => {
    const link = document.createElement('a');
    link.href = imageUrl;
    link.download = sessionId 
      ? `session_${sessionId}_${Date.now()}.jpg`
      : `image_${Date.now()}.jpg`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-75"
      onClick={handleBackdropClick}
    >
      <div className="relative w-full h-full sm:w-auto sm:h-auto sm:max-w-4xl sm:max-h-[90vh] bg-white rounded-none sm:rounded-lg overflow-hidden flex flex-col">
        {/* 헤더 — 모바일에선 패널이 화면을 꽉 채워 백드롭 여백이 없다. 즉 배경 탭으로는 닫을 수 없으므로
            이 헤더의 닫기 버튼이 유일한 닫기 경로다. 항상 보이도록 상단 고정하고 탭 타깃을 44px로 준다. */}
        <div className="sticky top-0 z-10 shrink-0 flex items-center justify-between gap-2 p-3 sm:p-4 bg-slate-100 border-b">
          <h3 className="min-w-0 truncate text-base sm:text-lg font-semibold">{t.problems.imageZoomTitle}</h3>
          <div className="flex gap-2 shrink-0">
            <button
              onClick={handleDownload}
              className="inline-flex min-h-[40px] items-center justify-center px-3 py-2.5 sm:min-h-0 sm:px-4 sm:py-2 bg-blue-600 text-white text-xs sm:text-sm rounded hover:bg-blue-700"
            >
              {t.problems.download}
            </button>
            <button
              onClick={onClose}
              className="inline-flex min-h-[40px] items-center justify-center px-3 py-2.5 sm:min-h-0 sm:px-4 sm:py-2 bg-slate-600 text-white text-xs sm:text-sm rounded hover:bg-slate-700"
            >
              {t.common.close}
            </button>
          </div>
        </div>
        
        {/* 이미지 */}
        <div className="flex-1 min-h-0 overflow-auto p-2 sm:p-4">
          <img
            src={imageUrl}
            alt={t.problems.enlargedImageAlt}
            className="max-w-full max-h-full sm:max-h-[70vh] object-contain mx-auto"
          />
        </div>
      </div>
    </div>
  );
};
