import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// supabase 체인 모킹 상태 — vi.mock 팩토리가 참조하므로 vi.hoisted로 선행 생성
const h = vi.hoisted(() => ({
  updateResult: { data: [] as Array<{ id: string }>, error: null as unknown },
  upsertResult: { error: null as unknown },
  updateCalls: [] as Array<Record<string, unknown>>,
  upsertCalls: [] as Array<{ row: Record<string, unknown>; opts: unknown }>,
}));

vi.mock('../supabaseClient', () => ({
  supabase: {
    from: (_table: string) => ({
      update: (payload: Record<string, unknown>) => {
        h.updateCalls.push(payload);
        const chain = {
          eq: () => chain,
          select: () => Promise.resolve(h.updateResult),
        };
        return chain;
      },
      upsert: (row: Record<string, unknown>, opts: unknown) => {
        h.upsertCalls.push({ row, opts });
        return Promise.resolve(h.upsertResult);
      },
    }),
  },
}));

vi.mock('./auth', () => ({
  getCurrentUserId: () => Promise.resolve('user-1'),
}));

import { completeProblemSolving } from './problemSolving';

beforeEach(() => {
  h.updateResult = { data: [], error: null };
  h.upsertResult = { error: null };
  h.updateCalls.length = 0;
  h.upsertCalls.length = 0;
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-07-10T12:00:30.000Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('completeProblemSolving — 풀이 기록 유실 방지 폴백', () => {
  it('update가 기존 행에 매치되면 upsert 폴백을 호출하지 않는다', async () => {
    h.updateResult = { data: [{ id: 'row-1' }], error: null };
    await completeProblemSolving('p1', true, 30);
    expect(h.updateCalls).toHaveLength(1);
    expect(h.upsertCalls).toHaveLength(0);
  });

  it('update가 0행 매치면(시작 기록 유실) 완료 시점 기준으로 행을 생성해 결과를 보존한다', async () => {
    h.updateResult = { data: [], error: null };
    await completeProblemSolving('p1', false, 30);
    expect(h.upsertCalls).toHaveLength(1);
    const { row, opts } = h.upsertCalls[0];
    expect(row.user_id).toBe('user-1');
    expect(row.problem_id).toBe('p1');
    expect(row.is_correct).toBe(false);
    expect(row.time_spent_seconds).toBe(30);
    // started_at = completed_at - time_spent (완료 시점 역산)
    expect(row.completed_at).toBe('2026-07-10T12:00:30.000Z');
    expect(row.started_at).toBe('2026-07-10T12:00:00.000Z');
    expect(opts).toEqual({ onConflict: 'user_id,problem_id' });
  });

  it('update 에러는 그대로 던지고 폴백을 시도하지 않는다', async () => {
    const dbError = new Error('update failed');
    h.updateResult = { data: [], error: dbError };
    await expect(completeProblemSolving('p1', true, 10)).rejects.toThrow('update failed');
    expect(h.upsertCalls).toHaveLength(0);
  });

  it('폴백 upsert 에러도 조용히 삼키지 않고 던진다', async () => {
    h.updateResult = { data: [], error: null };
    h.upsertResult = { error: new Error('upsert failed') };
    await expect(completeProblemSolving('p1', true, 10)).rejects.toThrow('upsert failed');
  });
});
