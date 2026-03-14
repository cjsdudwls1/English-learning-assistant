// 이미지 크롭 유틸리티: magick-wasm (WASM) 기반
// Supabase Edge Functions에서 이미지를 좌표 기반으로 크롭

import {
  ImageMagick,
  initializeImageMagick,
  MagickGeometry,
} from "npm:@imagemagick/magick-wasm@0.0.30";

// WASM 초기화 (한 번만)
let wasmInitialized = false;

async function ensureWasmInitialized() {
  if (wasmInitialized) return;
  const wasmBytes = await Deno.readFile(
    new URL(
      "magick.wasm",
      import.meta.resolve("npm:@imagemagick/magick-wasm@0.0.30"),
    ),
  );
  await initializeImageMagick(wasmBytes);
  wasmInitialized = true;
  console.log('[ImageCropper] magick-wasm initialized');
}

// 바운딩 박스 타입
export interface BoundingBox {
  problem_number: string;
  answer_area_bbox: {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
  };
}

// 크롭 결과 타입
export interface CroppedImage {
  problem_number: string;
  croppedBase64: string;
  mimeType: string;
}

/**
 * base64 이미지를 한 번 디코딩하여 여러 영역을 크롭한다.
 * base64 → Uint8Array 변환은 1회만 수행.
 * 각 크롭은 ImageMagick.read를 개별 호출 (crop이 원본을 변형하므로).
 */
export async function cropImageRegions(
  imageBase64: string,
  _mimeType: string,
  regions: BoundingBox[],
  paddingPercent: number = 5,
): Promise<CroppedImage[]> {
  await ensureWasmInitialized();

  // base64 → Uint8Array 1회만 수행
  const imageBytes = Uint8Array.from(atob(imageBase64), (c: string) => c.charCodeAt(0));
  const results: CroppedImage[] = [];

  for (const region of regions) {
    try {
      const cropped = ImageMagick.read(imageBytes, (img: any) => {
        const imgWidth = img.width;
        const imgHeight = img.height;

        // 정규화 좌표(0-1000) → 실제 픽셀 좌표
        let x1 = Math.round((region.answer_area_bbox.x1 / 1000) * imgWidth);
        let y1 = Math.round((region.answer_area_bbox.y1 / 1000) * imgHeight);
        let x2 = Math.round((region.answer_area_bbox.x2 / 1000) * imgWidth);
        let y2 = Math.round((region.answer_area_bbox.y2 / 1000) * imgHeight);

        // padding 추가
        const padX = Math.round((x2 - x1) * paddingPercent / 100);
        const padY = Math.round((y2 - y1) * paddingPercent / 100);
        x1 = Math.max(0, x1 - padX);
        y1 = Math.max(0, y1 - padY);
        x2 = Math.min(imgWidth, x2 + padX);
        y2 = Math.min(imgHeight, y2 + padY);

        const cropWidth = x2 - x1;
        const cropHeight = y2 - y1;

        if (cropWidth <= 0 || cropHeight <= 0) {
          console.warn(`[ImageCropper] Q${region.problem_number}: Invalid crop dimensions (${cropWidth}x${cropHeight}), skipping`);
          return new Uint8Array(0);
        }

        // 크롭 실행
        const geometry = new MagickGeometry(x1, y1, cropWidth, cropHeight);
        img.crop(geometry);

        // 크롭한 이미지를 2배 확대 (작은 필기 감지 향상)
        const zoomedGeometry = new MagickGeometry(cropWidth * 2, cropHeight * 2);
        zoomedGeometry.ignoreAspectRatio = false;
        img.resize(zoomedGeometry);

        console.log(`[ImageCropper] Q${region.problem_number}: cropped (${x1},${y1})-(${x2},${y2}) → ${img.width}x${img.height}px`);

        return img.write((data: Uint8Array) => data);
      });

      if (cropped.length > 0) {
        // Uint8Array → base64 (청크 방식으로 성능 최적화)
        const CHUNK_SIZE = 8192;
        let binary = '';
        for (let i = 0; i < cropped.length; i += CHUNK_SIZE) {
          const chunk = cropped.subarray(i, Math.min(i + CHUNK_SIZE, cropped.length));
          binary += String.fromCharCode(...chunk);
        }
        const croppedBase64 = btoa(binary);

        results.push({
          problem_number: region.problem_number,
          croppedBase64,
          mimeType: 'image/png',
        });
      }
    } catch (e) {
      console.error(`[ImageCropper] Q${region.problem_number}: crop failed:`, (e as Error).message);
    }
  }

  return results;
}

/**
 * 두 종류의 바운딩 박스(답안 영역 + 전체 문제)를 한 번에 크롭한다.
 * base64 디코딩을 1회만 수행하여 효율적.
 */
export async function cropDualRegions(
  imageBase64: string,
  mimeType: string,
  problems: Array<{
    problem_number: string;
    full_bbox?: { x1: number; y1: number; x2: number; y2: number };
    answer_area_bbox: { x1: number; y1: number; x2: number; y2: number };
  }>,
): Promise<{ answerAreaCrops: CroppedImage[]; fullCrops: CroppedImage[] }> {
  // 답안 영역 크롭
  const answerRegions = problems.map(p => ({
    problem_number: p.problem_number,
    answer_area_bbox: p.answer_area_bbox,
  }));
  const answerAreaCrops = await cropImageRegions(imageBase64, mimeType, answerRegions, 5);

  // 전체 문제 크롭 (full_bbox가 있는 것만)
  const fullRegions = problems
    .filter(p => p.full_bbox)
    .map(p => ({
      problem_number: p.problem_number,
      answer_area_bbox: p.full_bbox!, // full_bbox를 answer_area_bbox 필드로 매핑
    }));
  const fullCrops = fullRegions.length > 0
    ? await cropImageRegions(imageBase64, mimeType, fullRegions, 2)
    : [];

  return { answerAreaCrops, fullCrops };
}
