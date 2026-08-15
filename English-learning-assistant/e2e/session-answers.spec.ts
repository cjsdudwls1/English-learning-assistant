import { test, expect } from '@playwright/test';
import { accounts, login, password, waitForRenderSettled } from './helpers';

// 이미지 분석 세션의 답·정오답이 실제로 화면에 뜨는지 본다.
//
// 2026-08-15 프로덕션에서 사용자 답안·실제 정답·정오답이 통째로 사라진 적이 있다.
// 원인은 PostgREST 임베디드 관계의 모양이었다 — labels가 one-to-one으로 판정되면서
// 배열이 아니라 객체로 오는데, 프론트는 `labels[0]`으로 꺼내고 있었다. 쿼리도 RLS도
// 데이터도 정상이라 에러가 하나도 나지 않았고, 화면만 조용히 비었다.
//
// 단위 테스트(utils/postgrestEmbed.test.ts)는 헬퍼의 계약만 고정한다. 실제 API가
// 어느 모양으로 응답하는지는 DB 제약에 달려 있어서, 배포된 화면을 실제로 열어보는
// 이 스펙만이 같은 사고를 다시 잡아낼 수 있다.
//
// 기존 분석 세션에 의존한다(이미지 분석은 건당 비용이 발생해 스펙에서 만들지 않는다).
// 세션이 없는 계정에서는 판별이 불가능하므로 건너뛰되, 건너뛴 사실은 사유와 함께 남긴다.

// 세션 카드의 집계 문구. ko와 en의 어순이 다르다 — RecentProblemsPage는 ko를 인라인
// 템플릿('문제 N개 | 정답 N개 | 오답 N개')로 찍고 en만 translations.sessionSummary
// ('N problems | Correct: N | Incorrect: N')를 쓴다. 양쪽 다 받는다.
const SESSION_SUMMARY_KO = /문제\s*(\d+)\s*개\s*\|\s*정답\s*(\d+)\s*개\s*\|\s*오답\s*(\d+)\s*개/;
const SESSION_SUMMARY_EN = /(\d+)\s*problems\s*\|\s*Correct:\s*(\d+)\s*\|\s*Incorrect:\s*(\d+)/;

test.describe('이미지 분석 세션 — 답·정오답 표시', () => {
  test.skip(!password, 'E2E_PASSWORD 미주입');

  test('세션 목록의 정답·오답 집계가 0으로 붕괴하지 않는다', async ({ page }) => {
    await login(page, accounts.student);
    await page.goto('/recent');
    await waitForRenderSettled(page);

    const body = await page.locator('body').innerText();
    const m = body.match(SESSION_SUMMARY_KO) || body.match(SESSION_SUMMARY_EN);
    test.skip(!m, '라벨링 완료된 세션이 없어 판별 불가');

    const [, count, correct, incorrect] = m!.map(Number);
    // 회귀 전에는 labels 객체의 .length가 undefined라 조건이 늘 거짓이 되어
    // 문항 수는 멀쩡한데 정답·오답만 나란히 0으로 찍혔다. 그 조합을 직접 막는다.
    expect(count).toBeGreaterThan(0);
    expect(correct + incorrect).toBeGreaterThan(0);
  });

  test('세션 상세에 사용자 답안과 실제 정답이 채워져 있다', async ({ page }) => {
    await login(page, accounts.student);
    await page.goto('/recent');
    await waitForRenderSettled(page);

    const detail = page.getByRole('button', { name: /상세보기|View Details/ }).first();
    test.skip((await detail.count()) === 0, '열람 가능한 세션이 없어 판별 불가');
    await detail.click();
    await page.waitForURL('**/session/**', { timeout: 30_000 });
    await waitForRenderSettled(page);

    // 답은 편집 가능한 input으로 렌더된다 — "안 뜬다"는 곧 value가 빈 문자열이라는 뜻이다.
    const correctInputs = page.locator('input[placeholder="정답 입력"], input[placeholder="Enter correct answer"]');
    // count()는 assertion과 달리 auto-wait을 하지 않는다(helpers.ts 참고). 세션 상세는
    // 문항 수십 개와 이미지를 함께 그려서 waitForRenderSettled의 상한을 넘길 수 있고,
    // 그때 count()를 먼저 읽으면 아직 그리는 중인 화면을 '문항 0개'로 오독한다.
    await expect(correctInputs.first(), '세션 상세에 문항이 렌더되지 않았다').toBeVisible({ timeout: 60_000 });
    const answerCount = await correctInputs.count();

    const values = await correctInputs.evaluateAll((els) =>
      els.map((el) => (el as HTMLInputElement).value.trim()),
    );
    // 문항별로는 정답이 비어 있을 수 있다(해설지에 없는 문항 등). 회귀는 전부가 비는 형태로
    // 나타났으므로 "하나라도 채워져 있는가"로 가른다.
    expect(values.filter(Boolean).length, `정답 input ${answerCount}개가 전부 비어 있다`).toBeGreaterThan(0);

    // 사용자 답안도 같은 label 행에서 온다 — 정답만 살고 답안이 죽는 회귀도 잡는다.
    const userInputs = page.locator('input[placeholder="답안 입력"], input[placeholder="Enter answer"]');
    if ((await userInputs.count()) > 0) {
      const userValues = await userInputs.evaluateAll((els) =>
        els.map((el) => (el as HTMLInputElement).value.trim()),
      );
      expect(userValues.filter(Boolean).length, '사용자 답안 input이 전부 비어 있다').toBeGreaterThan(0);
    }
  });
});
