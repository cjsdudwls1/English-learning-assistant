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

// 화면 문자열 매처.
// playwright.config.ts가 locale: 'ko-KR'이라 실제로는 ko로 뜨지만,
// LanguageContext가 localStorage·profiles.language로도 언어를 정하므로
// 계정 설정 하나로 스펙이 통째로 깨지지 않게 en도 함께 받는다.
// 텍스트 문구는 src/utils/translations.ts의 ko/en 값과 짝을 맞춰 유지할 것.
export const T = {
  add: /^(추가|Add)$/,
  addByEmail: /이메일로 추가|Add by email/,
  assignmentTitle: /과제 제목|Assignment title/,
  createSubmit: /^(과제 생성|Create Assignment)/,
  submitAnswer: /^(답안 제출|Submit Answer)$/,
  shortAnswerInput: /답을 입력하세요|Enter your answer/,
  essayInput: /답안을 작성하세요|Write your answer/,
  allSolved: /모든 문제를 풀었습니다|solved all problems/i,
  // 완료 화면 '정답: {correct} / {total}'
  correctSummary: /(?:정답|Correct):\s*(\d+)\s*\/\s*(\d+)/,
  reviewHeading: /문제 다시 보기|Review Problems/,
  markCorrect: /^(맞음|Correct)$/,
  markWrong: /^(틀림|Incorrect)$/,
  notGraded: /^(미채점|Not graded)$/i,
  completed: /완료|Completed/,
  deleteAssignment: /^(삭제|Delete)$/,
  // 학생 /stats 연간 카드
  statTotalProblems: /^(총 문제|Total Problems)$/,
  statCorrectIncorrect: /^(정답\/오답|Correct \/ Incorrect)$/,
} as const;

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

// 학생 /stats 상단 SolvingStatsCard의 '{year}년 전체' 카드 수치.
// 월/일 카드는 사용자가 월을 고르기 전까지 렌더되지 않으므로 첫 StatCard 묶음이 연간이다.
// 데이터가 0건이면 AssignmentStatsDisplay가 StatCard 대신 '데이터가 없습니다.'만 렌더한다 → 0으로 읽는다.
export async function readYearSolvingTotals(page: Page) {
  const totalLabel = page.locator('p').filter({ hasText: T.statTotalProblems }).first();
  if ((await totalLabel.count()) === 0) return { total: 0, correct: 0, incorrect: 0 };

  const totalText = await totalLabel.locator('xpath=following-sibling::p[1]').innerText();
  const ratioText = await page
    .locator('p')
    .filter({ hasText: T.statCorrectIncorrect })
    .first()
    .locator('xpath=following-sibling::p[1]')
    .innerText();

  const [correct, incorrect] = ratioText.split('/').map((s) => Number(s.trim()));
  return { total: Number(totalText.match(/\d+/)?.[0]), correct, incorrect };
}
