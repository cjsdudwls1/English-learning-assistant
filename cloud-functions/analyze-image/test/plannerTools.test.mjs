/**
 * 플래너 도구 계약 테스트.
 *
 * 컨설턴트 도구와 결정적으로 다른 점: **여기엔 돈을 쓰는 도구가 있다.**
 * problems.generate는 모델을 호출하고 generated_problems에 행을 남긴다. 그래서 고정해야 하는
 * 것은 "좋은 계획을 만드는가"가 아니라 **모델이 잘못 판단해도 손해가 유한한가**다.
 *
 * 특히 런타임의 중복 차단만 믿으면 안 된다. 그건 (도구, args)가 **완전히 같을 때만** 걸려서,
 * count를 1씩 바꿔 가며 부르면 그대로 통과한다. 상한이 프롬프트 문구가 아니라 카운터로
 * 지켜지는지를 여기서 못 박는다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  PLANNER_MAX_GENERATE_CALLS,
  PLANNER_MAX_PROBLEMS,
  coverageCheckTool,
  findExistingTool,
  generateTool,
  plannerReadTools,
  plannerWriteTools,
} from '../shared/agent/tools/plannerTools.js';
import { runAgent } from '../shared/agent/runtime.js';

/**
 * thenable 스텁. **필터를 실제로 적용한다** — 흘려보내면 `.in('id', ids)`를 무시한 결과가
 * 통과해 버려서, "존재하지 않는 id를 걸러낸다" 같은 계약을 사실은 검사하지 않게 된다.
 * `classification->>depth1` 같은 PostgREST JSON 경로 표기도 같은 의미로 해석한다.
 */
function readColumn(row, column) {
  const json = column.split('->>');
  if (json.length === 2) return (row[json[0].trim()] || {})[json[1].trim()];
  return row[column];
}

function mockDb(tables) {
  return {
    from: (table) => {
      const filters = [];
      let sort = null;
      let cap = null;
      const b = {
        select: () => b,
        eq: (c, v) => (filters.push((r) => readColumn(r, c) === v), b),
        neq: (c, v) => (filters.push((r) => readColumn(r, c) !== v), b),
        in: (c, vs) => (filters.push((r) => vs.includes(readColumn(r, c))), b),
        not: () => b,
        order: (c, opts) => ((sort = { c, asc: opts?.ascending !== false }), b),
        limit: (n) => ((cap = n), b),
        then: (resolve) => {
          let data = (tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
          if (sort) {
            data = [...data].sort((x, y) => {
              const a = readColumn(x, sort.c);
              const z = readColumn(y, sort.c);
              return (a < z ? -1 : a > z ? 1 : 0) * (sort.asc ? 1 : -1);
            });
          }
          if (cap != null) data = data.slice(0, cap);
          return resolve({ data, error: null });
        },
      };
      return b;
    },
  };
}

const TAXONOMY = [
  { depth1: '문법', depth2: '시제', depth3: null, depth4: null, depth1_en: 'Grammar', depth2_en: 'Tense', depth3_en: null, depth4_en: null },
  { depth1: '독해', depth2: '추론', depth3: null, depth4: null, depth1_en: 'Reading', depth2_en: 'Inference', depth3_en: null, depth4_en: null },
];

const FIXTURE = {
  taxonomy: TAXONOMY,
  generated_problems: [
    { id: 'g1', stem: '문제 1', problem_type: 'multiple_choice', classification: { depth1: '문법', depth2: '시제' }, created_at: '2026-08-01T00:00:00Z' },
    { id: 'g2', stem: '문제 2', problem_type: 'multiple_choice', classification: { depth1: '문법', depth2: '시제' }, created_at: '2026-08-02T00:00:00Z' },
    { id: 'g3', stem: '문제 3', problem_type: 'multiple_choice', classification: { depth1: '독해', depth2: '추론' }, created_at: '2026-08-03T00:00:00Z' },
  ],
  // 필터를 실제로 적용하는 스텁이므로 사용자 식별 컬럼도 실제 스키마대로 채운다
  // (풀이 이력은 user_id, 과제 응답은 student_id — 컬럼명이 다르다).
  problem_solving_sessions: [{ problem_id: 'g2', user_id: 'u1' }, { problem_id: 'g1', user_id: 'other' }],
  assignment_responses: [{ problem_id: 'g3', student_id: 'u1' }],
};

/** 생성 호출을 실제로 하지 않고 기록만 하는 ctx. ids는 요청 수만큼 만들어 준다. */
function ctx({ tables = FIXTURE, generate } = {}) {
  const calls = [];
  const budget = {
    maxProblems: PLANNER_MAX_PROBLEMS,
    maxCalls: PLANNER_MAX_GENERATE_CALLS,
    generated: 0,
    calls: 0,
    createdIds: new Set(),
  };
  const c = {
    db: mockDb(tables),
    userId: 'u1',
    cache: new Map(),
    budget,
    generateProblems: generate ?? (async ({ count }) => {
      calls.push(count);
      return { count, problemIds: Array.from({ length: count }, (_, i) => `new-${calls.length}-${i}`) };
    }),
  };
  c.calls = calls;
  return c;
}

// ── 예산: 프롬프트가 아니라 카운터가 지킨다 ──────────────────────────────

test('문항 상한을 넘는 요청은 잘려서 실행된다 (에러로 런을 죽이지 않는다)', async () => {
  const c = ctx();
  // 상한 30을 count 10짜리 3회로 정확히 채운 뒤, 4회째를 시도한다.
  for (let i = 0; i < 3; i += 1) {
    const out = await generateTool.handler({ nodePath: '문법 > 시제', problemType: 'multiple_choice', count: 10 }, c);
    assert.equal(out.generated, 10, `${i + 1}번째 호출은 정상 생성`);
  }
  assert.equal(c.budget.generated, PLANNER_MAX_PROBLEMS);

  const over = await generateTool.handler({ nodePath: '문법 > 시제', problemType: 'multiple_choice', count: 10 }, c);
  assert.ok(over.error, '상한 도달 후에는 관측 에러가 돌아와야 한다');
  assert.equal(c.calls.length, 3, '상한 뒤에는 생성 함수를 아예 부르지 않는다');
});

test('호출 횟수 상한은 count를 잘게 쪼개도 뚫리지 않는다', async () => {
  // 런타임의 중복 차단은 args가 완전히 같을 때만 걸린다 — count를 1씩 바꾸면 통과한다.
  // 그래서 "호출 3회"라는 상한 자체가 카운터로 지켜져야 한다.
  const c = ctx();
  for (let i = 1; i <= PLANNER_MAX_GENERATE_CALLS; i += 1) {
    const out = await generateTool.handler({ nodePath: '문법 > 시제', problemType: 'multiple_choice', count: i }, c);
    assert.ok(!out.error, `${i}번째 호출은 통과해야 한다`);
  }

  const blocked = await generateTool.handler({ nodePath: '문법 > 시제', problemType: 'multiple_choice', count: 9 }, c);
  assert.ok(blocked.error, '호출 상한을 넘으면 관측 에러');
  assert.equal(c.calls.length, PLANNER_MAX_GENERATE_CALLS);
  // 총 생성량은 1+2+3=6 — 문항 상한(30)에는 한참 못 미쳐도 호출 상한이 먼저 걸린다.
  assert.equal(c.budget.generated, 6);
});

test('생성이 도중에 터져도 호출 예산은 소모된 것으로 친다', async () => {
  // 실패를 공짜로 보면 모델이 같은 호출을 무한히 재시도한다 — 그 사이 모델 호출은 이미 과금됐다.
  let attempts = 0;
  const c = ctx({
    generate: async () => { attempts += 1; throw new Error('generation exploded'); },
  });

  for (let i = 0; i < PLANNER_MAX_GENERATE_CALLS; i += 1) {
    await assert.rejects(
      generateTool.handler({ nodePath: '문법 > 시제', problemType: 'multiple_choice', count: 5 }, c),
    );
  }
  assert.equal(attempts, PLANNER_MAX_GENERATE_CALLS);
  assert.equal(c.budget.calls, PLANNER_MAX_GENERATE_CALLS, '터진 호출도 예산을 쓴 것으로 세야 한다');

  const blocked = await generateTool.handler({ nodePath: '문법 > 시제', problemType: 'multiple_choice', count: 5 }, c);
  assert.ok(blocked.error);
  assert.equal(attempts, PLANNER_MAX_GENERATE_CALLS, '상한 뒤에는 재시도조차 하지 않는다');
});

test('부분 생성은 요청 수가 아니라 실제 id 수만 예산에 반영한다', async () => {
  // generateAllProblemTypes는 Promise.allSettled라 부분 실패가 정상 경로다.
  const c = ctx({ generate: async () => ({ count: 2, problemIds: ['a', 'b'] }) });
  const out = await generateTool.handler({ nodePath: '문법 > 시제', problemType: 'multiple_choice', count: 7 }, c);

  assert.equal(out.requested, 7);
  assert.equal(out.generated, 2, '모델이 계획에 넣을 수 있는 건 실제 id뿐이다');
  assert.equal(c.budget.generated, 2);
  assert.equal(out.remainingProblems, PLANNER_MAX_PROBLEMS - 2);
});

// ── 없는 분류로는 돈을 쓰지 않는다 ──────────────────────────────────────

test('taxonomy에 없는 경로로는 생성하지 않는다', async () => {
  const c = ctx();
  const out = await generateTool.handler(
    { nodePath: '문법 > 가정법 도치', problemType: 'multiple_choice', count: 5 }, c,
  );

  assert.ok(out.error, '지어낸 노드는 거절해야 한다');
  assert.equal(c.calls.length, 0, '검증 실패 시 생성 함수를 부르면 안 된다');
  assert.equal(c.budget.calls, 0, '거절은 예산을 쓰지 않는다');
});

test('영어 라벨 경로는 같은 노드로 인정한다', async () => {
  const c = ctx();
  const out = await generateTool.handler(
    { nodePath: 'Grammar > Tense', problemType: 'multiple_choice', count: 2 }, c,
  );
  assert.ok(!out.error, `en 라벨이 거절되면 영어 UI 사용자가 통째로 막힌다: ${out.error}`);
  assert.equal(out.generated, 2);
});

test("'미분류'는 조회·생성 양쪽에서 거절된다", async () => {
  const c = ctx();
  // 프론트가 만든 가상 카테고리다. taxonomy에 없고, 학습 계획의 단위가 될 수도 없다.
  const gen = await generateTool.handler({ nodePath: '미분류', problemType: 'multiple_choice', count: 3 }, c);
  assert.ok(gen.error);
  assert.equal(c.calls.length, 0);

  const find = await findExistingTool.handler({ nodePath: 'Unclassified', problemType: 'multiple_choice', limit: 5 }, c);
  assert.ok(find.error, '영어 UI의 Unclassified도 같게 막아야 한다');
});

// ── 조회: 이미 푼 문제는 계획에 안 들어간다 ──────────────────────────────

test('findExisting은 풀이 이력·과제 응답이 있는 문제를 뺀다', async () => {
  const out = await findExistingTool.handler(
    { nodePath: '문법', problemType: 'multiple_choice', limit: 10 }, ctx(),
  );

  assert.deepEqual(out.problemIds, ['g1'], 'g2는 풀이 이력, g3는 다른 분류');
  assert.equal(out.found, 1);
});

test('findExisting은 과제로 이미 답한 문제도 뺀다', async () => {
  // 프론트(fetchExistingProblems)는 problem_solving_sessions만 본다. 플래너의 결과물은
  // "앞으로 풀 것"이라 과제 응답까지 빼야 계획이 성립한다.
  const out = await findExistingTool.handler(
    { nodePath: '독해 > 추론', problemType: 'multiple_choice', limit: 10 }, ctx(),
  );
  assert.deepEqual(out.problemIds, [], 'g3는 assignment_responses에 있다');
});

test('coverageCheck는 없는 id를 missing으로 돌려준다', async () => {
  const out = await coverageCheckTool.handler(
    { problemIds: ['g1', 'g2', '지어낸-id'] }, ctx(),
  );

  assert.equal(out.checked, 3);
  assert.deepEqual(out.missing, ['지어낸-id']);
  assert.deepEqual(out.alreadySolved, ['g2']);
  assert.deepEqual(out.byNode, [{ nodePath: '문법 > 시제', count: 2 }]);
});

// ── 배선: 쓰기 도구가 조용히 새지 않는지 ────────────────────────────────

test('쓰기 도구는 generate 하나뿐이고 조회 도구는 전부 read-only다', () => {
  assert.deepEqual(plannerWriteTools.map((t) => t.name), ['problems.generate']);
  assert.equal(generateTool.readOnly, false);
  for (const t of plannerReadTools) {
    assert.notEqual(t.readOnly, false, `${t.name}이 쓰기 도구로 선언되면 allowWrites 게이트가 무의미해진다`);
  }
});

test('쓰기 도구는 allowWrites 없이는 런 시작 자체가 막힌다', async () => {
  await assert.rejects(
    runAgent({
      ai: { generateWithRetry: async () => ({ text: '{}' }) },
      supabase: { from: () => ({ insert: async () => ({ error: null }), update: () => ({ eq: async () => ({ error: null }) }) }) },
      runId: '00000000-0000-4000-8000-000000000000',
      agentType: 'planner',
      tools: [...plannerReadTools, ...plannerWriteTools],
      systemPrompt: 'x',
      input: {},
      model: 'gemini-2.5-flash',
      toolCtx: { db: {}, userId: 'u1' },
    }),
    /allowWrites/,
  );
});

test('플래너 도구 파일은 service-role 클라이언트를 아예 모른다', () => {
  // 권한 경계는 코드가 아니라 RLS다. 이 파일이 service-role을 잡는 순간 그 보증이 사라진다.
  const source = readFileSync(
    fileURLToPath(new URL('../shared/agent/tools/plannerTools.js', import.meta.url)),
    'utf-8',
  ).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  for (const forbidden of ['SERVICE_ROLE', 'createClient', 'ctx.supabase']) {
    assert.ok(!source.includes(forbidden), `plannerTools.js가 ${forbidden}을 참조하면 안 된다`);
  }
});
