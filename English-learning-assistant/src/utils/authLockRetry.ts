/**
 * Supabase 클라이언트가 여러 탭·동시 요청에서 auth 토큰 갱신을 위해 잡는 Web Lock이
 * 경합하면 "Lock broken"/"steal" 예외가 튀며 1회성 로드가 빈 화면으로 끝나는 경우가 있다.
 * 폴링 훅(useStatsData)은 다음 주기에 자연 복구되지만, 대시보드 초기 로드처럼
 * 재시도 경로가 없는 지점은 이 유틸로 감싸 짧게 재시도한다.
 *
 * 원래 useSolvingStats에 지역 정의돼 있던 것을 승격 — 여러 페이지가 공유한다.
 */

/** auth Lock 경합 예외인지 판정 */
export function isAuthLockError(e: unknown): boolean {
  const msg = e instanceof Error
    ? e.message
    : (e && typeof e === 'object' && 'message' in e ? String((e as { message: unknown }).message) : String(e));
  return msg.includes('Lock broken') || msg.includes('steal');
}

/**
 * fn을 실행하되 auth Lock 경합 예외면 지연 후 재시도한다(선형 백오프: delayMs × 시도횟수).
 * Lock 외 예외는 즉시 재throw — 실제 오류를 삼키지 않는다.
 */
export async function withAuthLockRetry<T>(fn: () => Promise<T>, attempts = 3, delayMs = 200): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (isAuthLockError(e) && i < attempts - 1) {
        await new Promise((r) => setTimeout(r, delayMs * (i + 1)));
        continue;
      }
      throw e;
    }
  }
  throw lastErr;
}
