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
      <div className="relative max-w-4xl max-h-[90vh] bg-white rounded-lg overflow-hidden">
        {/* 헤더 */}
        <div className="flex items-center justify-between p-4 bg-slate-100 border-b">
          <h3 className="text-lg font-semibold">{t.problems.imageZoomTitle}</h3>
          <div className="flex gap-2">
            <button
              onClick={handleDownload}
              className="px-4 py-2 bg-blue-600 text-white text-sm rounded hover:bg-blue-700"
            >
              {t.problems.download}
            </button>
            <button
              onClick={onClose}
              className="px-4 py-2 bg-slate-600 text-white text-sm rounded hover:bg-slate-700"
            >
              {t.common.close}
            </button>
          </div>
        </div>
        
        {/* 이미지 */}
        <div className="p-4">
          <img
            src={imageUrl}
            alt={t.problems.enlargedImageAlt}
            className="max-w-full max-h-[70vh] object-contain mx-auto"
          />
        </div>
      </div>
    </div>
  );
};
