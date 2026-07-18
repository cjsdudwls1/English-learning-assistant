import { test, expect } from '@playwright/test';
import { accounts, login, password } from './helpers';

// 역할별 랜딩 페이지 — 로그인 후 역할 라우팅(RoleGate)이 살아있는지 확인
const landings = [
  { role: 'director', path: '/director/dashboard', heading: /원장 대시보드|Director Dashboard/ },
  { role: 'teacher', path: '/teacher/dashboard', heading: /교사 대시보드|Teacher Dashboard/ },
  { role: 'parent', path: '/parent/dashboard', heading: /학부모 대시보드|Parent Dashboard/ },
  { role: 'student', path: '/assignments', heading: /내 과제|My Assignments/ },
] as const;

test.describe('역할별 로그인 → 대시보드 스모크', () => {
  test.skip(!password, 'E2E_PASSWORD 환경변수가 필요합니다 (QA 시드 계정 비밀번호)');

  for (const { role, path, heading } of landings) {
    test(`${role}: 로그인 후 ${path} 렌더`, async ({ page }) => {
      await login(page, accounts[role]);
      await page.goto(path);
      // RoleGate가 프로필 role을 비동기 로드한 뒤 페이지를 렌더한다
      await expect(page.getByRole('heading', { name: heading })).toBeVisible({ timeout: 30_000 });
    });
  }
});
