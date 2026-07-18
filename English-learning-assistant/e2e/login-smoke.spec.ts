import { test, expect } from '@playwright/test';

// 자격증명은 env로만 주입한다 — 비밀번호를 커밋하지 않는다.
// E2E_PASSWORD 미설정 시 전체 스킵: 시크릿 없는 환경(CI 포함)에서 실패하지 않는다.
const password = process.env.E2E_PASSWORD;

// 이메일은 QA 시드 계정(@test.com, 실사용자 아님). env로 교체 가능.
const roles = [
  {
    role: 'director',
    email: process.env.E2E_DIRECTOR_EMAIL || 'director@test.com',
    path: '/director/dashboard',
    heading: /원장 대시보드|Director Dashboard/,
  },
  {
    role: 'teacher',
    email: process.env.E2E_TEACHER_EMAIL || 'teacher_c@test.com',
    path: '/teacher/dashboard',
    heading: /교사 대시보드|Teacher Dashboard/,
  },
  {
    role: 'parent',
    email: process.env.E2E_PARENT_EMAIL || 'parent_c@test.com',
    path: '/parent/dashboard',
    heading: /학부모 대시보드|Parent Dashboard/,
  },
  {
    role: 'student',
    email: process.env.E2E_STUDENT_EMAIL || 'test111@test.com',
    path: '/assignments',
    heading: /내 과제|My Assignments/,
  },
] as const;

test.describe('역할별 로그인 → 대시보드 스모크', () => {
  test.skip(!password, 'E2E_PASSWORD 환경변수가 필요합니다 (QA 시드 계정 비밀번호)');

  for (const { role, email, path, heading } of roles) {
    test(`${role}: 로그인 후 ${path} 렌더`, async ({ page }) => {
      await page.goto('/');
      await page.fill('input[type="email"]', email);
      await page.fill('input[type="password"]', password!);
      await page.click('button[type="submit"]');
      // 로그인 성공 시 window.location.href = '/upload' 전체 리로드
      await page.waitForURL('**/upload', { timeout: 30_000 });

      await page.goto(path);
      // RoleGate가 프로필 role을 비동기 로드한 뒤 페이지를 렌더한다
      await expect(page.getByRole('heading', { name: heading })).toBeVisible({ timeout: 30_000 });
    });
  }
});
