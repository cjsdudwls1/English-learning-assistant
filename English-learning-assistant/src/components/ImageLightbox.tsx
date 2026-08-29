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

      {/* 높이는 .lightbox-image(app.css)가 잡는다 — 모바일 80svh / 데스크톱 90svh.
          인라인 style로는 미디어쿼리를 쓸 수 없어 CSS로 옮겼다. 근거는 그쪽 주석 참조. */}
      <img
        src={imageUrl}
        alt={alt}
        onClick={(e) => e.stopPropagation()}
        className="lightbox-image max-w-[94vw] sm:max-w-[90vw] object-contain rounded-lg shadow-2xl"
        style={{ userSelect: 'none' }}
      />
    </div>
  );
};
