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

// ─── 감사 대상 라우트 ────────────────────────────────────────────────────────
// App.tsx의 라우트 전수를 여기 한 곳에 모은다. a11y·mobile-viewport·mobile-ergonomics·
// screen-health 네 스펙이 모두 이 목록을 읽으므로, 라우트를 추가하면 네 검사가 함께 붙는다.
//
// 예전에는 파라미터 없는 정적 라우트만 담았다. 그 결과 `/session/:id`, `/edit/:id` 같은
// 실제로 가장 많이 보는 화면이 통째로 사각지대였고, 사용자가 폰에서 먼저 발견했다.
// 그래서 파라미터 라우트도 **실데이터에서 id를 얻어** 감사한다(resolve).
// 시드에 데이터가 없으면 resolve가 null을 돌려주고 해당 케이스는 실패가 아니라 skip 된다.

export interface AuditRoute {
  /** 테스트 제목에 쓰는 이름. 라우트 패턴 그대로 적는다. */
  label: string;
  /** 파라미터가 없는 라우트. resolve와 택일. */
  path?: string;
  /** 런타임에 실제 경로를 만든다. 데이터가 없으면 null(→ skip). resolve와 path는 택일. */
  resolve?: (page: Page) => Promise<string | null>;
}

/** 목록 화면을 열어 첫 링크의 href를 읽는다. 파라미터 라우트 해석의 기본 수단. */
async function hrefFromList(page: Page, listPath: string, selector: string): Promise<string | null> {
  await page.goto(listPath);
  await waitForRenderSettled(page);
  // count()는 auto-wait을 하지 않는다. 위 대기가 로딩 종료를 보장한 뒤에만 세야 '0건'이 오독이 아니다.
  const links = page.locator(selector);
  if ((await links.count()) === 0) return null;
  return links.first().getAttribute('href');
}

/**
 * `/recent`에서 세션 하나를 골라 id를 얻는다.
 * 이 앱의 세션 이동은 Link가 아니라 onClick navigate라서 href를 읽을 수 없다 —
 * 실제로 눌러서 바뀐 URL에서 id를 뜯는다.
 */
async function firstSessionId(page: Page): Promise<string | null> {
  await page.goto('/recent');
  await waitForRenderSettled(page);
  // 문제 0개인 세션은 버튼이 disabled다 — 눌리는 것만 고른다.
  const btn = page.locator('button:not([disabled])').filter({ hasText: T.viewDetails }).first();
  if ((await btn.count()) === 0) return null;
  await btn.click();
  await page.waitForURL('**/session/*', { timeout: 15_000 });
  return page.url().split('/session/')[1]?.split(/[?#]/)[0] || null;
}

export const auditRoutes: Record<Role, readonly AuditRoute[]> = {
  student: [
    { label: '/upload', path: '/upload' },
    { label: '/stats', path: '/stats' },
    { label: '/recent', path: '/recent' },
    { label: '/problems', path: '/problems' },
    { label: '/profile', path: '/profile' },
    { label: '/assignments', path: '/assignments' },
    { label: '/retry', path: '/retry' },
    {
      label: '/assignments/:assignmentId (과제 풀이)',
      resolve: (page) => hrefFromList(page, '/assignments', 'a[href^="/assignments/"]'),
    },
    {
      label: '/session/:sessionId (세션 상세)',
      resolve: async (page) => {
        const id = await firstSessionId(page);
        return id && `/session/${id}`;
      },
    },
    {
      // 이 라우트는 앱 안 어디에서도 링크되지 않는다(2026-08-30 확인) — URL 직접 입력으로만 도달한다.
      // 그래도 살아 있는 라우트라 렌더는 감사한다.
      label: '/edit/:sessionId (분석 결과 편집)',
      resolve: async (page) => {
        const id = await firstSessionId(page);
        return id && `/edit/${id}`;
      },
    },
    {
      // 분석 진행 화면은 '분석 중인 세션'이 있어야 뜨는데 그건 몇 초짜리 과도 상태라 시드로 못 만든다.
      // 존재하지 않는 id를 주면 AnalyzingPage가 completed/failed를 못 보고 진행 화면에 머무른다 —
      // 그게 정확히 감사하려는 레이아웃이다(getSessionProgress 실패는 페이지가 이미 catch한다).
      label: '/analyzing/:sessionId (분석 진행)',
      path: '/analyzing/00000000-0000-4000-8000-000000000000',
    },
  ],
  teacher: [
    { label: '/teacher/dashboard', path: '/teacher/dashboard' },
    { label: '/teacher/assignments/create', path: '/teacher/assignments/create' },
    {
      label: '/teacher/assignments/:assignmentId',
      resolve: (page) => hrefFromList(page, '/teacher/dashboard', 'a[href^="/teacher/assignments/"]'),
    },
    {
      label: '/teacher/classes/:classId',
      resolve: (page) => hrefFromList(page, '/teacher/dashboard', 'a[href^="/teacher/classes/"]'),
    },
  ],
  parent: [{ label: '/parent/dashboard', path: '/parent/dashboard' }],
  director: [
    { label: '/director/dashboard', path: '/director/dashboard' },
    { label: '/academies', path: '/academies' },
    { label: '/academies/new', path: '/academies/new' },
    {
      label: '/academies/:id/members',
      resolve: (page) => hrefFromList(page, '/academies', 'a[href^="/academies/"][href$="/members"]'),
    },
  ],
};

/**
 * 감사 대상 경로를 확정한다. 정적이면 그대로, 파라미터 라우트면 목록을 거쳐 해석한다.
 * 반환이 null이면 시드에 데이터가 없다는 뜻 — 호출측에서 test.skip으로 드러낸다.
 */
export async function resolveAuditPath(page: Page, route: AuditRoute): Promise<string | null> {
  if (route.path) return route.path;
  return route.resolve ? route.resolve(page) : null;
}

// 화면 문자열 매처.
// playwright.config.ts가 locale: 'ko-KR'이라 실제로는 ko로 뜨지만,
// LanguageContext가 localStorage·profiles.language로도 언어를 정하므로
// 계정 설정 하나로 스펙이 통째로 깨지지 않게 en도 함께 받는다.
// 텍스트 문구는 src/utils/translations.ts의 ko/en 값과 짝을 맞춰 유지할 것.
export const T = {
  add: /^(추가|Add)$/,
  addByEmail: /이메일로 추가|Add by email/,
  assignmentTitle: /과제 제목|Assignment title/,
  // ProblemSelector 헤딩 '{selected} / {total} 문제 선택됨'.
  // 로딩이 끝나야 렌더되고 목록이 비어도 나오므로, 문제 개수를 세기 전 대기 앵커로 쓴다.
  problemsSelectedRatio: /\d+\s*\/\s*\d+\s*(?:문제 선택됨|problems selected)/,
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
  // /recent 세션 카드의 상세 진입 버튼 (t.recent.viewDetails)
  viewDetails: /^(상세보기|View Details)$/,
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
// 상한에서 강제 진행한다(폴링 등으로 변이가 끝나지 않는 페이지 대비).
//
// 상한이 두 개인 이유 — 아직 로딩 중인데 maxMs로 빠져나오면, 뒤따르는 읽기가 전부 오독이 된다.
// count()·innerText()는 assertion과 달리 auto-wait을 하지 않아 로딩 화면을 그대로 '데이터 0건'으로
// 읽는다. 실제로 CI(2026-07-27)에서 ProblemSelector가 '문제를 불러오는 중...'인 순간을 세어
// "교사 계정에 자동채점 가능한 생성 문제가 없다"로 3회 연속 실패했다 — 문제는 있었다.
// 그래서 로딩 인디케이터가 보이는 동안에는 훨씬 긴 loadingMaxMs까지 기다린다.
export async function waitForRenderSettled(
  page: Page,
  { quietMs = 1_000, maxMs = 15_000, loadingMaxMs = 60_000 } = {},
) {
  await page.waitForLoadState('load');
  await page.evaluate(
    ({ quietMs, maxMs, loadingMaxMs }) =>
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
          const budget = loadingVisible ? loadingMaxMs : maxMs;
          if ((!loadingVisible && now - lastMutation >= quietMs) || now - started >= budget) {
            clearInterval(timer);
            observer.disconnect();
            resolve();
          }
        }, 100);
      }),
    { quietMs, maxMs, loadingMaxMs },
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
