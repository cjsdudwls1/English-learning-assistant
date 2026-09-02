/**
 * 회귀 스위트를 프로덕션 Storage에서 떼어내는 판별 로직.
 *
 * **왜 필요한가.** 2026-09-01에 조직 송신 한도(5 GB)를 넘겨 앱 전체가 402
 * `exceed_egress_quota`로 죽었다. 저장 용량은 0.455 GB인데 송신이 5.641 GB였다 —
 * 같은 데이터를 열두 번쯤 다시 보냈다는 뜻이고, 캐시 적중은 1%였다.
 * 서명 URL은 토큰이 매번 달라 CDN 캐시 키가 매번 바뀌기 때문이다.
 *
 * 그 재전송의 큰 축이 이 회귀 스위트다. E2E는 이미지를 **올리지** 않는다.
 * 대신 helpers.auditRoutes(20개)를 a11y·mobile-ergonomics·mobile-viewport·screen-health
 * 네 스펙이 각각 전수로 돌아 한 번 실행에 80회 페이지를 열고, 그중 이미지 목록을
 * 그리는 라우트가 학생만 6개다. 페이지를 새로 열 때마다 모듈 수준 URL 캐시가 죽으므로
 * 매번 새로 서명받아 매번 원본을 다시 받는다.
 *
 * **왜 다른 방법이 아닌가.** 별도 Supabase 프로젝트는 답이 아니다 — Free 플랜 할당량은
 * 프로젝트가 아니라 **조직 단위**로 합산돼서 같은 org에 스테이징을 파도 5 GB를 나눠 쓴다.
 * 로컬 스택(`supabase start`)은 Docker가 필요한데 이 개발 환경에 없다.
 * 그래서 남는 확실한 분리는 "바이트를 아예 받지 않는다"이다.
 *
 * 이 파일은 Playwright를 import하지 않는다 — 판별 로직만 vitest로 검증하기 위해서다.
 * (E2E는 앱이 살아 있어야 돌지만, 규칙이 맞는지는 앱 없이도 확인할 수 있어야 한다.)
 */

/**
 * Supabase Storage에서 **객체 바이트가 오가는** 경로인가.
 *
 * `/object/`  — 서명·공개·인증 다운로드가 모두 이 아래에 있다.
 * `/render/image/` — 이미지 변환 엔드포인트(Pro 전용이라 지금은 안 쓰지만, 켜지면 같은 부담이다).
 */
export function isStorageObjectPath(url: string): boolean {
  let pathname: string;
  try {
    pathname = new URL(url).pathname;
  } catch {
    return false;
  }
  return pathname.includes('/storage/v1/object/') || pathname.includes('/storage/v1/render/image/');
}

/**
 * 가로채야 하는 **다운로드**인가.
 *
 * 경로만으로는 가를 수 없다. 같은 `/object/sign/` 아래에서
 *   POST → 서명 URL 발급(작은 JSON). 앱 로직 그 자체라 반드시 통과시켜야 한다.
 *   GET  → 실제 이미지 다운로드(원본 1~2 MB). 이것만 막는다.
 * 메서드를 안 보고 경로로만 막으면 서명 발급이 죽어 화면이 통째로 빈다.
 */
export function isStorageObjectDownload(method: string, url: string): boolean {
  if (method.toUpperCase() !== 'GET') return false;
  return isStorageObjectPath(url);
}

/**
 * 스텁으로 돌려줄 1×1 PNG.
 *
 * 유효한 PNG여야 한다 — 깨진 바이트를 주면 `StorageThumb`의 onError가 원본으로 폴백해서
 * 막으려던 다운로드가 그대로 일어난다. 실제 크기는 상관없다. 목록 썸네일은 CSS 박스
 * (`w-16 h-16` 등) + `object-cover`로 크기가 정해지고, mobile-ergonomics의 탭 타깃 검사도
 * 레이아웃 박스를 읽지 이미지의 고유 크기를 읽지 않는다.
 */
export const STUB_IMAGE_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

export const STUB_IMAGE_CONTENT_TYPE = 'image/png';

export function stubImageBytes(): Buffer {
  return Buffer.from(STUB_IMAGE_BASE64, 'base64');
}
