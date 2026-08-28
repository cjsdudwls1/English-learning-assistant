/**
 * 컨설턴트 도구 계약 테스트.
 *
 * 고정하려는 것: **프론트가 만든 가상 카테고리를 도구가 되돌릴 수 있어야 한다.**
 * useConsulting.buildScope는 depth1이 없는 행을 '미분류'(en: 'Unclassified')로 묶어
 * input에 넣는다. 모델은 그 이름을 그대로 nodePath로 되돌려 주는데, taxonomy에는 그런
 * 노드가 없어 예전엔 전부 0건이 나왔다. 결과는 조용한 환각이었다 —
 * 프로덕션 실행 d2951b3a의 보고서 첫 문단이 "'미분류'에서 정답률 0%"라고 단정했는데,
 * 그 근거가 된 stats.drilldown은 {total:0}을 돌려준 상태였다.
 *
 * 즉 이건 성능이 아니라 **정합성 계약**이다. 프론트가 라벨을 붙이는 방식과 서버가
 * 그 라벨을 해석하는 방식은 서로 다른 레포 영역에 있고, 어긋나도 에러가 안 난다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { drilldownTool, wrongSamplesTool } from '../shared/agent/tools/consultantTools.js';

/** select/eq/in/not을 전부 흘려보내고 테이블 고정 데이터를 돌려주는 thenable 스텁. */
function mockDb(tables) {
  return {
    from: (table) => {
      const b = {
        select: () => b,
        eq: () => b,
        in: () => b,
        not: () => b,
        then: (resolve) => resolve({ data: tables[table] ?? [], error: null }),
      };
      return b;
    },
  };
}

/** 라벨 3개: 분류 없는 오답 2 + 분류된 정답 1. */
const FIXTURE = {
  taxonomy: [],
  sessions: [{ id: 's1', created_at: '2026-08-01T00:00:00Z' }],
  problems: [
    { id: 'p1', session_id: 's1' },
    { id: 'p2', session_id: 's1' },
    { id: 'p3', session_id: 's1' },
  ],
  labels: [
    { problem_id: 'p1', classification: {}, is_correct: false, user_answer: '②', correct_answer: '④' },
    { problem_id: 'p2', classification: null, is_correct: false, user_answer: '①', correct_answer: '③' },
    { problem_id: 'p3', classification: { depth1: '문법', depth2: '시제' }, is_correct: true, user_answer: '②', correct_answer: '②' },
  ],
  assignment_responses: [],
  problem_solving_sessions: [],
  generated_problems: [],
};

const ctx = () => ({ db: mockDb(FIXTURE), userId: 'u1', cache: new Map() });

test("'미분류'는 depth1이 없는 행으로 되돌아간다", async () => {
  const out = await drilldownTool.handler({ nodePath: '미분류' }, ctx());

  assert.equal(out.total, 2, '분류 라벨이 없는 행 2개를 잡아야 한다');
  assert.equal(out.correct, 0);
  assert.equal(out.accuracy, 0);
  // 하위 분류가 있을 리 없다. 빈 배열이어야 모델이 "더 팔 곳 없음"을 알고 다음으로 넘어간다.
  assert.deepEqual(out.children, []);
});

test("영어 UI의 'Unclassified'도 같은 행을 가리킨다", async () => {
  const out = await drilldownTool.handler({ nodePath: 'Unclassified' }, ctx());
  assert.equal(out.total, 2);
});

test('가상 카테고리 처리가 실제 분류 매칭을 오염시키지 않는다', async () => {
  const out = await drilldownTool.handler({ nodePath: '문법' }, ctx());

  assert.equal(out.total, 1);
  assert.equal(out.correct, 1);
  assert.deepEqual(out.children, [
    { label: '시제', total: 1, correct: 1, incorrect: 0, accuracy: 100 },
  ]);
});

test("'미분류 > 무언가'는 가상 카테고리로 치지 않는다", async () => {
  // 센티널은 **단일 세그먼트**일 때만이다. 하위 경로가 붙으면 평범한 경로 매칭으로 떨어져
  // 0건이 나오는 게 맞다 — 없는 노드를 있는 척하면 그게 다시 환각의 재료가 된다.
  const out = await drilldownTool.handler({ nodePath: '미분류 > 시제' }, ctx());
  assert.equal(out.total, 0);
});

test('samples.wrong은 등록 문제 오답의 원문을 돌려준다', async () => {
  const out = await wrongSamplesTool.handler({ nodePath: '미분류', limit: 8 }, ctx());

  assert.equal(out.returned, 2);
  assert.ok(out.samples.every((s) => s.source === 'registered'));
  assert.equal(out.samples[0].user_answer, '②');
  assert.equal(out.samples[0].correct_answer, '④');
});

/**
 * 두 번째 결함: 표본 도구만 모집단이 좁았다.
 * drilldown/timeseries는 등록+생성을 합산하는데 samples.wrong은 labels만 뒤졌다.
 * 그래서 **생성 문제로만 이뤄진 노드**는 "오답 33건"이라 세어 놓고 표본은 0개가 나왔다
 * (실측: 이 계정의 '미분류' 33건이 전부 생성 문제였다). 숫자와 근거가 갈리는 상태다.
 */
const GEN_FIXTURE = {
  taxonomy: [],
  sessions: [],
  problems: [],
  labels: [],
  assignment_responses: [
    { problem_id: 'g1', student_id: 'u1', is_correct: false, submitted_at: '2026-08-10T00:00:00Z', answer: '②' },
  ],
  problem_solving_sessions: [
    { problem_id: 'g2', user_id: 'u1', is_correct: false, completed_at: '2026-08-11T00:00:00Z' },
  ],
  generated_problems: [
    {
      id: 'g1', classification: {}, stem: 'Choose the correct form.', choices: ['have', 'has', 'had', 'having'],
      correct_answer: null, correct_answer_index: 2, problem_type: '객관식', explanation: '과거완료 시제',
    },
    {
      id: 'g2', classification: null, stem: 'Fill in the blank.', choices: ['in', 'on', 'at'],
      correct_answer: 'on', correct_answer_index: null, problem_type: '객관식', explanation: '전치사',
    },
  ],
};

const genCtx = () => ({ db: mockDb(GEN_FIXTURE), userId: 'u1', cache: new Map() });

test('samples.wrong이 생성 문제 오답까지 표본으로 가져온다', async () => {
  const out = await wrongSamplesTool.handler({ nodePath: '미분류', limit: 8 }, genCtx());

  assert.equal(out.returned, 2, '등록 문제가 하나도 없어도 표본이 나와야 한다');
  assert.ok(out.samples.every((s) => s.source === 'generated'));

  // 최근 오답부터. g2(08-11)가 g1(08-10)보다 앞선다.
  assert.equal(out.samples[0].stem, 'Fill in the blank.');
  assert.equal(out.samples[0].correct_answer, 'on');
  // problem_solving_sessions에는 학생 답 컬럼이 없다 — 없는 걸 지어내지 않는다.
  assert.equal(out.samples[0].user_answer, null);

  const g1 = out.samples.find((s) => s.stem === 'Choose the correct form.');
  assert.equal(g1.user_answer, '②', '과제 응답의 답을 붙여야 한다');
  assert.equal(g1.correct_answer, 'had', 'correct_answer가 비면 인덱스로 선택지를 짚는다');
});

test('drilldown이 센 오답 수와 samples.wrong의 모집단이 같다', async () => {
  const drill = await drilldownTool.handler({ nodePath: '미분류' }, genCtx());
  const samples = await wrongSamplesTool.handler({ nodePath: '미분류', limit: 15 }, genCtx());

  assert.equal(drill.incorrect, 2);
  assert.equal(samples.returned, drill.incorrect, '숫자만 있고 근거가 없는 상태가 다시 생기면 안 된다');
});
