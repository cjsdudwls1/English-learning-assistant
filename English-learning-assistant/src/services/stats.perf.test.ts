// 통계 클라이언트 집계 성능 계측 — fetchHierarchicalStats / fetchClassHierarchicalStats.
//
// Supabase fetch를 인메모리 목(인덱스 기반, O(ids))으로 대체해 네트워크를 제거하고,
// 합성 데이터 규모를 키우며 **클라이언트 측 집계(JS CPU) 시간**을 측정한다.
// 네트워크 지연이 궁금하면 scripts/load-smoke.mjs(실서버 부하 스모크)를 쓴다.
//
// 평소 `vitest run`에서는 전부 skip — 실행:
//   $env:PERF='1'; npx vitest run src/services/stats.perf.test.ts
import { describe, it, expect, vi } from 'vitest';

// vi.mock은 파일 최상단으로 호이스팅되므로 목 상태는 vi.hoisted로 준비한다
const mockState = vi.hoisted(() => ({
  tables: {} as Record<string, Array<Record<string, unknown>>>,
  // 테이블별 컬럼 인덱스: table -> col -> value -> rows (in() 필터를 O(ids)로)
  indexes: {} as Record<string, Record<string, Map<unknown, Array<Record<string, unknown>>>>>,
}));

function buildIndex(table: string, col: string) {
  const idx = new Map<unknown, Array<Record<string, unknown>>>();
  for (const r of mockState.tables[table] || []) {
    const v = r[col];
    if (!idx.has(v)) idx.set(v, []);
    idx.get(v)!.push(r);
  }
  (mockState.indexes[table] ||= {})[col] = idx;
  return idx;
}

vi.mock('./supabaseClient', () => ({
  supabase: {
    from: (table: string) => {
      let rows = mockState.tables[table] || [];
      const b: Record<string, unknown> = {
        select: () => b,
        gte: () => b,
        lte: () => b,
        not: () => b,
        order: () => b,
        eq: (col: string, v: unknown) => {
          rows = rows.filter((r) => r[col] === v);
          return b;
        },
        in: (col: string, ids: unknown[]) => {
          const idx = mockState.indexes[table]?.[col] || buildIndex(table, col);
          rows = ids.flatMap((id) => idx.get(id) || []);
          return b;
        },
        then: (onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) =>
          Promise.resolve({ data: rows, error: null }).then(onF, onR),
      };
      return b;
    },
  },
}));
vi.mock('./db', () => ({ getCurrentUserId: async () => 'user-1' }));

import { fetchHierarchicalStats, fetchClassHierarchicalStats, type StatsNode } from './stats';

// ===== 합성 데이터 =====
// taxonomy: depth1 5 × depth2 3 × depth3 3 × depth4 3 = 135행 (실서비스 135행과 동일 규모)
function makeTaxonomy() {
  const rows: Array<Record<string, unknown>> = [];
  for (let a = 0; a < 5; a++)
    for (let b = 0; b < 3; b++)
      for (let c = 0; c < 3; c++)
        for (let d = 0; d < 3; d++)
          rows.push({
            depth1: `대분류${a}`, depth2: `중분류${a}-${b}`, depth3: `소분류${a}-${b}-${c}`, depth4: `유형${a}-${b}-${c}-${d}`,
            depth1_en: `Cat${a}`, depth2_en: `Sub${a}-${b}`, depth3_en: `Minor${a}-${b}-${c}`, depth4_en: `Type${a}-${b}-${c}-${d}`,
          });
  return rows;
}

const PROBLEMS_PER_SESSION = 34; // 실측(test111): 273문제/8세션 ≈ 34

// labelCount 규모의 사용자 데이터 생성. 10%는 미분류, 10%는 미채점(is_correct null)
function seedUserData(userIds: string[], labelsPerUser: number) {
  const sessions: Array<Record<string, unknown>> = [];
  const problems: Array<Record<string, unknown>> = [];
  const labels: Array<Record<string, unknown>> = [];
  for (const uid of userIds) {
    const sessionCount = Math.max(1, Math.ceil(labelsPerUser / PROBLEMS_PER_SESSION));
    for (let s = 0; s < sessionCount; s++) {
      const sid = `${uid}-s${s}`;
      sessions.push({ id: sid, user_id: uid, created_at: '2026-01-01T00:00:00Z' });
      for (let p = 0; p < PROBLEMS_PER_SESSION; p++) {
        const n = s * PROBLEMS_PER_SESSION + p;
        if (n >= labelsPerUser) break;
        const pid = `${uid}-p${n}`;
        problems.push({ id: pid, session_id: sid });
        const a = n % 5, b = n % 3, c = (n >> 1) % 3, d = (n >> 2) % 3;
        const classification = n % 10 === 9
          ? {} // 미분류 10%
          : { depth1: `대분류${a}`, depth2: `중분류${a}-${b}`, depth3: `소분류${a}-${b}-${c}`, depth4: `유형${a}-${b}-${c}-${d}` };
        labels.push({
          problem_id: pid,
          classification,
          is_correct: n % 10 === 8 ? null : n % 2 === 0, // 미채점 10%
          user_mark: null,
        });
      }
    }
  }
  return { sessions, problems, labels };
}

function setTables(data: { sessions: unknown[]; problems: unknown[]; labels: unknown[]; classMembers?: unknown[] }) {
  mockState.tables = {
    taxonomy: makeTaxonomy(),
    sessions: data.sessions as Array<Record<string, unknown>>,
    problems: data.problems as Array<Record<string, unknown>>,
    labels: data.labels as Array<Record<string, unknown>>,
    assignment_responses: [],
    problem_solving_sessions: [],
    generated_problems: [],
    class_members: (data.classMembers || []) as Array<Record<string, unknown>>,
  };
  mockState.indexes = {}; // 인덱스는 lazy 재구축
}

// 웜업 1회 + 3회 측정 중앙값
async function measure(fn: () => Promise<unknown>): Promise<{ median: number; result: unknown }> {
  let result = await fn();
  const times: number[] = [];
  for (let i = 0; i < 3; i++) {
    const t0 = performance.now();
    result = await fn();
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  return { median: times[1], result };
}

function totalOf(nodes: StatsNode[]): number {
  // 루트(depth1 단독 키) 노드 합만 — 하위 depth 노드는 동일 행의 중복 누적이므로 루트만 센다
  return nodes.reduce((acc, n) => acc + n.total_count, 0);
}

describe.runIf(process.env.PERF === '1')('통계 클라이언트 집계 성능 계측 (PERF=1)', () => {
  it('fetchHierarchicalStats — 단일 학생, 라벨 수 스케일', async () => {
    const report: string[] = [];
    for (const n of [273, 1_000, 5_000, 20_000, 50_000]) {
      setTables(seedUserData(['user-1'], n));
      const { median, result } = await measure(() => fetchHierarchicalStats(undefined, undefined, 'ko', 'user-1'));
      const nodes = result as StatsNode[];
      // 정합성: 루트 합 = 채점된 라벨 수(미채점 10% 제외, 미분류도 루트 노드로 포함됨)
      const graded = (mockState.tables.labels as Array<{ is_correct: unknown }>).filter((l) => typeof l.is_correct === 'boolean').length;
      expect(totalOf(nodes)).toBe(graded);
      report.push(`labels=${String(n).padStart(6)}  median=${Math.round(median)}ms  rootNodes=${nodes.length}`);
    }
    console.log('\n[fetchHierarchicalStats 단일 학생]\n' + report.join('\n'));
  }, 120_000);

  it('fetchClassHierarchicalStats — 학급 30명 × 인당 라벨 수 스케일', async () => {
    const report: string[] = [];
    const CLASS_SIZE = 30;
    const students = Array.from({ length: CLASS_SIZE }, (_, i) => `stu-${i}`);
    for (const perUser of [273, 1_000, 1_700]) { // 30명 × 1,700 = 51,000 라벨
      const data = seedUserData(students, perUser);
      setTables({
        ...data,
        classMembers: students.map((uid) => ({ class_id: 'class-1', user_id: uid, role: 'student' })),
      });
      const { median, result } = await measure(() => fetchClassHierarchicalStats('class-1', 'ko'));
      const nodes = result as StatsNode[];
      // 학급 함수는 미분류를 집계하지 않으므로(UNCLASSIFIED 버킷 없음) 분류된 채점 라벨만 기대값
      const gradedClassified = (mockState.tables.labels as Array<{ is_correct: unknown; classification: Record<string, unknown> }>)
        .filter((l) => typeof l.is_correct === 'boolean' && !!l.classification?.depth1).length;
      expect(totalOf(nodes)).toBe(gradedClassified);
      report.push(`students=${CLASS_SIZE} × labels/인=${String(perUser).padStart(5)} (총 ${String(perUser * CLASS_SIZE).padStart(6)})  median=${Math.round(median)}ms  rootNodes=${nodes.length}`);
    }
    console.log('\n[fetchClassHierarchicalStats 학급 30명]\n' + report.join('\n'));
  }, 300_000);
});
