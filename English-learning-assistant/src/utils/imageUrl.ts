/**
 * Storage path → signed URL 변환 헬퍼
 * - image_urls 컬럼에는 storage path만 저장 (publisher 측 변경)
 * - 만료된 signed URL이 영구 저장되는 회귀 방지 — frontend 표시 시점에 매번 발급
 * - legacy 데이터(이미 http(s):// 형태) 호환: 그대로 반환
 *
 * 캐시 정책:
 * - TTL 1h (DEFAULT_TTL_SEC)
 * - 80% 시점에 invalidate (실제 만료 전 재발급)
 * - lazy expired delete + size 상한 LRU (메모리 leak 방지)
 * - 회전 등 강제 갱신은 `invalidateImageUrl(path)` 호출
 */
import { supabase } from '../services/supabaseClient';

const ANALYZE_BUCKET = 'analyze-uploads';
const DEFAULT_TTL_SEC = 60 * 60; // 1h
const MAX_CACHE_ENTRIES = 500;

interface CacheEntry {
  url: string;
  expiresAt: number;
  lastUsed: number;
}

const cache = new Map<string, CacheEntry>();

function isAbsoluteUrl(s: string): boolean {
  return /^https?:\/\//i.test(s);
}

function evictExpiredAndLRU(now: number): void {
  // 만료된 엔트리 제거
  for (const [key, entry] of cache) {
    if (entry.expiresAt <= now) cache.delete(key);
  }
  // 상한 초과 시 LRU eviction
  if (cache.size > MAX_CACHE_ENTRIES) {
    const sorted = Array.from(cache.entries()).sort((a, b) => a[1].lastUsed - b[1].lastUsed);
    const toRemove = sorted.slice(0, cache.size - MAX_CACHE_ENTRIES);
    for (const [key] of toRemove) cache.delete(key);
  }
}

/**
 * storage path 1개 → signed URL (1h TTL).
 * - 이미 absolute URL이면 그대로 반환 (legacy publicUrl 호환).
 * - 빈 문자열/null/undefined는 빈 문자열 반환.
 * - 발급 실패 시 빈 문자열 반환 (raw path를 <img src>에 넣으면 404 누수)
 */
export async function resolveImageUrl(pathOrUrl: string | null | undefined): Promise<string> {
  if (!pathOrUrl) return '';
  if (isAbsoluteUrl(pathOrUrl)) return pathOrUrl;

  const now = Date.now();
  const cached = cache.get(pathOrUrl);
  if (cached && cached.expiresAt > now) {
    cached.lastUsed = now;
    return cached.url;
  }

  const { data, error } = await supabase.storage
    .from(ANALYZE_BUCKET)
    .createSignedUrl(pathOrUrl, DEFAULT_TTL_SEC);

  if (error || !data?.signedUrl) {
    console.warn('[resolveImageUrl] signed URL 발급 실패', { path: pathOrUrl, error: error?.message });
    return '';
  }
  cache.set(pathOrUrl, {
    url: data.signedUrl,
    expiresAt: now + DEFAULT_TTL_SEC * 800, // TTL의 80%
    lastUsed: now,
  });
  evictExpiredAndLRU(now);
  return data.signedUrl;
}

/**
 * storage path 배열 → signed URL 배열 (병렬).
 * 항목 단위 실패 시 빈 문자열 (UI placeholder 처리).
 */
export async function resolveImageUrls(pathsOrUrls: (string | null | undefined)[] | null | undefined): Promise<string[]> {
  if (!pathsOrUrls || pathsOrUrls.length === 0) return [];
  return Promise.all(pathsOrUrls.map((p) => resolveImageUrl(p)));
}

/**
 * 회전 등 강제 갱신 — 다음 resolveImageUrl 호출 시 새 signed URL 발급.
 */
export function invalidateImageUrl(pathOrUrl: string | null | undefined): void {
  if (!pathOrUrl) return;
  cache.delete(pathOrUrl);
}

/**
 * 회전 시 path 추출용 — storage path 또는 legacy absolute URL을 받아
 * { bucket, path } 반환. 신규 path는 default bucket 가정.
 */
export function parseStoragePath(pathOrUrl: string): { bucket: string; path: string } | null {
  if (!pathOrUrl) return null;
  if (isAbsoluteUrl(pathOrUrl)) {
    // legacy: /object/public/<bucket>/<path>  또는  /object/sign/<bucket>/<path>?...
    const m = pathOrUrl.match(/\/object\/(?:public|sign)\/([^/]+)\/([^?]+)/);
    if (m) return { bucket: m[1], path: decodeURIComponent(m[2]) };
    return null;
  }
  // path만: default bucket
  return { bucket: ANALYZE_BUCKET, path: pathOrUrl };
}
