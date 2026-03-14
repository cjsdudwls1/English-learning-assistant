import React, { useEffect, useCallback } from 'react';

interface ImageLightboxProps {
  imageUrl: string;
  alt?: string;
  onClose: () => void;
}

/**
 * 이미지를 전체 화면 오버레이로 표시하는 라이트박스 컴포넌트.
 * 배경 클릭, ESC 키, 닫기 버튼으로 닫을 수 있음.
 */
export const ImageLightbox: React.FC<ImageLightboxProps> = ({ imageUrl, alt = '', onClose }) => {
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    },
    [onClose]
  );

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    // 스크롤 방지
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
    };
  }, [handleKeyDown]);

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 backdrop-blur-sm"
      onClick={onClose}
    >
      {/* 닫기 버튼 */}
      <button
        type="button"
        onClick={onClose}
        className="absolute top-4 right-4 z-10 inline-flex h-10 w-10 items-center justify-center rounded-full bg-white/20 text-white hover:bg-white/40 transition-colors text-2xl leading-none"
        aria-label="Close"
      >
        &times;
      </button>

      {/* 이미지 */}
      <img
        src={imageUrl}
        alt={alt}
        onClick={(e) => e.stopPropagation()}
        className="max-w-[90vw] max-h-[90vh] object-contain rounded-lg shadow-2xl"
        style={{ userSelect: 'none' }}
      />
    </div>
  );
};
