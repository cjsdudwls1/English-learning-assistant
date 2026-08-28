// Supabase 인증 락.
//
// auth-js는 인증 상태를 건드리는 모든 호출(getUser·getSession·토큰 갱신·
// onAuthStateChange 구독 시의 INITIAL_SESSION 발화까지)을 하나의 Web Lock으로 직렬화한다.
// 기본 구현은 락 획득 상한이 5초이고, 그 안에 못 얻으면 고아 락으로 판정해
// navigator.locks.request(..., { steal: true })로 빼앗는다. 그러면 락을 정상적으로
// 쥐고 있던 요청이 "AbortError: Lock broken by another request with the 'steal' option."
// 으로 죽는다 — 화면 전체가 그 문구로 대체되는 증상이 이것이었다.
//
// 그 증상의 진짜 원인은 상한이 아니라 LanguageContext의 재구독 무한 루프였고, 그건
// 거기서 고쳤다(같은 커밋). 실패 trace 기준 /auth/v1/user 요청이 51초 동안 281건,
// 175ms 간격으로 끊임없이 나가 락이 사실상 영구 점유됐다. 상한을 20초로 올려도
// 똑같이 실패한 게 그 증거다.
//
// 그래서 이 파일은 "상한을 늘려 증상을 덮는" 물건이 아니다. 남긴 이유는 두 가지다.
//  1. 5초는 여전히 빠듯하다. 페이지 로드 한 번에 App/AuthGate/UserRoleContext/
//     페이지 로더가 getUser()·getSession()을 여러 개 동시에 부르고(StrictMode 개발
//     빌드에선 2배), getUser()는 락을 쥔 채 /auth/v1/user 왕복을 한다. 정상 대기가
//     고아 락으로 오인되는 여지를 없앤다.
//  2. 기본 구현은 상한 초과 시 조용히 빼앗는다. 여기서는 빼앗기 전에 경고를 남겨,
//     다음에 같은 일이 나면 콘솔만 보고 "또 루프다"를 알 수 있게 한다.
//
// steal 자체는 지우지 않는다 — 진짜 고아 락(StrictMode 언마운트 등)을 회수할 수단이
// 없어지면 그때는 영구 교착이다.
export const AUTH_LOCK_ACQUIRE_MS = 20_000;

type LockFn = <R>(name: string, acquireTimeout: number, fn: () => Promise<R>) => Promise<R>;

/**
 * auth-js가 "기다리지 말라"(acquireTimeout 0)고 부른 자리에서, 락이 이미 잡혀 있을 때 던진다.
 * auth-js는 이 에러를 `e.isAcquireTimeout` 으로 판별해 조용히 건너뛴다
 * (GoTrueClient._autoRefreshTokenTick의 catch). 이 플래그가 없으면 갱신 틱이
 * 진짜 실패로 취급돼 콘솔에 에러를 뿜는다.
 */
class AuthLockAcquireTimeoutError extends Error {
  readonly isAcquireTimeout = true;
  constructor(lockName: string) {
    super(`인증 락 "${lockName}" 을(를) 즉시 얻지 못했다`);
    this.name = 'AuthLockAcquireTimeoutError';
  }
}

/**
 * @param acquireMs 이 시간까지는 정상 대기로 본다. 넘기면 그때만 steal로 회수한다.
 * @param getLocks  주입 지점(테스트용). 기본은 브라우저의 Web Locks.
 */
export function createAuthLock(
  acquireMs: number,
  getLocks: () => LockManager | undefined = () => globalThis.navigator?.locks,
): LockFn {
  return async function authLock<R>(name: string, acquireTimeout: number, fn: () => Promise<R>): Promise<R> {
    const locks = getLocks();
    // Web Locks 미지원 환경(구형 사파리 등)은 직렬화 없이 실행 — auth-js 폴백과 같은 동작.
    if (!locks) return await fn();

    // acquireTimeout 0 = "기다리지 말라". auth-js에서 이 값으로 부르는 건 30초마다 도는
    // 자동 갱신 틱(_autoRefreshTokenTick) 하나뿐이고, 못 얻으면 다음 틱에 다시 온다.
    // 여기서 대기열에 세우면 갱신 틱이 오히려 락 경합을 키운다 — 기본 구현도 이 경우만
    // ifAvailable로 갈라 놓았다(lib/locks.js).
    if (acquireTimeout === 0) {
      return await locks.request(name, { mode: 'exclusive', ifAvailable: true }, async (lock) => {
        if (!lock) throw new AuthLockAcquireTimeoutError(name);
        return await fn();
      }) as R;
    }

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
      // 여기까지 왔다는 건 누군가 acquireMs 넘게 락을 쥐고 있다는 뜻이다. 정상이 아니다.
      console.warn(`인증 락 "${name}" 이(가) ${acquireMs}ms 안에 풀리지 않아 회수한다. 인증 호출이 루프를 돌고 있는지 확인할 것.`);
      return await locks.request(name, { mode: 'exclusive', steal: true }, async () => await fn());
    } finally {
      clearTimeout(timer);
    }
  };
}

export const authLock = createAuthLock(AUTH_LOCK_ACQUIRE_MS);
