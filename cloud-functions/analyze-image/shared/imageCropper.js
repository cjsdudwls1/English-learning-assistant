/**
 * 이미지 크롭 모듈
 * - sharp 라이브러리로 서버 사이드 이미지 크롭
 * - 정규화된 bbox 좌표(0~1000)를 픽셀 좌표로 변환
 */

import sharp from 'sharp';

const MIN_CROP_DIMENSION = 10;
const CROP_JPEG_QUALITY = 85;
const CROP_ZOOM_FACTOR = 2; // 크롭 후 2배 확대 (작은 필기 감지 향상, 원래 Edge Function 사양 복원)

// 크롭 안전 패딩 (이미지 크기 대비 비율).
// Pass 0가 선택지 번호 열(①②③④⑤)을 bbox 좌단에서 상습적으로 잘라 마크가 있는
// 번호를 놓치는 사례가 실측됨(예: Q45 — bbox x1이 번호 열보다 오른쪽에 위치해
// answerArea/full 모두 마크 식별 불가→null/오답). 좌측을 넉넉히 확장해 번호 열과
// 번호 위/왼쪽으로 삐져나온 필기를 포함시킨다. 하단은 다음 문제 침범을 막기 위해 최소화.
const PAD_LEFT = 0.05;
const PAD_TOP = 0.02;
const PAD_RIGHT = 0.02;
const PAD_BOTTOM = 0.03;

/**
 * bbox 좌표 복구(§3 하드닝): 0~1000 클램프 + x1>x2/y1>y2 swap + 과소영역 무효화.
 * - 유효한 bbox(좌표 정상)는 그대로 통과 → 정상 케이스 행위 불변(회귀 불가).
 * - Pass 0가 간헐적으로 내는 좌표 뒤집힘/범위이탈만 복구해 크롭 손실을 줄인다.
 * @returns {{x1,y1,x2,y2}|null} 복구 불가(NaN/과소)면 null
 */
function sanitizeBbox(bbox) {
  if (!bbox) return null;
  const cl = v => Math.min(1000, Math.max(0, Number(v)));
  let x1 = cl(bbox.x1), y1 = cl(bbox.y1), x2 = cl(bbox.x2), y2 = cl(bbox.y2);
  if (![x1, y1, x2, y2].every(Number.isFinite)) return null;
  if (x1 > x2) { const t = x1; x1 = x2; x2 = t; }
  if (y1 > y2) { const t = y1; y1 = y2; y2 = t; }
  if (x2 - x1 < 5 || y2 - y1 < 5) return null; // 정규화 5단위 미만 = 사실상 빈 영역
  return { x1, y1, x2, y2 };
}

/**
 * 정규화된 bbox를 픽셀 좌표로 변환 (+ 안전 패딩, 이미지 경계로 클램프)
 * bbox 좌표는 0~1000 범위 (정규화 좌표, 프롬프트 기준)
 */
function normalizeToPixel(bbox, imgWidth, imgHeight) {
  // 프롬프트가 0~1000 정규화 좌표를 요청하므로 1000으로 나누어 비율로 변환
  const rawLeft = (bbox.x1 / 1000) * imgWidth;
  const rawTop = (bbox.y1 / 1000) * imgHeight;
  const rawRight = (bbox.x2 / 1000) * imgWidth;
  const rawBottom = (bbox.y2 / 1000) * imgHeight;
  const left = Math.max(0, Math.round(rawLeft - PAD_LEFT * imgWidth));
  const top = Math.max(0, Math.round(rawTop - PAD_TOP * imgHeight));
  const right = Math.min(imgWidth, Math.round(rawRight + PAD_RIGHT * imgWidth));
  const bottom = Math.min(imgHeight, Math.round(rawBottom + PAD_BOTTOM * imgHeight));
  return { left, top, width: right - left, height: bottom - top };
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

    const answerBbox = sanitizeBbox(bbox.answer_area_bbox);
    if (answerBbox) {
      try {
        const croppedBase64 = await cropSingleRegion(imageBuffer, answerBbox, imgWidth, imgHeight);
        if (croppedBase64) {
          answerAreaCrops.push({ problem_number: problemNumber, croppedBase64, mimeType: 'image/jpeg' });
        }
      } catch (cropError) {
        console.warn(`[imageCropper] 답안 영역 크롭 실패 Q${problemNumber}:`, cropError.message);
      }
    }

    const fullBbox = sanitizeBbox(bbox.full_bbox);
    if (fullBbox) {
      try {
        const croppedBase64 = await cropSingleRegion(imageBuffer, fullBbox, imgWidth, imgHeight);
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
