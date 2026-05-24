/**
 * Supabase Storage Direct Upload용 이미지 다운로더
 *
 * 프론트엔드가 `analyze-uploads` bucket에 직접 업로드한 path를 받아,
 * GCF에서 base64로 다운로드한다 (이전 base64 over HTTP 방식 대체).
 *
 * - 30+ 동시 요청 시에도 GCF 메모리/CPU 부하 분산 (이미지 페이로드 미경유)
 * - Storage Service-Role 권한으로 다운로드 (RLS 우회)
 */

import { StageError } from './errors.js';

const ANALYZE_BUCKET = 'analyze-uploads';
const DOWNLOAD_TIMEOUT_MS = 30_000;
const DOWNLOAD_CONCURRENCY = 10;

function inferMimeType(path) {
  const ext = String(path).toLowerCase().split('.').pop();
  if (ext === 'png') return 'image/png';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'heic') return 'image/heic';
  if (ext === 'heif') return 'image/heif';
  return 'image/jpeg';
}

async function downloadOne(supabase, path, sessionId) {
  const t0 = Date.now();
  const { data, error } = await supabase.storage
    .from(ANALYZE_BUCKET)
    .download(path);

  if (error) {
    throw new StageError('image_download', `Storage download failed (${path}): ${error.message}`, error);
  }
  if (!data) {
    throw new StageError('image_download', `Storage download returned no data (${path})`);
  }

  const arrayBuffer = await data.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const base64 = buffer.toString('base64');
  const mimeType = data.type || inferMimeType(path);
  const fileName = path.split('/').pop() || 'image.jpg';

  console.log(`[imageDownloader] ${path}: ${Math.round(buffer.length / 1024)}KB (${Date.now() - t0}ms)`);

  return { imageBase64: base64, mimeType, fileName, path };
}

/**
 * imagePaths 배열을 받아 GCF 분석 파이프라인용 images[] 구조로 변환.
 * - 동시 다운로드는 DOWNLOAD_CONCURRENCY로 제한 (Storage rate-limit 방어)
 * - 부분 실패 시 StageError throw (전체 세션 실패 처리)
 */
export async function downloadImagesFromStorage(supabase, imagePaths, sessionId) {
  if (!Array.isArray(imagePaths) || imagePaths.length === 0) {
    throw new StageError('image_download', 'imagePaths가 비어있습니다');
  }

  console.log(`[imageDownloader] 다운로드 시작: ${imagePaths.length}개`, { sessionId });
  const t0 = Date.now();

  const results = new Array(imagePaths.length);
  let cursor = 0;

  async function worker() {
    while (cursor < imagePaths.length) {
      const idx = cursor++;
      const path = imagePaths[idx];
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new StageError('image_download', `Download timeout (${path})`)), DOWNLOAD_TIMEOUT_MS);
      });
      results[idx] = await Promise.race([downloadOne(supabase, path, sessionId), timeoutPromise]);
    }
  }

  const workers = Array.from({ length: Math.min(DOWNLOAD_CONCURRENCY, imagePaths.length) }, () => worker());
  await Promise.all(workers);

  const totalBytes = results.reduce((sum, r) => sum + (r.imageBase64.length * 3 / 4), 0);
  console.log(`[imageDownloader] 완료: ${results.length}개, ${Math.round(totalBytes / 1024 / 1024 * 10) / 10}MB (${Date.now() - t0}ms)`, { sessionId });

  return results;
}

/**
 * imagePaths를 signed URL 배열로 변환 (image_urls 컬럼 저장용).
 * C7 fix: bucket private 전환 → 24h signed URL 발급.
 * - 일부 실패 시 해당 path는 원본 path 문자열로 fallback (UI 깨짐 방지)
 * - 만료 시 frontend에서 재발급하거나, 24h 이내 표시되는 시나리오를 가정
 */
const SIGNED_URL_TTL_SEC = 24 * 60 * 60;

export async function pathsToSignedUrls(supabase, imagePaths) {
  if (!Array.isArray(imagePaths) || imagePaths.length === 0) return [];
  const results = await Promise.all(imagePaths.map(async (path) => {
    try {
      const { data, error } = await supabase.storage
        .from(ANALYZE_BUCKET)
        .createSignedUrl(path, SIGNED_URL_TTL_SEC);
      if (error || !data?.signedUrl) {
        console.warn(`[imageDownloader] signed URL 생성 실패 (${path}):`, error?.message);
        return path;
      }
      return data.signedUrl;
    } catch (e) {
      console.warn(`[imageDownloader] signed URL 예외 (${path}):`, e?.message);
      return path;
    }
  }));
  return results;
}
