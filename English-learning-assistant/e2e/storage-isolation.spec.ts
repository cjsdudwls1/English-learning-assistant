/**
 * 스텁이 **실제 URL 모양에 맞는지** 지키는 가드.
 *
 * storage-stub.test.ts는 규칙이 맞는지를 앱 없이 검증한다. 하지만 규칙이 옳아도
 * Supabase가 경로를 바꾸거나 누군가 fixtures.ts를 우회하면 스텁은 조용히 0건을 가로챈 채
 * 통과한다 — 그러면 회귀 스위트가 다시 프로덕션 원본을 내려받기 시작하고,
 * 그 사실은 다음 달 청구서나 402로만 드러난다. 그래서 "실제로 가로챘는가"를 단언한다.
 */
import { test, expect } from './fixtures';
import { accounts, login, password, waitForRenderSettled } from './helpers';

test.describe('프로덕션 Storage 격리', () => {
  test('이미지 목록을 열어도 원본 바이트는 내려받지 않는다', async ({ page, storageStub }) => {
    test.skip(!password, 'E2E_PASSWORD가 주입되지 않았다');

    await login(page, accounts.student);
    await page.goto('/recent');
    await waitForRenderSettled(page);

    // 시드에 이미지가 한 장도 없으면 적중 0이 정상이다 — 그건 스텁의 실패가 아니다.
    const imgCount = await page.locator('img').count();
    test.skip(imgCount === 0, '시드에 이미지가 없어 스텁 적중을 확인할 수 없다');

    // 한 장이라도 가로챘다면 경로 매칭이 살아 있다는 뜻이다.
    expect(storageStub.stubbed).toBeGreaterThan(0);

    // 서명 URL 발급(POST)은 통과해야 한다. 이게 0이면 발급까지 막았거나
    // 이미지가 캐시로만 그려진 것이다 — 둘 다 확인이 필요하다.
    expect(storageStub.passedThrough).toBeGreaterThan(0);
  });
});
