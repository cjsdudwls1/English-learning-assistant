// requestParser.ts — 요청 파싱 및 검증 모듈
// HTTP 요청 body에서 이미지 리스트, userId 등을 추출하고 검증

// ─── 타입 정의 ─────────────────────────────────────────────

export interface ImageItem {
  imageBase64: string;
  mimeType: string;
  fileName: string;
}

export interface ParsedRequest {
  imageList: ImageItem[];
  userId: string;
  language?: string;
  preferredModel?: string;
}

// ─── base64 접두사 제거 ────────────────────────────────────

function stripBase64Prefix(data: string): string {
  if (data.includes(',')) {
    return data.split(',')[1];
  }
  return data;
}

// ─── 메인 함수: 요청 파싱 ──────────────────────────────────

/**
 * analyze-image 요청 body를 파싱하여 이미지 리스트와 메타데이터를 추출한다.
 *
 * 지원 형식:
 * - 다중 이미지: { images: [{ imageBase64, mimeType, fileName }], userId, ... }
 * - 단일 이미지: { imageBase64, mimeType, fileName, userId, ... } (하위 호환성)
 *
 * @throws Error 필수 필드(images, userId) 누락 시
 */
export function parseAnalyzeRequest(requestData: any): ParsedRequest {
  const { imageBase64, mimeType, userId, fileName, language, images, preferredModel } = requestData || {};

  let imageList: ImageItem[] = [];

  if (images && Array.isArray(images) && images.length > 0) {
    // 다중 이미지 모드
    imageList = images.map((img: any, index: number) => ({
      imageBase64: stripBase64Prefix(img.imageBase64 || ''),
      mimeType: img.mimeType || 'image/jpeg',
      fileName: img.fileName || `image_${index}.jpg`,
    }));
    console.log('Request data: Multiple images mode', {
      imageCount: imageList.length,
      userId,
      language,
    });
  } else if (imageBase64) {
    // 단일 이미지 모드 (하위 호환성)
    imageList = [{
      imageBase64: stripBase64Prefix(imageBase64),
      mimeType: mimeType || 'image/jpeg',
      fileName: fileName || 'image.jpg',
    }];
    console.log('Request data: Single image mode (backward compatible)', {
      userId,
      language,
    });
  }

  // 원본 요청 데이터의 이미지를 즉시 해제 (메모리 절약 - 이미 imageList에 복사됨)
  if (requestData) {
    if (requestData.images) requestData.images = null;
    if (requestData.imageBase64) requestData.imageBase64 = null;
  }

  if (!userId) {
    console.error('Missing required field: userId');
    throw new Error('Missing required field: userId');
  }

  // mode: analyze에서는 원본 이미지 없이 크롭된 이미지만 전달되므로 imageList가 비어도 OK
  const mode = requestData?.mode as string | undefined;
  if (imageList.length === 0 && mode !== 'analyze') {
    console.error('Missing required fields:', {
      imageCount: imageList.length,
      hasUserId: !!userId,
    });
    throw new Error('Missing required fields: images (or imageBase64)');
  }

  const MAX_IMAGES = 3;
  if (imageList.length > MAX_IMAGES) {
    console.warn(`Too many images: ${imageList.length}, max: ${MAX_IMAGES}. Truncating.`);
    imageList = imageList.slice(0, MAX_IMAGES);
  }

  return { imageList, userId, language, preferredModel };
}
