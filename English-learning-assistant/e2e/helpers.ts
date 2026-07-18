import { type Page } from '@playwright/test';

// e2e 공용 헬퍼 — 계정·감사 대상 라우트·로그인·렌더 안정화 대기.
// 자격증명은 env로만 주입한다 — 비밀번호를 커밋하지 않는다.
export const password = process.env.E2E_PASSWORD;

// QA 시드 계정(@test.com, 실사용자 아님). env로 교체 가능.
export const accounts = {
  student: process.env.E2E_STUDENT_EMAIL || 'test111@test.com',
  teacher: process.env.E2E_TEACHER_EMAIL || 'teacher_c@test.com',
  parent: process.env.E2E_PARENT_EMAIL || 'parent_c@test.com',
  director: process.env.E2E_DIRECTOR_EMAIL || 'director@test.com',
} as const;

export type Role = keyof typeof accounts;

// 역할별 감사 대상: 파라미터 없는 정적 라우트 전수.
// :id 라우트(세션 상세 등)는 데이터 의존이라 제외 — 공통 컴포넌트는 목록 페이지에서 커버된다.
export const auditPages: Record<Role, readonly string[]> = {
  student: ['/upload', '/stats', '/recent', '/problems', '/profile', '/assignments', '/retry'],
  teacher: ['/teacher/dashboard', '/teacher/assignments/create'],
  parent: ['/parent/dashboard'],
  director: ['/director/dashboard', '/academies'],
};

export async function login(page: Page, email: string) {
  await page.goto('/');
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password!);
  await page.click('button[type="submit"]');
  // 로그인 성공 시 window.location.href = '/upload' 전체 리로드
  await page.waitForURL('**/upload', { timeout: 30_000 });
}

// 데이터 렌더가 안정될 때까지 대기.
// - networkidle은 Supabase Realtime WebSocket 상시 연결 때문에 영원히 오지 않는다.
// - 고정 sleep은 페이지당 수 초를 낭비하고, 로드가 그보다 느린 환경에서는 플래키하다.
// 대신 "로딩 인디케이터 부재 + DOM 변이 quietMs 지속"을 안정 조건으로 삼고,
// maxMs 상한에서 강제 진행한다(폴링 등으로 변이가 끝나지 않는 페이지 대비).
export async function waitForRenderSettled(
  page: Page,
  { quietMs = 1_000, maxMs = 15_000 } = {},
) {
  await page.waitForLoadState('load');
  await page.evaluate(
    ({ quietMs, maxMs }) =>
      new Promise<void>((resolve) => {
        const started = performance.now();
        let lastMutation = performance.now();
        const observer = new MutationObserver(() => {
          lastMutation = performance.now();
        });
        observer.observe(document.body, {
          subtree: true,
          childList: true,
          attributes: true,
          characterData: true,
        });
        const timer = setInterval(() => {
          const now = performance.now();
          // t.common.loading('불러오는 중...'/'Loading...') 계열 표시 중이면 미안정으로 본다
          const loadingVisible = /불러오는 중|Loading/.test(document.body.innerText);
          if ((!loadingVisible && now - lastMutation >= quietMs) || now - started >= maxMs) {
            clearInterval(timer);
            observer.disconnect();
            resolve();
          }
        }, 100);
      }),
    { quietMs, maxMs },
  );
}
