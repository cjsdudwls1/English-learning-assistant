/**
 * 인증 락 계약.
 *
 * 이 락이 잘못되면 나는 증상이 조용하다: 화면이 통째로
 * "AbortError: Lock broken by another request with the 'steal' option." 이 되거나(상한이 짧을 때),
 * 인증 요청이 조용히 두 번 나간다(steal 재시도 조건이 헐거울 때),
 * 30초마다 도는 토큰 갱신 틱이 대기열에 서서 경합을 키운다(acquireTimeout 0을 무시할 때).
 * 셋 다 에러 없이 벌어지므로 여기서 고정한다.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createAuthLock } from './authLock';

const fakeLock = { name: 'n', mode: 'exclusive' } as Lock;

/** 항상 즉시 락을 내주는 가짜 LockManager. */
function grantingLocks() {
  const seen: Array<Record<string, unknown>> = [];
  const locks = {
    request: (_name: string, options: Record<string, unknown>, cb: (lock: Lock | null) => Promise<unknown>) => {
      seen.push(options);
      return Promise.resolve().then(() => cb(fakeLock));
    },
  } as unknown as LockManager;
  return { locks, seen };
}

/**
 * 이미 남이 쥐고 있는 락.
 * - steal 요청은 내준다(강제 회수)
 * - ifAvailable 요청은 null을 준다(실제 Web Locks 동작 — 기다리지 않고 즉시 콜백)
 * - 그 밖의 요청은 abort 될 때까지 붙잡는다
 */
function heldLocks() {
  const seen: Array<Record<string, unknown>> = [];
  const locks = {
    request: (_name: string, options: Record<string, unknown>, cb: (lock: Lock | null) => Promise<unknown>) => {
      seen.push(options);
      if (options.steal) return Promise.resolve().then(() => cb(fakeLock));
      if (options.ifAvailable) return Promise.resolve().then(() => cb(null));
      return new Promise((_resolve, reject) => {
        const signal = options.signal as AbortSignal | undefined;
        signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      });
    },
  } as unknown as LockManager;
  return { locks, seen };
}

afterEach(() => { vi.restoreAllMocks(); });

describe('createAuthLock', () => {
  it('Web Locks가 없는 환경에서는 직렬화 없이 그대로 실행한다', async () => {
    const lock = createAuthLock(5_000, () => undefined);
    await expect(lock('n', 5_000, async () => 'ok')).resolves.toBe('ok');
  });

  it('락을 받으면 fn을 한 번만 실행하고 결과를 돌려준다', async () => {
    const { locks, seen } = grantingLocks();
    const lock = createAuthLock(5_000, () => locks);
    let calls = 0;
    const got = await lock('n', 5_000, async () => { calls += 1; return 'ok'; });

    expect(got).toBe('ok');
    expect(calls).toBe(1);
    expect(seen).toHaveLength(1);
    // 정상 경로에서는 절대 빼앗지 않는다.
    expect(seen[0].steal).toBeUndefined();
  });

  it('상한을 넘도록 락을 못 얻으면 그때만 steal로 회수한다', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { locks, seen } = heldLocks();
    const lock = createAuthLock(1, () => locks);
    let calls = 0;
    const got = await lock('n', 5_000, async () => { calls += 1; return 'ok'; });

    expect(got).toBe('ok');
    expect(calls).toBe(1);
    expect(seen).toHaveLength(2);
    expect(seen[1].steal).toBe(true);
    // 조용히 빼앗으면 다음에 같은 일이 나도 알 수가 없다.
    expect(warn).toHaveBeenCalledOnce();
  });

  it('락을 받은 뒤 fn이 실패하면 steal로 재실행하지 않는다', async () => {
    // 여기서 재실행하면 이미 나간 인증 요청이 한 번 더 나간다.
    const { locks, seen } = grantingLocks();
    const lock = createAuthLock(5_000, () => locks);
    let calls = 0;

    await expect(
      lock('n', 5_000, async () => { calls += 1; throw new Error('fn이 터졌다'); }),
    ).rejects.toThrow('fn이 터졌다');

    expect(calls).toBe(1);
    expect(seen).toHaveLength(1);
  });

  it('fn 자신이 AbortError로 실패해도 재실행하지 않는다', async () => {
    // steal 판정을 에러 이름으로 하면 여기서 걸린다. granted 플래그로 갈라야 하는 이유.
    const { locks, seen } = grantingLocks();
    const lock = createAuthLock(5_000, () => locks);
    let calls = 0;

    await expect(
      lock('n', 5_000, async () => { calls += 1; throw new DOMException('aborted', 'AbortError'); }),
    ).rejects.toThrow(DOMException);

    expect(calls).toBe(1);
    expect(seen).toHaveLength(1);
  });

  // acquireTimeout 0 = auth-js의 자동 갱신 틱(_autoRefreshTokenTick). "지금 안 되면 관두라"는 뜻이다.
  describe('acquireTimeout 0 (기다리지 않는 호출)', () => {
    it('대기열에 서지 않고 ifAvailable로 묻는다', async () => {
      const { locks, seen } = grantingLocks();
      const lock = createAuthLock(20_000, () => locks);

      await expect(lock('n', 0, async () => 'ok')).resolves.toBe('ok');
      expect(seen).toHaveLength(1);
      expect(seen[0].ifAvailable).toBe(true);
      // signal로 기다렸다는 건 대기열에 섰다는 뜻이다.
      expect(seen[0].signal).toBeUndefined();
    });

    it('락이 잡혀 있으면 isAcquireTimeout으로 건너뛴다', async () => {
      // auth-js는 이 플래그로 "락을 못 얻었을 뿐"과 진짜 실패를 가른다. 없으면 콘솔에 에러를 뿜는다.
      const { locks, seen } = heldLocks();
      const lock = createAuthLock(20_000, () => locks);
      let calls = 0;

      await expect(
        lock('n', 0, async () => { calls += 1; return 'ok'; }),
      ).rejects.toMatchObject({ isAcquireTimeout: true });

      expect(calls).toBe(0);
      // 못 얻었다고 빼앗으면 안 된다 — 갱신 틱은 30초 뒤에 다시 온다.
      expect(seen).toHaveLength(1);
      expect(seen[0].steal).toBeUndefined();
    });
  });
});
