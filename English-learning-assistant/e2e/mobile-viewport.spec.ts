import { test, expect, type Page } from '@playwright/test';
import { accounts, auditPages, login, password, waitForRenderSettled, type Role } from './helpers';

// 모바일 뷰포트 레이아웃 점검 — 가로 오버플로(콘텐츠 잘림/가로 스크롤) 검출.
// global.css가 768px 이하에서 body{overflow-x:hidden}을 걸어 페이지 레벨 스크롤은
// 가려지므로, 요소 레벨로 뷰포트 밖으로 나간 요소를 직접 찾는다.

// iPhone 13/14(390) + 보급형 Android(360) — 좁을수록 오버플로 검출 확률이 높다
const VIEWPORTS = [
  { width: 390, height: 844 },
  { width: 360, height: 800 },
] as const;

// 뷰포트 가로 범위를 벗어난 가시 요소를 찾는다.
// overflow-x가 visible이 아닌 조상(스크롤 컨테이너/클리핑) 안에 있으면 의도된 패턴으로 허용.
async function findOverflows(page: Page, path: string) {
  await page.goto(path);
  await waitForRenderSettled(page);
  return page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const TOLERANCE = 1; // 서브픽셀 오차 허용
    const offenders: string[] = [];
    const isClipped = (el: Element): boolean => {
      // body는 클리핑 조상으로 인정하지 않는다 — global.css가 모바일에서
      // body{overflow-x:hidden}을 걸어 두어 body까지 인정하면 검사가 무력화된다.
      let p = el.parentElement;
      while (p && p !== document.body && p !== document.documentElement) {
        const ox = getComputedStyle(p).overflowX;
        if (ox === 'auto' || ox === 'scroll' || ox === 'hidden' || ox === 'clip') return true;
        p = p.parentElement;
      }
      return false;
    };
    for (const el of Array.from(document.querySelectorAll('body *'))) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue; // 비가시 요소
      if (r.right <= vw + TOLERANCE && r.left >= -TOLERANCE) continue;
      if (isClipped(el)) continue;
      // 부모가 이미 위반이면 자식은 중복 보고하지 않는다
      const pr = el.parentElement?.getBoundingClientRect();
      if (pr && (pr.right > vw + TOLERANCE || pr.left < -TOLERANCE)) continue;
      const cls = typeof el.className === 'string' ? el.className.split(/\s+/).slice(0, 6).join('.') : '';
      offenders.push(
        `<${el.tagName.toLowerCase()}${cls ? ` class="${cls}"` : ''}> left=${Math.round(r.left)} right=${Math.round(r.right)} (vw=${vw})`
      );
    }
    return offenders;
  });
}

for (const viewport of VIEWPORTS) {
  test.describe(`모바일 뷰포트 ${viewport.width}x${viewport.height} 가로 오버플로 점검`, () => {
    test.use({ viewport: { ...viewport } });

    test('비로그인: 로그인 페이지', async ({ page }) => {
      const offenders = await findOverflows(page, '/');
      expect(offenders, offenders.join('\n')).toEqual([]);
    });

    for (const [role, pages] of Object.entries(auditPages) as Array<[Role, readonly string[]]>) {
      test.describe(role, () => {
        test.skip(!password, 'E2E_PASSWORD 환경변수가 필요합니다 (QA 시드 계정 비밀번호)');

        for (const path of pages) {
          test(`${role}: ${path}`, async ({ page }) => {
            await login(page, accounts[role]);
            const offenders = await findOverflows(page, path);
            expect(offenders, offenders.join('\n')).toEqual([]);
          });
        }
      });
    }
  });
}
