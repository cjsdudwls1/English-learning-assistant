/**
 * 모든 스펙이 공유하는 Playwright `test`.
 *
 * 여기서 하는 일은 하나다 — **회귀 스위트가 프로덕션 Storage에서 이미지 바이트를
 * 내려받지 않게 막는다.** 이유와 배경은 `storage-stub.ts` 상단에 적어 뒀다.
 *
 * 스펙들이 `@playwright/test` 대신 이 파일에서 `test`를 가져오는 이유는
 * **잊을 수 없게** 만들기 위해서다. 스펙마다 beforeEach에 route를 거는 방식이면
 * 새 스펙을 쓰는 사람이 빠뜨리고, 빠뜨린 걸 아무도 눈치 못 챈 채 송신량만 늘어난다.
 * auto 픽스처는 이 파일에서 test를 가져오는 한 전부에 자동으로 붙는다.
 *
 * `browser.newContext()`/`newPage()`로 페이지를 직접 만들면 이 라우트가 안 걸린다.
 * 현재 스펙 11개는 전부 `page` 픽스처만 쓴다(2026-09-01 확인). 직접 생성이 필요해지면
 * `installStorageStub(page)`를 손으로 불러야 한다.
 */
import { test as base, expect, type Page } from '@playwright/test';
import {
  isStorageObjectDownload,
  isStorageObjectPath,
  STUB_IMAGE_CONTENT_TYPE,
  stubImageBytes,
} from './storage-stub';

export interface StorageStubStats {
  /**
   * 가로챈 다운로드 수.
   * 이미지가 있는 화면을 열었는데 0이면 스텁이 안 걸린 것이다 — `storage-isolation.spec.ts`가 이걸 본다.
   */
  stubbed: number;
  /** 통과시킨 비-GET 요청 수(서명 URL 발급 등). 앱 로직이라 막으면 안 된다. */
  passedThrough: number;
}

/** 이미 만들어진 페이지에 스텁을 건다. 반환값으로 가로챈 횟수를 읽는다. */
export async function installStorageStub(page: Page): Promise<StorageStubStats> {
  const stats: StorageStubStats = { stubbed: 0, passedThrough: 0 };
  const body = stubImageBytes();

  // 매처는 URL만 받는다(메서드를 못 본다). 그래서 경로로 넓게 잡은 뒤
  // 핸들러에서 메서드를 보고 GET이 아닌 것은 그대로 흘려보낸다.
  await page.route(
    (url) => isStorageObjectPath(url.toString()),
    async (route) => {
      const request = route.request();
      if (!isStorageObjectDownload(request.method(), request.url())) {
        stats.passedThrough += 1;
        await route.continue();
        return;
      }
      stats.stubbed += 1;
      await route.fulfill({
        status: 200,
        contentType: STUB_IMAGE_CONTENT_TYPE,
        body,
      });
    },
  );

  return stats;
}

export const test = base.extend<{ storageStub: StorageStubStats }>({
  storageStub: [
    async ({ page }, use) => {
      const stats = await installStorageStub(page);
      await use(stats);
    },
    { auto: true },
  ],
});

export { expect, type Page };
