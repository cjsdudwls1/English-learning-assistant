import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { accounts, auditPages, login, password, waitForRenderSettled, type Role } from './helpers';

// axe-core 기반 접근성 감사 — Lighthouse 접근성 카테고리와 동일한 룰셋 계열(WCAG 2.x).

async function scan(page: Page, path: string) {
  await page.goto(path);
  await waitForRenderSettled(page);
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

  for (const [role, pages] of Object.entries(auditPages) as Array<[Role, readonly string[]]>) {
    test.describe(role, () => {
      test.skip(!password, 'E2E_PASSWORD 환경변수가 필요합니다 (QA 시드 계정 비밀번호)');

      for (const path of pages) {
        test(`${role}: ${path}`, async ({ page }) => {
          await login(page, accounts[role]);
          const blocking = await scan(page, path);
          expect(blocking, blocking.map(v => `${v.id}: ${v.help}`).join('\n')).toEqual([]);
        });
      }
    });
  }
});
