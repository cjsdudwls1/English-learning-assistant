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

/** 썸네일이 들어가는 폴더 이름. `{userId}/thumb/{파일}` — 업로드(App.tsx)와 공유한다. */
export const THUMB_SEGMENT = 'thumb';

/** 썸네일이 없다고 확인된 path. `resolveThumbUrl` 주석 참고. */
const missingThumbs = new Set<string>();

/** storage path의 첫 세그먼트는 항상 auth.uid()다 (RLS 계약). */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface CacheEntry {
  url: string;
  expiresAt: number;
  lastUsed: number;
}

const cache = new Map<string, CacheEntry>();

/**
 * 동시 발급 상한.
 *
 * 왜 필요한가: 목록 화면들이 세션마다 `resolveImageUrls`를 병렬로 부른다.
 * 세션 500개 × 이미지 2장이면 **서명 URL 요청 1000개가 한꺼번에** 나간다.
 * 브라우저가 호스트당 6개로 큐를 잡아 주므로 앱은 "멈춘 것처럼" 보이고,
 * 모바일에서는 그 큐가 첫 화면 렌더까지 통째로 막는다.
 * 상한을 두면 요청 총량은 같아도 앞선 이미지가 먼저 도착해 화면이 순차적으로 채워진다.
 */
const MAX_INFLIGHT = 6;
let inflight = 0;
const waiters: Array<() => void> = [];

function acquireSlot(): Promise<void> {
  if (inflight < MAX_INFLIGHT) {
    inflight += 1;
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    waiters.push(() => {
      inflight += 1;
      resolve();
    });
  });
}

function releaseSlot(): void {
  inflight -= 1;
  const next = waiters.shift();
  if (next) next();
}

/**
 * 같은 path에 대해 이미 날아간 요청을 재사용한다.
 *
 * 한 이미지가 목록·썸네일·모달에서 동시에 렌더되는 일이 흔한데, 그때마다 캐시는 아직 비어 있어
 * **같은 path로 서명 URL을 서너 번 발급**받았다. 발급은 매번 새 URL이라 캐시가 마지막 것으로
 * 덮이고, 앞선 컴포넌트는 곧 버려질 URL을 잡는다.
 */
const pending = new Map<string, Promise<string>>();

/**
 * path별 무효화 세대. `invalidateImageUrl`이 1 올린다.
 * 발급 요청은 **시작 시점의 세대**를 들고 있다가, 응답이 왔을 때 세대가 그대로일 때만 캐시에 넣는다.
 *
 * 왜 Set이 아니라 카운터인가:
 * `invalidateImageUrl`이 `pending`을 지우므로 같은 path의 요청이 **둘 이상 동시에** 떠 있을 수 있다
 * (회전 전 A가 아직 안 왔는데 회전 후 B가 새로 뜨는 상황). Set은 "무효화됐다"는 사실 하나만 담아
 * 먼저 도착한 쪽이 표시를 소비해 버린다. B가 먼저 오면 B는 캐시에 안 들어가고, 뒤늦게 온 **회전 전**
 * A는 표시를 못 봐서 정상으로 통과해 캐시에 앉는다 — 회전한 이미지가 잠깐 보였다가 캐시 수명
 * 48분 동안 원래 것으로 돌아간다. 이 파일이 막으려던 증상 그대로다.
 * 세대 번호는 요청마다 자기 값을 들고 있어 도착 순서가 뒤바뀌어도 각자 옳게 판정한다.
 */
const generation = new Map<string, number>();

function currentGeneration(path: string): number {
  return generation.get(path) ?? 0;
}

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

  const existing = pending.get(pathOrUrl);
  if (existing) return existing;

  // 세대를 **요청 전에** 붙잡는다. 이 요청이 도는 동안 invalidate가 일어나면 세대가 달라진다.
  const issued = issueSignedUrl(pathOrUrl, currentGeneration(pathOrUrl)).finally(() => {
    // 자기 자신일 때만 지운다. invalidate 직후 새 요청이 들어와 있으면 그걸 지우면 안 된다.
    if (pending.get(pathOrUrl) === issued) pending.delete(pathOrUrl);
  });
  pending.set(pathOrUrl, issued);
  return issued;
}

async function issueSignedUrl(path: string, issuedAtGen: number): Promise<string> {
  await acquireSlot();
  try {
    const { data, error } = await supabase.storage
      .from(ANALYZE_BUCKET)
      .createSignedUrl(path, DEFAULT_TTL_SEC);

    if (error || !data?.signedUrl) {
      console.warn('[resolveImageUrl] signed URL 발급 실패', { path, error: error?.message });
      return '';
    }

    // 발급 중에 회전 등으로 invalidate됐다면 이 URL은 이미 낡았다. 반환은 하되 캐시엔 넣지 않는다.
    // 세대 비교라 같은 path의 다른 요청이 먼저 도착해도 이 판정은 흔들리지 않는다.
    if (currentGeneration(path) !== issuedAtGen) return data.signedUrl;

    const now = Date.now();
    cache.set(path, {
      url: data.signedUrl,
      expiresAt: now + DEFAULT_TTL_SEC * 800, // TTL의 80%
      lastUsed: now,
    });
    evictExpiredAndLRU(now);
    return data.signedUrl;
  } finally {
    releaseSlot();
  }
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
  // 발급 중인 요청이 있으면 세대를 올려 그 응답이 캐시를 되살리지 못하게 한다.
  // 이게 없으면 회전 직후 도착한 **회전 전** URL이 캐시에 앉아 원래 이미지가 다시 보인다.
  //
  // 발급 중이 아닐 때는 올리지 않는다. 캐시는 이미 지웠고 읽는 쪽이 없으므로 올릴 이유가 없다.
  // 덕분에 generation 맵에는 "발급 중에 회전당한 path"만 남아 사실상 몇 개를 넘지 않는다.
  if (pending.has(pathOrUrl)) {
    generation.set(pathOrUrl, currentGeneration(pathOrUrl) + 1);
    pending.delete(pathOrUrl);
  }
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

/**
 * 원본 storage path → 썸네일 path.
 *
 * `{userId}/{파일}` → `{userId}/thumb/{파일}`.
 * userId를 맨 앞에 그대로 두는 게 중요하다 — `analyze-uploads`의 RLS가
 * 폴더 prefix와 `auth.uid()` 일치를 요구하므로, 여기를 바꾸면 업로드도 조회도 막힌다.
 *
 * null을 주는 경우(= 썸네일 없음, 원본으로 폴백):
 * - path를 못 읽는 입력
 * - `analyze-uploads`가 아닌 legacy bucket(`uploaded-images`, `problem-images`)
 * - 첫 세그먼트가 userId(UUID)가 아닌 것 — 업로드 전 로컬 미리보기(`blob:`/`data:`)가 여기 걸린다.
 *   이걸 막지 않으면 미리보기마다 있지도 않은 path로 서명 요청이 나갔다 실패한다.
 */
export function toThumbPath(pathOrUrl: string | null | undefined): string | null {
  if (!pathOrUrl) return null;
  const parsed = parseStoragePath(pathOrUrl);
  if (!parsed || parsed.bucket !== ANALYZE_BUCKET) return null;

  const segments = parsed.path.split('/');
  if (segments.length < 2 || !UUID_RE.test(segments[0])) return null;
  if (segments[1] === THUMB_SEGMENT) return parsed.path; // 이미 썸네일

  return [segments[0], THUMB_SEGMENT, ...segments.slice(1)].join('/');
}

/**
 * 원본 signed URL(또는 path) → 썸네일 signed URL.
 * 썸네일이 없으면 빈 문자열 — 호출부가 원본으로 폴백한다.
 */
export async function resolveThumbUrl(pathOrUrl: string | null | undefined): Promise<string> {
  const thumbPath = toThumbPath(pathOrUrl);
  if (!thumbPath || missingThumbs.has(thumbPath)) return '';

  const url = await resolveImageUrl(thumbPath);
  // 썸네일 도입(2026-09-01) 이전 세션에는 썸네일 파일이 없다. `createSignedUrl`은 객체를
  // 조회하므로 없으면 실패하는데, 실패는 캐시되지 않아 목록을 다시 그릴 때마다 같은 path로
  // 서명 요청이 또 나간다. 없다는 사실만 기억해 그 반복을 끊는다.
  if (!url) missingThumbs.add(thumbPath);
  return url;
}

/**
 * "썸네일 없음" 기억을 지운다 — 지연 백필이 방금 만들어 올렸을 때 부른다.
 *
 * 이게 없으면 백필이 성공해도 이 세션 내내 없는 것으로 취급해 계속 원본으로 폴백한다.
 * 캐시가 아니라 **부재 기록**만 지우므로, 다음 `resolveThumbUrl`이 정상적으로 서명을 발급한다.
 */
export function clearMissingThumb(pathOrUrl: string | null | undefined): void {
  const thumbPath = toThumbPath(pathOrUrl);
  if (thumbPath) missingThumbs.delete(thumbPath);
}
