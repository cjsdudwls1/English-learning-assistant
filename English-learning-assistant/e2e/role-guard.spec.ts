import { test, expect, type Page } from '@playwright/test';
import { accounts, login, password, waitForRenderSettled, type Role } from './helpers';

// 권한 경계와 '없는 리소스' 처리 감사.
//
// 지금까지의 스펙은 전부 **맞는 역할이 맞는 화면에 들어갔을 때**만 봤다.
// 실제로 사고가 나는 자리는 그 반대편이다:
//   1) 학생이 URL을 직접 쳐서 /director/dashboard로 들어간다 → RoleGate가 막아야 한다
//   2) 남의 것이거나 지워진 id로 상세 화면을 연다 → 안내가 떠야 한다.
//      RLS가 0행을 돌려주므로 '권한 없음'이 아니라 '데이터 없음'으로 도착한다 —
//      페이지가 이 경우를 안 다루면 빈 화면이나 영구 스피너로 굳는다.
//
// 데이터를 만들지 않는다(읽기 전용). 없는 id는 존재할 수 없는 UUID를 쓴다.

/** 어떤 테이블에도 존재하지 않는 UUID. v4 형식이라 uuid 컬럼 캐스팅에서 먼저 깨지지 않는다. */
const FAKE_ID = '00000000-0000-4000-8000-000000000000';

/** RoleGate가 권한 밖 접근을 되돌려 보내는 곳 (src/components/RoleGate.tsx의 ROLE_HOME). */
const ROLE_HOME: Record<Role, string> = {
  student: '/upload',
  teacher: '/teacher/dashboard',
  parent: '/parent/dashboard',
  director: '/director/dashboard',
};

/**
 * 역할별로 **들어가면 안 되는** 라우트 — App.tsx RoleGate allowedRoles의 여집합이다.
 * (allowedRoles를 좁히거나 넓히면 여기도 같이 고쳐야 한다. 안 고치면 이 스펙이 먼저 깨진다.)
 */
const DENIED: Record<Role, readonly string[]> = {
  student: [
    '/teacher/dashboard',
    '/teacher/assignments/create',
    `/teacher/classes/${FAKE_ID}`,
    '/parent/dashboard',
    '/director/dashboard',
    `/academies/${FAKE_ID}/members`,
  ],
  teacher: [
    '/assignments',
    `/assignments/${FAKE_ID}`,
    '/parent/dashboard',
    '/director/dashboard',
    `/academies/${FAKE_ID}/members`,
  ],
  parent: [
    '/assignments',
    `/assignments/${FAKE_ID}`,
    '/teacher/dashboard',
    '/teacher/assignments/create',
    '/director/dashboard',
    `/academies/${FAKE_ID}/members`,
  ],
  director: [
    '/assignments',
    `/assignments/${FAKE_ID}`,
    '/teacher/dashboard',
    '/parent/dashboard',
  ],
};

/**
 * 역할별로 **들어갈 수는 있지만 대상이 없는** 경로.
 * 권한 판정은 통과하고 데이터 조회만 0행이 되는 경우 — 화면이 이 상태를 어떻게 마감하는지 본다.
 */
const MISSING: Record<Role, readonly string[]> = {
  student: [`/session/${FAKE_ID}`, `/edit/${FAKE_ID}`, `/assignments/${FAKE_ID}`],
  teacher: [`/teacher/classes/${FAKE_ID}`, `/teacher/assignments/${FAKE_ID}`],
  parent: [],
  director: [`/academies/${FAKE_ID}/members`],
};

/** 미처리 예외만 모은다. 콘솔 에러는 여기선 정상 신호다(RLS 0행이 406으로 찍힌다). */
function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`${e.name}: ${e.message}`));
  return errors;
}

/** 상단바를 제외한 본문의 글자 수·가시 요소 수·스피너 잔존 여부. screen-health의 빈화면 판정과 같은 기준. */
async function readBody(page: Page) {
  return page.evaluate(() => {
    const bar = document.querySelector('header.topbar');
    let elements = 0;
    for (const el of Array.from(document.querySelectorAll('body *'))) {
      if (bar && (el === bar || bar.contains(el))) continue;
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) elements += 1;
    }
    const barText = bar ? (bar as HTMLElement).innerText : '';
    const text = barText ? document.body.innerText.replace(barText, '') : document.body.innerText;
    // 스피너는 CSS 애니메이션이라 DOM을 흔들지 않는다 → waitForRenderSettled가 '안정'으로 판정한다.
    // 안정된 화면에 스피너만 남아 있으면 그건 로딩이 아니라 고착이다.
    const spinning = Array.from(document.querySelectorAll('.animate-spin')).some((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    });
    return { textLen: text.replace(/\s+/g, '').length, elements, spinning };
  });
}

test.describe('권한 경계 · 없는 리소스 처리', () => {
  test.skip(!password, 'E2E_PASSWORD 환경변수가 필요합니다 (QA 시드 계정 비밀번호)');

  for (const role of Object.keys(DENIED) as Role[]) {
    const home = ROLE_HOME[role];

    for (const denied of DENIED[role]) {
      test(`${role}: ${denied} 접근이 ${home}로 차단된다`, async ({ page }) => {
        await login(page, accounts[role]);
        const errors = watchErrors(page);

        await page.goto(denied);
        // RoleGate는 역할 조회가 끝나야 판정한다(그전엔 스피너). 리다이렉트를 먼저 기다리고,
        // 안 오면 조용히 빠져나와 아래에서 '어디에 있는지'로 실패 사유를 남긴다.
        await page
          .waitForURL((u) => new URL(u).pathname === home, { timeout: 20_000 })
          .catch(() => {});
        await waitForRenderSettled(page);

        const landed = new URL(page.url()).pathname;
        expect(
          landed,
          `${role} 계정이 ${denied}에 접근했는데 ${landed}에 머물렀다 — RoleGate가 막지 못했다`,
        ).toBe(home);

        // 막기만 하고 돌려보낸 곳이 죽어 있으면 사용자 입장에선 똑같이 고장이다.
        const body = await readBody(page);
        expect(body.textLen, `${home}로 돌아왔으나 본문이 비어 있다`).toBeGreaterThan(10);
        expect(errors, errors.join('\n')).toEqual([]);
      });
    }

    for (const missing of MISSING[role]) {
      test(`${role}: ${missing} — 없는 대상이어도 화면이 마감된다`, async ({ page }) => {
        await login(page, accounts[role]);
        const errors = watchErrors(page);

        await page.goto(missing);
        await waitForRenderSettled(page);

        const problems: string[] = [];
        for (const e of errors) problems.push(`[예외] ${e}`);

        const body = await readBody(page);
        if (body.textLen < 10 && body.elements < 3) {
          problems.push(`[빈화면] 본문 글자 ${body.textLen}자 · 가시요소 ${body.elements}개`);
        }
        if (body.spinning && body.textLen < 10) {
          problems.push('[로딩고착] 렌더가 안정된 뒤에도 스피너만 남아 있다 — 없는 id에서 로딩이 안 끝난다');
        }

        expect(problems, problems.join('\n')).toEqual([]);
      });
    }
  }
});
