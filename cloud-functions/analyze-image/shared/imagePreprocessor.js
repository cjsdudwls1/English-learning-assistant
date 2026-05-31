/**
 * 이미지 전처리 모듈
 * - 서버 측에서 수신한 이미지를 리사이즈하여 Gemini API 전송 크기 절감
 * - 프론트엔드 compressImage()와 동일한 사양: 긴 변 1200px, JPEG quality 80%
 * - 이미 충분히 작은 이미지는 변환 없이 통과 (정보 손실 방지)
 */

import sharp from 'sharp';

const MAX_DIMENSION = 1200;
const JPEG_QUALITY = 80;

/**
 * base64 이미지를 리사이즈하여 base64로 반환
 * 긴 변이 MAX_DIMENSION 이하이면 변환하지 않고 원본 반환
 *
 * @param {string} imageBase64 - Base64 인코딩된 이미지
 * @param {string} mimeType - 원본 MIME 타입
 * @returns {{ imageBase64: string, mimeType: string }} 리사이즈된 이미지
 */
export async function preprocessImage(imageBase64, mimeType) {
  const originalBuffer = Buffer.from(imageBase64, 'base64');
  const metadata = await sharp(originalBuffer).metadata();
  const { width, height, orientation } = metadata;

  // EXIF orientation이 정립(1)이 아니면 회전 필요. 카메라/일부 기기 사진은 픽셀을 '누운'
  // 채로 저장하고 orientation 태그로만 회전을 지시한다(실측: test_image 56장 중 6장 orient=6).
  // sharp는 .rotate() 무인자 호출 시에만 EXIF 기반 auto-rotate를 적용하며, 미적용 시 JPEG
  // 재인코딩에서 orientation 태그가 사라져 Gemini가 '누운' 이미지를 받는다(OCR·마크·bbox 동시 저하).
  const needsRotate = orientation != null && orientation !== 1;
  const needsResize = width > MAX_DIMENSION || height > MAX_DIMENSION;

  // 회전·리사이즈 모두 불필요 → 원본 유지(무손실, 기존 행위 보존: orient=1/none + 작은 이미지)
  if (!needsResize && !needsRotate) {
    console.log(`[imagePreprocessor] 변환 불필요 (${width}x${height}, orient=${orientation ?? 'none'}), 원본 유지`);
    return { imageBase64, mimeType };
  }

  let pipeline = sharp(originalBuffer).rotate(); // EXIF auto-rotate (orient=1/none이면 픽셀 무변화 no-op)
  if (needsResize) {
    // 긴 변을 MAX_DIMENSION으로. rotate로 W/H가 스왑돼도 fit:inside가 자동 처리하며,
    // orient=1에서는 기존 resize(newW,newH)와 동일 결과(긴변=MAX, 비율유지) → 회귀 없음.
    pipeline = pipeline.resize(MAX_DIMENSION, MAX_DIMENSION, { fit: 'inside', withoutEnlargement: true });
  }
  const outBuffer = await pipeline.jpeg({ quality: JPEG_QUALITY }).toBuffer();
  const outBase64 = outBuffer.toString('base64');

  console.log(
    `[imagePreprocessor] ${needsRotate ? '정립' : '재인코딩'}${needsResize ? '+리사이즈' : ''}: ` +
    `${width}x${height} orient=${orientation ?? 'none'} → ${Math.round(originalBuffer.length / 1024)}KB → ${Math.round(outBuffer.length / 1024)}KB`
  );

  return { imageBase64: outBase64, mimeType: 'image/jpeg' };
}
