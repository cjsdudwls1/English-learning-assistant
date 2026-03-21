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
  const { width, height } = metadata;

  const needsResize = width > MAX_DIMENSION || height > MAX_DIMENSION;

  if (!needsResize) {
    console.log(`[imagePreprocessor] 리사이즈 불필요 (${width}x${height}), 원본 유지`);
    return { imageBase64, mimeType };
  }

  const ratio = Math.min(MAX_DIMENSION / width, MAX_DIMENSION / height);
  const newWidth = Math.round(width * ratio);
  const newHeight = Math.round(height * ratio);

  const resizedBuffer = await sharp(originalBuffer)
    .resize(newWidth, newHeight, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: JPEG_QUALITY })
    .toBuffer();

  const resizedBase64 = resizedBuffer.toString('base64');

  console.log(
    `[imagePreprocessor] 리사이즈: ${width}x${height} → ${newWidth}x${newHeight}, ` +
    `${Math.round(originalBuffer.length / 1024)}KB → ${Math.round(resizedBuffer.length / 1024)}KB`
  );

  return { imageBase64: resizedBase64, mimeType: 'image/jpeg' };
}
