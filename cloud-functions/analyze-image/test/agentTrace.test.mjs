/**
 * agent_runs / agent_steps 기록 계약 테스트.
 *
 * 핵심은 **result와 나머지를 같은 자로 재면 안 된다**는 것이다.
 *   - args/observation/input = 감사 기록. 잘려도 사람이 읽는 요약이면 충분하다.
 *   - result = **제품 그 자체**. index.js는 result를 HTTP 응답에 안 싣고(:381),
 *     프론트는 agent_runs.result 행에서 읽는다(useAgentRun.applyRun).
 *     그래서 여기서 모양이 바뀌면 사용자 화면은 "생성된 보고서가 없습니다"가 되고,
 *     서버 로그는 완주로 초록인 채다. 2026-08-28 프로덕션에서 실제로 그랬다.
 *
 * DB는 목이라 네트워크 없이 `node --test`로 돈다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { appendStep, finishRun } from '../shared/agent/trace.js';

/** finishRun이 넘긴 update 행을 그대로 잡아두는 스텁. */
function mockDb({ updateError = null } = {}) {
  const updated = [];
  return {
    updated,
    from: () => ({
      update: (row) => ({ eq: async () => { updated.push(row); return { error: updateError }; } }),
    }),
  };
}

/** appendStep은 `await supabase.from(..).insert(row)` 형태다. */
function mockStepDb() {
  const inserted = [];
  return {
    inserted,
    from: () => ({
      insert: async (row) => { inserted.push(row); return { error: null }; },
      update: () => ({ eq: async () => ({ error: null }) }),
    }),
  };
}

const bigText = (n) => '가'.repeat(n);

/* ── result: 모양이 살아남는가 ───────────────────────────────────────── */

test('긴 보고서를 저장해도 result.report 키가 살아남는다', async () => {
  // 4000자는 감사 기록 상한이다. 보고서는 그걸 예사로 넘긴다(사고 건 실측: 약 6천자).
  const db = mockDb();
  const result = { report: bigText(9000), weakNodes: [{ path: '독해>추론', accuracy: 0.4 }] };

  await finishRun(db, 'run-1', { status: 'completed', stopReason: 'final', result, totalTokens: 20000, modelCalls: 5 });

  const saved = db.updated[0].result;
  assert.equal(typeof saved.report, 'string', 'report가 문자열로 남아야 한다 — 이게 깨지면 빈 모달이다');
  assert.ok(saved.report.length > 1000, 'report 본문이 통째로 사라지면 안 된다');
  assert.ok(Array.isArray(saved.weakNodes), 'weakNodes 같은 형제 키도 같이 살아남아야 한다');
  assert.equal(saved._truncated, undefined, '이 크기에선 자를 이유가 없다');
});

test('플래너 결과도 같은 보장을 받는다', async () => {
  const db = mockDb();
  const result = {
    summary: bigText(5000),
    weeklyPlan: Array.from({ length: 7 }, (_, i) => ({ day: i + 1, activity: bigText(600) })),
    problemIds: Array.from({ length: 30 }, (_, i) => `id-${i}`),
    assignmentDraft: { title: '주간 과제', problemIds: [] },
  };

  await finishRun(db, 'run-2', { status: 'completed', stopReason: 'final', result });

  const saved = db.updated[0].result;
  assert.equal(typeof saved.summary, 'string');
  assert.equal(saved.weeklyPlan.length, 7, '요일별 플랜이 통째로 날아가면 안 된다');
  assert.equal(saved.problemIds.length, 30);
  assert.ok(saved.assignmentDraft, '과제 초안 키가 남아야 [배포] 버튼이 뜬다');
});

test('상한을 넘겨도 키는 남기고 문자열만 줄인다', async () => {
  // 모델 maxOutputTokens(16384)로는 도달 불가능한 크기. 상한 자체가 사라진 게 아님을 고정한다.
  const db = mockDb();
  const result = { report: bigText(400_000), weakNodes: [{ path: 'a' }] };

  await finishRun(db, 'run-3', { status: 'completed', stopReason: 'final', result });

  const saved = db.updated[0].result;
  assert.equal(typeof saved.report, 'string', '상한을 넘겨도 report는 문자열이어야 한다');
  assert.ok(saved.weakNodes, '형제 키가 남아야 한다');
  assert.equal(saved._truncated, true, '잘렸다는 사실은 숨기지 않는다');
  assert.ok(JSON.stringify(saved).length < 400_000, '상한이 실제로 걸려야 한다');
});

test('result가 없으면 null로 저장한다', async () => {
  const db = mockDb();
  await finishRun(db, 'run-4', { status: 'failed', error: '터짐' });
  assert.equal(db.updated[0].result, null);
  assert.equal(db.updated[0].error, '터짐');
});

/* ── 감사 기록: 여기선 잘라도 된다 ───────────────────────────────────── */

test('관측은 여전히 4000자에서 잘린다 — 모델에 되먹인 뒤라 요약이면 충분하다', async () => {
  const db = mockStepDb();
  await appendStep(db, 'run-5', {
    seq: 1, thought: 't', tool: 'stats.drilldown', args: { q: 1 },
    observation: { rows: bigText(20_000) },
  });

  const saved = db.inserted[0].observation;
  assert.equal(saved._truncated, true, '관측까지 통째로 저장하면 Realtime 페이로드가 상한다');
  assert.ok(JSON.stringify(saved).length < 10_000);
});

test('기록 실패가 추론을 죽이지 않는다', async () => {
  const db = mockDb({ updateError: { message: 'DB 다운' } });
  // throw하면 이미 끝난 정상 런이 500이 된다.
  await finishRun(db, 'run-6', { status: 'completed', result: { report: 'ok' } });
});
