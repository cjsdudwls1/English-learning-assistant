import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// axe-core 기반 접근성 감사 — Lighthouse 접근성 카테고리와 동일한 룰셋 계열(WCAG 2.x).
// 자격증명은 env로만 주입한다 — 비밀번호를 커밋하지 않는다. (login-smoke.spec.ts와 동일 규약)
const password = process.env.E2E_PASSWORD;

// 역할별 감사 대상: 파라미터 없는 정적 라우트 전수.
// :id 라우트(세션 상세 등)는 데이터 의존이라 제외 — 공통 컴포넌트는 목록 페이지에서 커버된다.
const audits = [
  {
    role: 'student',
    email: process.env.E2E_STUDENT_EMAIL || 'test111@test.com',
    pages: ['/upload', '/stats', '/recent', '/problems', '/profile', '/assignments', '/retry'],
  },
  {
    role: 'teacher',
    email: process.env.E2E_TEACHER_EMAIL || 'teacher_c@test.com',
    pages: ['/teacher/dashboard', '/teacher/assignments/create'],
  },
  {
    role: 'parent',
    email: process.env.E2E_PARENT_EMAIL || 'parent_c@test.com',
    pages: ['/parent/dashboard'],
  },
  {
    role: 'director',
    email: process.env.E2E_DIRECTOR_EMAIL || 'director@test.com',
    pages: ['/director/dashboard', '/academies'],
  },
] as const;

async function login(page: Page, email: string) {
  await page.goto('/');
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password!);
  await page.click('button[type="submit"]');
  await page.waitForURL('**/upload', { timeout: 30_000 });
}

async function scan(page: Page, path: string) {
  await page.goto(path);
  // Supabase Realtime WebSocket이 상시 연결이라 networkidle은 영원히 오지 않는다 — load 후 데이터 렌더를 고정 대기
  await page.waitForLoadState('load');
  await page.waitForTimeout(5_000);
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  // 심각도 상위(critical/serious)만 게이트. moderate/minor는 리포트만 남긴다.
  const blocking = results.violations.filter(
    v => v.impact === 'critical' || v.impact === 'serious'
  );
  for (const v of results.violations) {
    const targets = v.nodes.slice(0, 5).map(n => n.target.join(' ')).join(' | ');
    // color-contrast의 data에 실측치(fgColor/bgColor/contrastRatio)가 담긴다 — 팔레트 계산과 실측이 다를 때 판단 근거
    const data = v.nodes[0]?.any?.[0]?.data;
    console.log(
      `[a11y][${v.impact}] ${path} ${v.id}: ${v.help} (${v.nodes.length}곳) → ${targets}` +
      (data ? ` ※ ${JSON.stringify(data)}` : '')
    );
  }
  return blocking;
}

test.describe('접근성 감사 (axe-core, WCAG 2.1 AA)', () => {
  test('비로그인: 로그인 페이지', async ({ page }) => {
    const blocking = await scan(page, '/');
    expect(blocking, blocking.map(v => `${v.id}: ${v.help}`).join('\n')).toEqual([]);
  });

  for (const { role, email, pages } of audits) {
    test.describe(role, () => {
      test.skip(!password, 'E2E_PASSWORD 환경변수가 필요합니다 (QA 시드 계정 비밀번호)');

      for (const path of pages) {
        test(`${role}: ${path}`, async ({ page }) => {
          await login(page, email);
          const blocking = await scan(page, path);
          expect(blocking, blocking.map(v => `${v.id}: ${v.help}`).join('\n')).toEqual([]);
        });
      }
    });
  }
});
