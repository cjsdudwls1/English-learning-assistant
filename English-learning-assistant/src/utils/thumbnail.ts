/**
 * 목록용 썸네일 — 규격, 인코딩, 그리고 **지연 백필**.
 *
 * 배경: 목록들이 48~96px 박스에 2048px·JPEG 0.92 원본(장당 1~2MB)을 그대로 넣고 있었다.
 * 2026-09-01 무료 플랜 송신 한도(5GB)를 넘겨 프로젝트가 402로 차단됐다 —
 * 저장은 455MB인데 송신이 5.6GB였다(서명 URL은 발급마다 토큰이 달라 CDN 캐시가 매번 빗나간다).
 *
 * 업로드 시점 썸네일 생성은 그 뒤 올라온 이미지만 고친다. 그 이전 이미지는 썸네일이 없어
 * `resolveThumbUrl`이 빈 문자열을 주고 목록이 원본으로 폴백한다 — 과거 세션은 옛 송신량 그대로다.
 *
 * 일괄 백필은 기각했다. 원본 0.455GB를 전부 내려받아야 하는데 그게 한도의 9%이고,
 * 다시는 안 볼 테스트 데이터까지 받는다. 대신 **폴백이 일어난 그 자리**에서 만든다:
 * 폴백 시점엔 브라우저가 원본을 이미 받은 뒤라 그 픽셀을 캔버스로 옮기는 데 추가 송신이 0이다.
 * 실제로 누가 본 이미지만, 본 그 순간에 고쳐진다.
 *
 * 대가는 <img>에 `crossOrigin="anonymous"`가 필요하다는 것이다. 없으면 캔버스가 오염돼
 * `toBlob`이 SecurityError로 죽는다. Supabase Storage는 CORS를 허용하지만
 * (`storage.download()` 자체가 CORS fetch다), 만에 하나 막히면 이미지가 통째로 안 뜨므로
 * 호출부(StorageThumb)가 crossOrigin 없이 한 번 더 그리는 폴백 사다리를 갖는다.
 */
import { supabase } from '../services/supabaseClient';
import { clearMissingThumb, toThumbPath, THUMB_SEGMENT } from './imageUrl';

const ANALYZE_BUCKET = 'analyze-uploads';

/**
 * 썸네일 규격.
 *
 * 목록에서 가장 큰 이미지 박스가 96 CSS px(`sm:w-24`)이라 DPR 3에서도 288px면 덮는다.
 * 320px·0.7이면 장당 20KB 안팎으로, 2048px·0.92 원본의 1/70 수준이다.
 * 판독용 원본 규격은 건드리지 않는다 — 정확도가 걸려 있다(App.tsx `compressImage` 주석 참고).
 */
export const THUMB_MAX_DIMENSION = 320;
export const THUMB_QUALITY = 0.7;

/**
 * 긴 변을 maxDimension 이하로 줄인 크기. 이미 작으면 그대로 둔다(확대하지 않는다).
 *
 * 순수 함수로 뺀 이유: 캔버스는 테스트 환경(node)에 없는데 **비율 계산이 틀리면
 * 썸네일이 조용히 뭉개지거나 원본만 한 파일이 올라간다**. 그 부분만은 검증 가능해야 한다.
 */
export function fitWithin(
  width: number,
  height: number,
  maxDimension: number,
): { width: number; height: number } {
  if (!(width > 0) || !(height > 0)) return { width: 0, height: 0 };
  if (width <= maxDimension && height <= maxDimension) {
    return { width: Math.round(width), height: Math.round(height) };
  }
  const ratio = Math.min(maxDimension / width, maxDimension / height);
  return { width: Math.round(width * ratio), height: Math.round(height * ratio) };
}

/**
 * 이미 디코드된 이미지를 축소해 JPEG blob으로 만든다.
 *
 * 소스 크기를 인자로 받는 이유: `HTMLImageElement.width`는 **레이아웃 폭**이라
 * DOM에 40px로 박혀 있는 <img>에서 40을 준다. 그걸로 그리면 40px짜리 썸네일이 만들어진다.
 * 호출부가 `naturalWidth`/`naturalHeight`를 명시하게 강제한다.
 */
export function drawScaledJpeg(
  image: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  maxDimension: number,
  quality: number,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const { width, height } = fitWithin(sourceWidth, sourceHeight, maxDimension);
    if (width === 0 || height === 0) {
      reject(new Error(`빈 이미지는 인코딩할 수 없다 (${sourceWidth}x${sourceHeight})`));
      return;
    }
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      reject(new Error('Canvas 2D context not available'));
      return;
    }
    ctx.drawImage(image, 0, 0, width, height);
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error('canvas.toBlob returned null'));
          return;
        }
        resolve(blob);
      },
      'image/jpeg',
      quality,
    );
  });
}

/**
 * 이 썸네일 path에 쓸 수 있는가.
 *
 * `analyze-uploads`의 RLS는 **첫 세그먼트 == auth.uid()**를 요구한다. 남의 이미지를 보고 있다면
 * 업로드는 반드시 403으로 끝나므로, 요청을 보내기 전에 여기서 끊는다.
 * (현재 이미지를 그리는 화면은 `/recent`·`/stats` 둘 다 본인 세션만 보여주므로 실제로는 항상 본인이다.
 *  그래도 가정을 주석이 아니라 코드로 들고 있는 편이 낫다.)
 */
export function canWriteThumb(
  thumbPath: string | null | undefined,
  userId: string | null | undefined,
): boolean {
  if (!thumbPath || !userId) return false;
  const segments = thumbPath.split('/');
  // `{userId}/thumb/{파일}` — 세 조각 미만이면 썸네일 path가 아니다.
  if (segments.length < 3 || segments[1] !== THUMB_SEGMENT) return false;
  return segments[0] === userId;
}

/**
 * path별 1회 시도. 실패해도 다시 시도하지 않는다.
 *
 * 재시도를 허용하면 실패하는 이미지 하나가 목록을 다시 그릴 때마다 원본 디코드 + 업로드 요청을
 * 되풀이한다 — 고치려던 낭비를 다른 형태로 되살리는 셈이다. 한 세션에 한 번이면 충분하다.
 */
const attempted = new Set<string>();

export function claimThumbBackfill(thumbPath: string): boolean {
  if (attempted.has(thumbPath)) return false;
  attempted.add(thumbPath);
  return true;
}

/**
 * crossOrigin을 걸었더니 이미지가 아예 안 뜬 적이 있는가.
 *
 * 왜 컴포넌트가 아니라 여기(전역)인가: crossOrigin 요청이 CORS로 막히면 브라우저는
 * **이미 내려받은 뒤** 접근만 차단한다. 그리고 호출부는 crossOrigin 없이 다시 그린다 —
 * 즉 한 장에 송신이 2배로 든다. 컴포넌트별로 기억하면 이미지마다, 렌더마다 2배를 문다.
 * 송신을 줄이려고 만든 기능이 정확히 반대로 작동하는 경우라, 한 번 겪으면 세션 전체에서 끈다.
 *
 * 원본이 그냥 404여도 여기로 온다. 그때도 끄는 게 맞다 — 백필을 포기하는 대가는 "예전과 같음"뿐이고,
 * 잘못 켜둔 대가는 송신 2배다.
 */
let backfillDisabled = false;

export function disableThumbBackfill(): void {
  backfillDisabled = true;
}

export function isThumbBackfillDisabled(): boolean {
  return backfillDisabled;
}

/** 테스트 전용 — 모듈 상태를 비운다. */
export function resetThumbBackfills(): void {
  attempted.clear();
  backfillDisabled = false;
}

/**
 * 폴백으로 그려진 **원본 <img>**에서 썸네일을 만들어 올린다.
 *
 * 반환값은 "실제로 올렸는가". 실패·건너뜀은 전부 false이고 절대 던지지 않는다 —
 * 백필은 부수적인 일이라, 여기서 던지면 이미지가 잘 보이는 화면에서 예외만 튄다.
 */
export async function backfillThumb(image: HTMLImageElement, fullUrl: string): Promise<boolean> {
  if (backfillDisabled) return false;

  const thumbPath = toThumbPath(fullUrl);
  if (!thumbPath) return false;

  // 소유자 확인이 먼저다. getSession은 로컬 저장소를 읽으므로 네트워크를 타지 않는다.
  const { data } = await supabase.auth.getSession();
  const userId = data.session?.user?.id;
  if (!canWriteThumb(thumbPath, userId)) return false;

  if (!claimThumbBackfill(thumbPath)) return false;

  try {
    const blob = await drawScaledJpeg(
      image,
      image.naturalWidth,
      image.naturalHeight,
      THUMB_MAX_DIMENSION,
      THUMB_QUALITY,
    );
    const { error } = await supabase.storage
      .from(ANALYZE_BUCKET)
      .upload(thumbPath, blob, { contentType: 'image/jpeg', upsert: false });

    // 이미 있으면(다른 탭이 먼저 만들었거나 경합) 성공으로 친다 — 목적은 파일의 존재다.
    if (error && !/exists/i.test(error.message)) {
      console.warn('[thumb] 백필 업로드 실패', { thumbPath, error: error.message });
      return false;
    }

    // `resolveThumbUrl`이 "없음"으로 기억해 둔 걸 지운다. 안 지우면 방금 만든 썸네일을
    // 이 세션 내내 안 쓰고 계속 원본으로 폴백한다.
    clearMissingThumb(thumbPath);
    return true;
  } catch (e) {
    // 캔버스 오염(SecurityError)이 여기로 온다. 호출부가 crossOrigin 없이 다시 그린다.
    console.warn('[thumb] 백필 생성 실패', { thumbPath, error: e });
    return false;
  }
}
