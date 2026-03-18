/**
 * canvasCropper.ts — 브라우저 Canvas API 기반 이미지 크롭 유틸리티
 *
 * 서버(magick-wasm)에서 수행하던 이미지 크롭을 클라이언트로 이전하여
 * Supabase Edge Function의 CPU Time 제한(2초)을 회피한다.
 */

// ─── 타입 정의 ─────────────────────────────────────────────

export interface BoundingBox {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface ProblemBbox {
  problem_number: string;
  full_bbox?: BoundingBox;
  answer_area_bbox: BoundingBox;
}

export interface CroppedImageData {
  problem_number: string;
  croppedBase64: string;
  mimeType: string;
}

// ─── 내부 헬퍼 ─────────────────────────────────────────────

/**
 * HTMLImageElement를 로드한다. (이미 로드된 경우 즉시 반환)
 */
function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load image: ${src.substring(0, 100)}`));
    img.src = src;
  });
}

/**
 * 정규화 좌표(0-1000) → 실제 픽셀 좌표 변환 + padding 적용
 */
function normalizedToPixel(
  bbox: BoundingBox,
  imgWidth: number,
  imgHeight: number,
  paddingPercent: number = 5,
): { x: number; y: number; w: number; h: number } {
  let x1 = Math.round((bbox.x1 / 1000) * imgWidth);
  let y1 = Math.round((bbox.y1 / 1000) * imgHeight);
  let x2 = Math.round((bbox.x2 / 1000) * imgWidth);
  let y2 = Math.round((bbox.y2 / 1000) * imgHeight);

  // padding 추가
  const padX = Math.round((x2 - x1) * paddingPercent / 100);
  const padY = Math.round((y2 - y1) * paddingPercent / 100);
  x1 = Math.max(0, x1 - padX);
  y1 = Math.max(0, y1 - padY);
  x2 = Math.min(imgWidth, x2 + padX);
  y2 = Math.min(imgHeight, y2 + padY);

  return {
    x: x1,
    y: y1,
    w: Math.max(1, x2 - x1),
    h: Math.max(1, y2 - y1),
  };
}

/**
 * Canvas로 특정 영역을 크롭하여 base64 문자열로 반환한다.
 * scale 배수만큼 확대하여 작은 필기 감지를 향상시킨다.
 */
function cropRegionToBase64(
  img: HTMLImageElement,
  bbox: BoundingBox,
  paddingPercent: number,
  scale: number = 2,
): string {
  const { x, y, w, h } = normalizedToPixel(bbox, img.naturalWidth, img.naturalHeight, paddingPercent);

  const canvas = document.createElement('canvas');
  canvas.width = w * scale;
  canvas.height = h * scale;

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context not available');

  // 크롭 영역을 scale 배수로 확대 그리기
  ctx.drawImage(img, x, y, w, h, 0, 0, w * scale, h * scale);

  // data URL에서 base64 부분만 추출
  const dataUrl = canvas.toDataURL('image/png');
  return dataUrl.split(',')[1];
}

// ─── 공개 API ──────────────────────────────────────────────

/**
 * 단일 이미지(base64 또는 URL)에 대해 Pass 0 결과(문제별 좌표)를 받아
 * 두 종류(answerArea + full)의 크롭된 이미지를 생성한다.
 *
 * @param imageSource - base64 데이터 URI 또는 이미지 URL
 * @param problems - Pass 0에서 반환된 문제별 바운딩 박스 배열
 * @returns answerAreaCrops, fullCrops 배열
 */
export async function cropAllRegions(
  imageSource: string,
  problems: ProblemBbox[],
): Promise<{
  answerAreaCrops: CroppedImageData[];
  fullCrops: CroppedImageData[];
}> {
  // base64 문자열이면 data URI로 변환
  const src = imageSource.startsWith('data:')
    ? imageSource
    : imageSource.startsWith('http')
      ? imageSource
      : `data:image/jpeg;base64,${imageSource}`;

  const img = await loadImage(src);

  console.log(`[CanvasCropper] Image loaded: ${img.naturalWidth}x${img.naturalHeight}, problems: ${problems.length}`);

  const answerAreaCrops: CroppedImageData[] = [];
  const fullCrops: CroppedImageData[] = [];

  for (const problem of problems) {
    try {
      // 답안 영역 크롭 (padding 5%, 2배 확대)
      const answerBase64 = cropRegionToBase64(img, problem.answer_area_bbox, 5, 2);
      answerAreaCrops.push({
        problem_number: problem.problem_number,
        croppedBase64: answerBase64,
        mimeType: 'image/png',
      });

      // 전체 문제 크롭 (padding 2%, 2배 확대) — full_bbox가 있는 경우만
      if (problem.full_bbox) {
        const fullBase64 = cropRegionToBase64(img, problem.full_bbox, 2, 2);
        fullCrops.push({
          problem_number: problem.problem_number,
          croppedBase64: fullBase64,
          mimeType: 'image/png',
        });
      }

      console.log(`[CanvasCropper] Q${problem.problem_number}: cropped (answer + ${problem.full_bbox ? 'full' : 'no full'})`);
    } catch (e) {
      console.error(`[CanvasCropper] Q${problem.problem_number}: crop failed:`, (e as Error).message);
    }
  }

  console.log(`[CanvasCropper] Completed: answer=${answerAreaCrops.length}, full=${fullCrops.length}`);
  return { answerAreaCrops, fullCrops };
}
