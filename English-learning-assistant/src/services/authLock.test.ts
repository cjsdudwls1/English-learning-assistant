/**
 * 인증 락 계약.
 *
 * 이 락이 잘못되면 나는 증상이 조용하다: 화면이 통째로
 * "AbortError: Lock broken by another request with the 'steal' option." 이 되거나(상한이 짧을 때),
 * 인증 요청이 조용히 두 번 나간다(steal 재시도 조건이 헐거울 때).
 * 후자가 특히 위험해서 별도로 고정한다.
 */
import { describe, it, expect } from 'vitest';
import { createAuthLock } from './authLock';

/** 항상 즉시 락을 내주는 가짜 LockManager. */
function grantingLocks() {
  const seen: Array<Record<string, unknown>> = [];
  const locks = {
    request: (_name: string, options: Record<string, unknown>, cb: () => Promise<unknown>) => {
      seen.push(options);
      return Promise.resolve().then(cb);
    },
  } as unknown as LockManager;
  return { locks, seen };
}

/** steal 요청만 내주고, 평범한 요청은 abort 될 때까지 영원히 붙잡는 가짜 LockManager. */
function heldLocks() {
  const seen: Array<Record<string, unknown>> = [];
  const locks = {
    request: (_name: string, options: Record<string, unknown>, cb: () => Promise<unknown>) => {
      seen.push(options);
      if (options.steal) return Promise.resolve().then(cb);
      return new Promise((_resolve, reject) => {
        const signal = options.signal as AbortSignal | undefined;
        signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      });
    },
  } as unknown as LockManager;
  return { locks, seen };
}

describe('createAuthLock', () => {
  it('Web Locks가 없는 환경에서는 직렬화 없이 그대로 실행한다', async () => {
    const lock = createAuthLock(5_000, () => undefined);
    await expect(lock('n', 0, async () => 'ok')).resolves.toBe('ok');
  });

  it('락을 받으면 fn을 한 번만 실행하고 결과를 돌려준다', async () => {
    const { locks, seen } = grantingLocks();
    const lock = createAuthLock(5_000, () => locks);
    let calls = 0;
    const got = await lock('n', 0, async () => { calls += 1; return 'ok'; });

    expect(got).toBe('ok');
    expect(calls).toBe(1);
    expect(seen).toHaveLength(1);
    // 정상 경로에서는 절대 빼앗지 않는다.
    expect(seen[0].steal).toBeUndefined();
  });

  it('상한을 넘도록 락을 못 얻으면 그때만 steal로 회수한다', async () => {
    const { locks, seen } = heldLocks();
    const lock = createAuthLock(1, () => locks);
    let calls = 0;
    const got = await lock('n', 0, async () => { calls += 1; return 'ok'; });

    expect(got).toBe('ok');
    expect(calls).toBe(1);
    expect(seen).toHaveLength(2);
    expect(seen[1].steal).toBe(true);
  });

  it('락을 받은 뒤 fn이 실패하면 steal로 재실행하지 않는다', async () => {
    // 여기서 재실행하면 이미 나간 인증 요청이 한 번 더 나간다.
    const { locks, seen } = grantingLocks();
    const lock = createAuthLock(5_000, () => locks);
    let calls = 0;

    await expect(
      lock('n', 0, async () => { calls += 1; throw new Error('fn이 터졌다'); }),
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
      lock('n', 0, async () => { calls += 1; throw new DOMException('aborted', 'AbortError'); }),
    ).rejects.toThrow(DOMException);

    expect(calls).toBe(1);
    expect(seen).toHaveLength(1);
  });
});
