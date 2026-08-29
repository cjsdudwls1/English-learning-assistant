import { defineConfig, devices } from '@playwright/test';

// E2E_BASE_URL이 지정되면(배포 프리뷰 등) 해당 URL을 대상으로 하고 로컬 서버를 띄우지 않는다.
const baseURL = process.env.E2E_BASE_URL || 'http://localhost:3001';

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  // 직렬 실행. 스펙 전체가 역할당 QA 시드 계정 하나(@test.com)를 공유하기 때문이다.
  // 병렬(fullyParallel + 워커 4개)로 돌리면 같은 계정으로 2분 새 60여 회 로그인이 몰려
  // helpers.ts의 waitForURL('**/upload')이 30초 안에 안 끝나고 5건 안팎이 무작위로 깨졌다.
  // 비밀번호나 앱 코드 문제가 아니다 — 같은 조건에서 워커 1개면 81/81 전부 통과한다.
  // 대가는 시간(약 3분 → 약 9분)뿐이고, CI e2e 잡의 timeout-minutes: 30 안에 들어온다.
  // 병렬을 되살리려면 계정 공유부터 없애야 한다(역할별 storageState 재사용 또는 계정 분리).
  fullyParallel: false,
  workers: 1,
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
