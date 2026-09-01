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
 * 그리고 **폴백한 그 자리에서 썸네일을 만들어 올린다**(지연 백필). 폴백 시점엔 원본을 이미
 * 받은 뒤라 추가 송신이 0이고, 다음부터 이 이미지는 20KB로 그려진다. 자세한 배경은 thumbnail.ts.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { resolveThumbUrl } from '../utils/imageUrl';
import { backfillThumb, disableThumbBackfill, isThumbBackfillDisabled } from '../utils/thumbnail';

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

  // 백필을 위해 crossOrigin을 걸어도 되는가. Storage가 CORS를 막는 환경에서는 이미지가
  // 통째로 안 뜨므로, 그때 한 번 내려서 crossOrigin 없이 다시 그린다(백필은 포기).
  const [corsAllowed, setCorsAllowed] = useState(true);

  const imgRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    let alive = true;
    setSrc(null);
    setCorsAllowed(true);
    resolveThumbUrl(fullUrl).then((thumbUrl) => {
      if (alive) setSrc(thumbUrl || fullUrl);
    });
    return () => {
      alive = false;
    };
  }, [fullUrl]);

  // 썸네일이 없어 원본을 그리고 있는 상태 = 백필 대상.
  // 세션 전역 스위치도 함께 본다 — 한 번이라도 crossOrigin 때문에 이미지가 깨졌다면
  // 더는 걸지 않는다(이유는 thumbnail.ts의 `disableThumbBackfill` 주석).
  const isFallback = src === fullUrl;
  const backfilling = isFallback && corsAllowed && !isThumbBackfillDisabled();

  const handleLoad = useCallback(() => {
    if (!backfilling || !imgRef.current) return;
    // 실패는 backfillThumb 안에서 삼킨다. 여기서 기다릴 이유도 없다 — 화면은 이미 그려졌다.
    void backfillThumb(imgRef.current, fullUrl);
  }, [backfilling, fullUrl]);

  const handleError = useCallback(() => {
    // 1순위: 썸네일 서명은 됐는데 객체가 없는 경우. 원본으로 되돌린다.
    if (src !== fullUrl) {
      setSrc(fullUrl);
      return;
    }
    // 2순위: 원본인데도 실패했다면 crossOrigin 때문일 수 있다. 백필을 포기하고 이미지를 살린다.
    // 세션 전역으로 끈다 — 이 실패가 CORS라면 다른 이미지도 전부 같은 일을 겪고,
    // 매번 "막힌 한 번 + 다시 받는 한 번"으로 송신이 2배가 된다.
    if (corsAllowed) {
      disableThumbBackfill();
      setCorsAllowed(false);
    }
    // 둘 다 아니면 진짜 못 읽는 이미지다 — 더 시도하지 않는다(무한 재시도 방지).
  }, [src, fullUrl, corsAllowed]);

  if (!src) {
    // 같은 className이라 박스 크기가 동일하다 — 도착 시 레이아웃이 흔들리지 않는다.
    return <div className={className} aria-hidden="true" />;
  }

  return (
    <img
      // crossOrigin이 바뀌면 요청 자체가 달라진다. key로 확실히 다시 마운트시켜
      // "속성만 바뀌고 재요청은 안 되는" 브라우저 차이를 없앤다.
      key={backfilling ? 'cors' : 'plain'}
      ref={imgRef}
      src={src}
      alt={alt}
      className={className}
      title={title}
      onClick={onClick}
      loading="lazy"
      decoding="async"
      // 폴백으로 원본을 그릴 때만 건다. 이걸 안 걸면 캔버스가 오염돼 백필이 SecurityError로 죽는다.
      // 썸네일을 그릴 때는 백필할 것이 없으므로 걸지 않는다.
      crossOrigin={backfilling ? 'anonymous' : undefined}
      onLoad={handleLoad}
      onError={handleError}
    />
  );
};
