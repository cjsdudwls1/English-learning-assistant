import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { accounts, auditRoutes, login, password, resolveAuditPath, waitForRenderSettled, type AuditRoute, type Role } from './helpers';

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
    console.log(`[a11y][${v.impact}] ${path} ${v.id}: ${v.help} (${v.nodes.length}곳)`);
    // 노드마다 한 줄씩 찍는다. 예전엔 첫 노드의 data만 찍었는데, color-contrast는
    // 위반마다 색·글자 크기가 제각각이라 첫 줄만 보고 고치면 나머지가 그대로 남는다.
    // data에 실측치(fgColor/bgColor/contrastRatio/fontSize)가 담겨 팔레트 계산과 실측이 갈릴 때 판단 근거가 된다.
    for (const n of v.nodes.slice(0, 5)) {
      const data = n.any?.[0]?.data ?? n.all?.[0]?.data ?? n.none?.[0]?.data;
      console.log(
        `[a11y][${v.impact}]   → ${n.target.join(' ')}` + (data ? ` ※ ${JSON.stringify(data)}` : '')
      );
    }
    if (v.nodes.length > 5) console.log(`[a11y][${v.impact}]   → …외 ${v.nodes.length - 5}곳`);
  }
  return blocking;
}

test.describe('접근성 감사 (axe-core, WCAG 2.1 AA)', () => {
  test('비로그인: 로그인 페이지', async ({ page }) => {
    const blocking = await scan(page, '/');
    expect(blocking, blocking.map(v => `${v.id}: ${v.help}`).join('\n')).toEqual([]);
  });

  for (const [role, routes] of Object.entries(auditRoutes) as Array<[Role, readonly AuditRoute[]]>) {
    test.describe(role, () => {
      test.skip(!password, 'E2E_PASSWORD 환경변수가 필요합니다 (QA 시드 계정 비밀번호)');

      for (const route of routes) {
        test(`${role}: ${route.label}`, async ({ page }) => {
          await login(page, accounts[role]);
          const path = await resolveAuditPath(page, route);
          test.skip(!path, `시드에 데이터가 없어 ${route.label}을(를) 열 수 없습니다`);
          const blocking = await scan(page, path!);
          expect(blocking, blocking.map(v => `${v.id}: ${v.help}`).join('\n')).toEqual([]);
        });
      }
    });
  }
});
