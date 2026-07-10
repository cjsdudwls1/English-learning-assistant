import { defineConfig, devices } from '@playwright/test';

// E2E_BASE_URL이 지정되면(배포 프리뷰 등) 해당 URL을 대상으로 하고 로컬 서버를 띄우지 않는다.
const baseURL = process.env.E2E_BASE_URL || 'http://localhost:3001';

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL,
    // ko-KR 고정 — 브라우저 로케일에 따라 UI 언어가 갈리므로 결정적으로 만든다
    // (로그인 후에는 profile.language가 우선하므로 단언은 ko/en 양쪽을 허용)
    locale: 'ko-KR',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: 'npm run dev',
        url: 'http://localhost:3001',
        reuseExistingServer: true,
        timeout: 120_000,
      },
});
