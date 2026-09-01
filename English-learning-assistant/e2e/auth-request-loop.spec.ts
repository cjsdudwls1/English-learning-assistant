import { test, expect } from './fixtures';
import { accounts, login, password, waitForRenderSettled } from './helpers';

/**
 * 인증 요청 폭주 감시.
 *
 * 2026-08-28, LanguageContext의 이펙트가 자기 의존성(hasCheckedProfile)을 스스로 뒤집어
 * 무한 재구독 루프를 돌았다. auth-js는 onAuthStateChange 구독 즉시 INITIAL_SESSION을
 * 무조건 발화하므로, 재구독이 곧바로 다음 바퀴를 낳는 구조였다.
 *
 * 이게 왜 화면을 죽였나: auth-js는 인증 호출을 하나의 Web Lock으로 직렬화한다.
 * 루프가 락을 사실상 영구 점유하니, 무관한 화면의 데이터 로딩이 락 대기 상한을 넘겨
 * "AbortError: Lock broken by another request with the 'steal' option." 으로 끊겼다.
 * CI e2e가 약 50% 확률로 빨개졌고, 교사 과제 상세가 통째로 그 문구 화면이 됐다.
 *
 * 그런데 정작 실패한 스펙은 "카운트가 안 맞는다"고만 말했다 — 원인과 한참 떨어진 증상이라
 * artifact를 열어 trace의 네트워크 기록을 세기 전까지 오진했다(처음엔 "런이 겹쳐
 * 계정을 밟았다"고 결론냈다가 철회). 그래서 원인을 직접 겨누는 스펙을 따로 둔다.
 *
 * 판별 방식: 총 횟수가 아니라 "안정된 뒤의 유휴 구간"을 본다. 마운트 시 인증 조회가
 * 몇 건인지는 화면마다 정당하게 다르지만, 렌더가 끝나고 아무것도 안 하는 동안에는
 * 0건이 정상이다. 실패 당시 trace 기준 51초 동안 /auth/v1/user 281건 —
 * 175ms 간격으로 쉬지 않고 나갔다(초당 5.7건). 유휴 구간을 보면 자릿수로 갈린다.
 */

// 유휴로 간주하고 지켜보는 시간. 루프가 있으면 이 안에 수십 건이 찍힌다.
const IDLE_WATCH_MS = 8_000;

// 허용치. 정상은 0건에 가깝지만 토큰 만료가 겹치면 갱신 1회(/auth/v1/token)가 낄 수 있어
// 여유를 둔다. 루프는 이 값의 수십 배라 경계가 애매해질 일이 없다.
const MAX_IDLE_AUTH_REQUESTS = 5;

test.describe('인증 요청이 유휴 상태에서 계속 나가지 않는다', () => {
  test.skip(!password, 'E2E_PASSWORD 환경변수가 필요합니다 (QA 시드 계정 비밀번호)');

  // 역할마다 마운트되는 컨텍스트·로더가 다르므로 학생/교사 양쪽을 본다.
  for (const [role, path] of [
    ['student', '/stats'],
    ['teacher', '/teacher/dashboard'],
  ] as const) {
    test(`${role}: ${path} 렌더 후 인증 호출이 멈춘다`, async ({ page }) => {
      await login(page, accounts[role]);
      await page.goto(path);
      await waitForRenderSettled(page);

      // 여기서부터 센다 — 마운트 시 조회는 정당하므로 세지 않는다.
      const idleRequests: string[] = [];
      const record = (req: { url(): string }) => {
        const url = req.url();
        if (url.includes('/auth/v1/')) idleRequests.push(url.replace(/^https?:\/\/[^/]+/, ''));
      };
      page.on('request', record);

      // 의도적인 유휴 관찰 구간이라 고정 대기가 맞다 — 기다릴 조건이 "아무 일도 안 일어남"이다.
      await page.waitForTimeout(IDLE_WATCH_MS);
      page.off('request', record);

      // 실패 시 무엇이 돌고 있었는지 바로 보이게 붙인다.
      expect(
        idleRequests.length,
        `유휴 ${IDLE_WATCH_MS}ms 동안 인증 요청 ${idleRequests.length}건. ` +
          `인증 호출이 루프를 돌고 있다. 최근 5건: ${idleRequests.slice(-5).join(', ')}`,
      ).toBeLessThanOrEqual(MAX_IDLE_AUTH_REQUESTS);
    });
  }
});
