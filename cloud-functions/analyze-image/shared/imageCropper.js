/**
 * 이미지 크롭 모듈
 * - sharp 라이브러리로 서버 사이드 이미지 크롭
 * - 정규화된 bbox 좌표(0~1000)를 픽셀 좌표로 변환
 */

import sharp from 'sharp';

const MIN_CROP_DIMENSION = 10;
const CROP_JPEG_QUALITY = 85;
const CROP_ZOOM_FACTOR = 2; // 크롭 후 2배 확대 (작은 필기 감지 향상, 원래 Edge Function 사양 복원)

/**
 * 정규화된 bbox를 픽셀 좌표로 변환
 * bbox 좌표는 0~1000 범위 (정규화 좌표, 프롬프트 기준)
 */
function normalizeToPixel(bbox, imgWidth, imgHeight) {
  // 프롬프트가 0~1000 정규화 좌표를 요청하므로 1000으로 나누어 비율로 변환
  const left = Math.max(0, Math.round((bbox.x1 / 1000) * imgWidth));
  const top = Math.max(0, Math.round((bbox.y1 / 1000) * imgHeight));
  const width = Math.min(imgWidth - left, Math.round(((bbox.x2 - bbox.x1) / 1000) * imgWidth));
  const height = Math.min(imgHeight - top, Math.round(((bbox.y2 - bbox.y1) / 1000) * imgHeight));
  return { left, top, width, height };
}

async function cropSingleRegion(imageBuffer, bbox, imgWidth, imgHeight) {
  const { left, top, width, height } = normalizeToPixel(bbox, imgWidth, imgHeight);

  if (width <= MIN_CROP_DIMENSION || height <= MIN_CROP_DIMENSION) return null;

  const croppedBuffer = await sharp(imageBuffer)
    .extract({ left, top, width, height })
    .resize(width * CROP_ZOOM_FACTOR, height * CROP_ZOOM_FACTOR) // 크롭 후 2배 확대 (작은 필기 감지 향상)
    .jpeg({ quality: CROP_JPEG_QUALITY })
    .toBuffer();

  return croppedBuffer.toString('base64');
}

/**
 * 이미지에서 모든 문제 영역을 크롭
 * @param {string} imageBase64 - Base64 인코딩된 원본 이미지
 * @param {string} mimeType - 이미지 MIME 타입
 * @param {Array} bboxes - 바운딩 박스 배열
 * @returns {{ answerAreaCrops: Array, fullCrops: Array }}
 */
export async function cropRegions(imageBase64, mimeType, bboxes) {
  const imageBuffer = Buffer.from(imageBase64, 'base64');
  const metadata = await sharp(imageBuffer).metadata();
  const imgWidth = metadata.width;
  const imgHeight = metadata.height;

  const answerAreaCrops = [];
  const fullCrops = [];

  for (const bbox of bboxes) {
    const problemNumber = String(bbox.problem_number);

    if (bbox.answer_area_bbox) {
      try {
        const croppedBase64 = await cropSingleRegion(imageBuffer, bbox.answer_area_bbox, imgWidth, imgHeight);
        if (croppedBase64) {
          answerAreaCrops.push({ problem_number: problemNumber, croppedBase64, mimeType: 'image/jpeg' });
        }
      } catch (cropError) {
        console.warn(`[imageCropper] 답안 영역 크롭 실패 Q${problemNumber}:`, cropError.message);
      }
    }

    if (bbox.full_bbox) {
      try {
        const croppedBase64 = await cropSingleRegion(imageBuffer, bbox.full_bbox, imgWidth, imgHeight);
        if (croppedBase64) {
          fullCrops.push({ problem_number: problemNumber, croppedBase64, mimeType: 'image/jpeg' });
        }
      } catch (cropError) {
        console.warn(`[imageCropper] 전체 영역 크롭 실패 Q${problemNumber}:`, cropError.message);
      }
    }
  }

  return { answerAreaCrops, fullCrops };
}
