import { test, expect, type Page } from './fixtures';
import {
  accounts,
  auditRoutes,
  login,
  password,
  resolveAuditPath,
  waitForRenderSettled,
  type AuditRoute,
  type Role,
} from './helpers';

// 화면 정상성 감사 — "이 화면이 애초에 제대로 떴는가"만 본다.
//
// 다른 세 스펙과 역할이 겹치지 않는다:
//   - mobile-viewport  : 밖으로 삐져나간 것
//   - mobile-ergonomics: 안에 들어왔지만 크거나·잘리거나·짜부라진 것
//   - a11y             : 접근성 위반
//   - 여기(screen-health): 예외로 죽었는가 / 빈 화면인가 / 엉뚱한 데로 튕겼는가 / 에러 문구가 떴는가
//
// 뷰포트를 하나(데스크톱)만 도는 이유: 여기서 잡는 건 레이아웃이 아니라 **런타임 상태**라
// 화면 폭과 무관하다. 폭에 따른 문제는 위 두 스펙이 360/390에서 이미 전수로 돈다.
// 검사 개수를 두 배로 불려 CI 시간을 태울 이유가 없다.

/** 화면에 이 문구가 떠 있으면 로드가 실패한 것이다. '데이터가 없습니다'(정상 빈 상태)와 구분된다. */
const ERROR_TEXT = /실패했습니다|오류가 발생했습니다|Failed to (load|fetch)|An error occurred/;

/**
 * 콘솔 에러 중 화면 정상성과 무관한 알려진 소음.
 * - Supabase auth의 navigator.locks 경합은 앱 코드가 이미 무시하고 다음 폴링에서 복구한다.
 * - ResizeObserver 루프 경고는 브라우저 내부 스케줄링 이슈다.
 */
const CONSOLE_NOISE = [
  /Lock broken/i,
  /lock.*steal/i,
  /ResizeObserver loop/i,
  /Download the React DevTools/i,
  /favicon/i,
];

// 빈 화면 판정 — 글자 수만으로는 못 정한다.
// 처음엔 "본문 30자 미만"으로 뒀다가 멀쩡한 화면 둘을 잡았다:
//   /academies/new  → 23자. 폼은 placeholder가 innerText에 안 잡혀서 원래 글자가 적다.
//   /retry          → 18자. '다시 풀 문제가 없습니다.' + 버튼 하나가 정상 빈 상태다.
// 진짜 잡아야 할 건 "React가 죽어서 아무것도 안 그려진" 화면이다. 그건 글자도 없고 요소도 없다.
// 그래서 둘 다 바닥일 때만 실패로 본다 — 아이콘만 있는 화면(글자 0, 요소 다수)은 통과시킨다.
const BLANK_TEXT_MAX = 10;
const BLANK_ELEMENT_MAX = 3;

interface Health {
  pageErrors: string[];
  consoleErrors: string[];
}

/** 페이지 수명 동안의 예외·콘솔 에러를 모은다. goto 이전에 붙여야 초기 렌더 예외를 놓치지 않는다. */
function watch(page: Page): Health {
  const health: Health = { pageErrors: [], consoleErrors: [] };
  page.on('pageerror', (e) => health.pageErrors.push(`${e.name}: ${e.message}`));
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    if (CONSOLE_NOISE.some((re) => re.test(text))) return;
    health.consoleErrors.push(text);
  });
  return health;
}

async function auditScreen(page: Page, path: string, health: Health): Promise<string[]> {
  await page.goto(path);
  await waitForRenderSettled(page);
  const problems: string[] = [];

  // 1) 처리되지 않은 예외 — 화면이 반쯤 죽어도 DOM은 남으므로 다른 검사로는 안 잡힌다.
  for (const e of health.pageErrors) {
    problems.push(`[예외] ${e}`);
  }

  // 2) 엉뚱한 경로로 튕김 — RoleGate/AuthGate가 <Navigate>로 조용히 돌려보낸 경우.
  //    맞는 역할로 들어갔는데 튕겼다면 권한 판정이나 라우팅이 깨진 것이다.
  const landed = new URL(page.url()).pathname;
  if (landed !== path.split(/[?#]/)[0]) {
    problems.push(`[리다이렉트] ${path} 요청했으나 ${landed}에 있음 (권한 게이트/라우팅 확인)`);
  }

  // 3) 빈 화면 — 상단바를 제외한 본문에 글자도 요소도 없는 경우.
  const body = await page.evaluate(() => {
    // 상단바는 어느 화면에서나 똑같이 뜨므로 빼고 센다 — 안 빼면 죽은 화면도 통과한다.
    // (상단바는 body 직계가 아니라 레이아웃 래퍼 안에 있어서 contains로 걸러야 한다.)
    const bar = document.querySelector('header.topbar');
    let elements = 0;
    for (const el of Array.from(document.querySelectorAll('body *'))) {
      if (bar && (el === bar || bar.contains(el))) continue;
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) elements += 1;
    }
    const barText = bar ? (bar as HTMLElement).innerText : '';
    const text = barText ? document.body.innerText.replace(barText, '') : document.body.innerText;
    return { textLen: text.replace(/\s+/g, '').length, elements };
  });
  if (body.textLen < BLANK_TEXT_MAX && body.elements < BLANK_ELEMENT_MAX) {
    problems.push(
      `[빈화면] 상단바 밖 본문이 글자 ${body.textLen}자 · 가시요소 ${body.elements}개뿐 — 렌더가 중단됐을 수 있음`,
    );
  }

  // 4) 에러 문구 노출 — 데이터 로드가 실패한 상태로 굳은 화면.
  const errorLine = await page.evaluate((src) => {
    const re = new RegExp(src);
    return document.body.innerText.split('\n').find((l) => re.test(l)) ?? null;
  }, ERROR_TEXT.source);
  if (errorLine) {
    problems.push(`[에러문구] "${errorLine.trim().slice(0, 80)}"`);
  }

  // 콘솔 에러는 게이트하지 않고 리포트만 남긴다 — 서드파티/네트워크 소음이 섞여
  // 실패로 세우면 스펙이 금세 신뢰를 잃는다. 조사할 단서로만 쓴다.
  for (const c of health.consoleErrors) {
    console.log(`[screen-health][console] ${path}: ${c.slice(0, 200)}`);
  }

  return problems;
}

test.describe('화면 정상성 감사', () => {
  test('비로그인: 로그인 페이지', async ({ page }) => {
    const health = watch(page);
    const problems = await auditScreen(page, '/', health);
    expect(problems, problems.join('\n')).toEqual([]);
  });

  for (const [role, routes] of Object.entries(auditRoutes) as Array<[Role, readonly AuditRoute[]]>) {
    test.describe(role, () => {
      test.skip(!password, 'E2E_PASSWORD 환경변수가 필요합니다 (QA 시드 계정 비밀번호)');

      for (const route of routes) {
        test(`${role}: ${route.label}`, async ({ page }) => {
          await login(page, accounts[role]);
          const path = await resolveAuditPath(page, route);
          test.skip(!path, `시드에 데이터가 없어 ${route.label}을(를) 열 수 없습니다`);
          // 로그인·경로 해석 중의 소음은 감사 대상이 아니다. 대상 화면 진입 직전부터 듣는다.
          const health = watch(page);
          const problems = await auditScreen(page, path!, health);
          expect(problems, problems.join('\n')).toEqual([]);
        });
      }
    });
  }
});
