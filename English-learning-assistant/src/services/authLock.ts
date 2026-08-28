// Supabase 인증 락.
//
// auth-js 기본 구현은 락 획득 상한이 5초이고, 그 안에 못 얻으면 고아 락으로 판정해
// navigator.locks.request(..., { steal: true })로 빼앗는다. 그러면 락을 정상적으로
// 쥐고 있던 요청이 "AbortError: Lock broken by another request with the 'steal' option."
// 으로 죽는다.
//
// 문제는 우리 앱에서 5초가 전혀 넉넉하지 않다는 것이다 — 페이지 로드 한 번에
// App/AuthGate/UserRoleContext/LanguageContext/페이지 로더가 getUser()·getSession()을
// 동시에 열 개 넘게 부르고(StrictMode 개발 빌드에선 2배), getUser()는 락을 쥔 채
// /auth/v1/user 왕복을 하므로 대기열이 쉽게 5초를 넘긴다. 즉 정상 대기를 고아 락으로
// 오인해 스스로를 끊고 있었다.
//
// 증상: 교사 과제 상세가 통째로 위 AbortError 화면이 됨. 로컬에선 거의 안 보이고
// 러너가 느린 CI e2e에서 ~50% 재현됐다. services/db/auth.ts의 single-flight가 같은
// 원인을 한 번 좁혔지만, 그 헬퍼를 안 거치는 직접 호출이 많아 대기열 자체는 남아 있었다.
//
// 상한만 늘려 오인을 없앤다. 진짜 고아 락(StrictMode 언마운트 등) 회수를 위한 steal은
// 최후수단으로 남긴다 — 없애면 그때는 영구 교착이다.
export const AUTH_LOCK_ACQUIRE_MS = 20_000;

type LockFn = <R>(name: string, acquireTimeout: number, fn: () => Promise<R>) => Promise<R>;

/**
 * @param acquireMs 이 시간까지는 정상 대기로 본다. 넘기면 그때만 steal로 회수한다.
 * @param getLocks  주입 지점(테스트용). 기본은 브라우저의 Web Locks.
 */
export function createAuthLock(
  acquireMs: number,
  getLocks: () => LockManager | undefined = () => globalThis.navigator?.locks,
): LockFn {
  return async function authLock<R>(name: string, _acquireTimeout: number, fn: () => Promise<R>): Promise<R> {
    const locks = getLocks();
    // Web Locks 미지원 환경(구형 사파리 등)은 직렬화 없이 실행 — auth-js 폴백과 같은 동작.
    if (!locks) return await fn();

    const controller = new AbortController();
    let granted = false;
    const timer = setTimeout(() => { if (!granted) controller.abort(); }, acquireMs);

    try {
      return await locks.request(name, { mode: 'exclusive', signal: controller.signal }, async () => {
        granted = true;
        clearTimeout(timer);
        return await fn();
      });
    } catch (e) {
      // 락을 받은 뒤의 실패는 fn() 자신의 실패다. 여기서 재실행하면 인증 요청이 두 번 나간다.
      if (granted || !controller.signal.aborted) throw e;
      return await locks.request(name, { mode: 'exclusive', steal: true }, async () => await fn());
    } finally {
      clearTimeout(timer);
    }
  };
}

export const authLock = createAuthLock(AUTH_LOCK_ACQUIRE_MS);
