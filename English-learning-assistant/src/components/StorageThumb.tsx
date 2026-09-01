/**
 * 목록 화면용 축소 이미지.
 *
 * 왜 있는가: 목록들이 48~96px 박스에 **2048px·JPEG 0.92 원본**(장당 1~2MB)을 그대로 넣고 있었다.
 * 표시 픽셀 대비 수백 배를 내려받는 구조라, 2026-09-01 무료 플랜 송신 한도(5GB)를 넘겨
 * 프로젝트 전체가 402로 차단됐다. 저장된 원본 총량은 455MB인데 송신은 5.6GB였다 —
 * 같은 파일을 반복해서 받은 것이다(서명 URL은 발급마다 토큰이 달라 CDN 캐시가 매번 빗나간다).
 *
 * 그래서 업로드 시점에 만들어 둔 썸네일(320px·0.7, 장당 20KB 내외)을 대신 그린다.
 * 원본은 라이트박스에서만 받는다 — onClick은 여전히 원본 URL을 넘긴다.
 *
 * 썸네일이 없는 과거 세션은 원본으로 폴백한다(`resolveThumbUrl`이 빈 문자열을 준다).
 */
import React, { useEffect, useState } from 'react';
import { resolveThumbUrl } from '../utils/imageUrl';

interface StorageThumbProps {
  /** 이미 발급된 원본 signed URL. 폴백 대상이자 썸네일 path를 끌어내는 출처다. */
  fullUrl: string;
  alt: string;
  className?: string;
  title?: string;
  onClick?: () => void;
}

export const StorageThumb: React.FC<StorageThumbProps> = ({
  fullUrl,
  alt,
  className,
  title,
  onClick,
}) => {
  // null인 동안에는 <img>를 아예 렌더하지 않는다.
  // 원본을 초기값으로 두면 썸네일이 도착하기 전에 브라우저가 원본을 받아버려서 이 컴포넌트가 무의미해진다.
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setSrc(null);
    resolveThumbUrl(fullUrl).then((thumbUrl) => {
      if (alive) setSrc(thumbUrl || fullUrl);
    });
    return () => {
      alive = false;
    };
  }, [fullUrl]);

  if (!src) {
    // 같은 className이라 박스 크기가 동일하다 — 도착 시 레이아웃이 흔들리지 않는다.
    return <div className={className} aria-hidden="true" />;
  }

  return (
    <img
      src={src}
      alt={alt}
      className={className}
      title={title}
      onClick={onClick}
      loading="lazy"
      decoding="async"
      // 서명은 됐는데 객체가 없는 경우의 마지막 방어. 원본으로 한 번만 되돌린다.
      onError={() => {
        if (src !== fullUrl) setSrc(fullUrl);
      }}
    />
  );
};
