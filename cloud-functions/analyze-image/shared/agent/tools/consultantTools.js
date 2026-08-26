/**
 * 학습 컨설턴트 에이전트 도구 (전부 read-only)
 *
 * ── 이 파일이 지켜야 하는 계약 ────────────────────────────────────
 * 1) **ctx.db는 호출자 JWT 클라이언트다.** service-role을 절대 쓰지 않는다.
 *    "이 학생 데이터를 볼 수 있는가"는 여기 코드가 아니라 RLS가 판정한다.
 * 2) **집계 정의는 프론트(src/services/stats.ts)와 한 글자도 달라선 안 된다.**
 *    - is_correct가 boolean인 행만 센다. null(미채점·기권)은 오답으로 위조하지 않고 제외.
 *    - 등록 문제(labels)와 생성 문제 풀이(과제 응답 + 완료된 생성문제 풀이)를 합산한다.
 *      labels만 세면 화면 숫자와 보고서 숫자가 갈린다 — 시연에서 가장 먼저 들키는 종류의 버그다.
 * 3) 전역 요약 수치는 이 도구들이 만들지 않는다. 프론트가 계산해 input으로 넘긴 값이 유일한 기준이고,
 *    여기서는 **드릴다운·표적 표본·추세**만 조회한다.
 *
 * ── 성능 ──────────────────────────────────────────────────────────
 * 세션→문제→라벨 3단 조회는 PostgREST 중첩 필터의 풀스캔을 피하기 위한 기존 패턴 그대로다
 * (ID_CHUNK=500). 한 런에서 도구를 여러 번 부르므로 ctx.cache에 메모이즈한다.
 */

import { defineTool } from '../registry.js';

const ID_CHUNK = 500;
const PATH_SEP = '>';

const norm = (v) => String(v ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

function splitPath(nodePath) {
  return String(nodePath ?? '')
    .split(PATH_SEP)
    .map((s) => s.trim())
    .filter(Boolean);
}

async function memo(ctx, key, factory) {
  if (!ctx.cache) return factory();
  if (!ctx.cache.has(key)) ctx.cache.set(key, factory());
  return ctx.cache.get(key);
}

/**
 * taxonomy의 ko/en 라벨을 하나의 정규형(ko 소문자)으로 접는 별칭표.
 * labels.classification에는 ko 또는 en 라벨이 그대로 들어 있고(코드가 아님),
 * 프론트는 화면 언어에 맞춰 번역해 보여준다. 서버가 같은 접기를 하지 않으면
 * 영어 UI 사용자의 nodePath가 한국어 라벨과 매칭되지 않아 "0건"이 나온다.
 */
async function aliasMap(ctx) {
  return memo(ctx, 'taxonomyAlias', async () => {
    const map = new Map();
    const { data, error } = await ctx.db
      .from('taxonomy')
      .select('depth1, depth2, depth3, depth4, depth1_en, depth2_en, depth3_en, depth4_en');
    if (error || !data) return map;
    for (const row of data) {
      for (const level of [1, 2, 3, 4]) {
        const ko = row[`depth${level}`];
        const en = row[`depth${level}_en`];
        if (!ko) continue;
        const canonical = norm(ko);
        map.set(canonical, canonical);
        if (en) map.set(norm(en), canonical);
      }
    }
    return map;
  });
}

const canon = (alias, value) => {
  const n = norm(value);
  return alias.get(n) ?? n;
};

function depthsOf(classification) {
  const c = classification || {};
  return [c.depth1, c.depth2, c.depth3, c.depth4];
}

/**
 * 프론트(useConsulting.buildScope)는 depth1이 없는 행을 '미분류'/'Unclassified'라는
 * **가상 카테고리**로 묶어 input에 넣는다. 그 이름이 그대로 nodePath로 되돌아오는데
 * taxonomy에는 그런 노드가 없다 — 예전엔 전부 0건이었고, 모델은 근거 없이
 * "미분류에서 정답률 0%"를 보고서 첫 문단에 썼다(실측 런 d2951b3a).
 * 프론트의 판정(useConsulting.runFallback)과 같은 규약으로 여기서도 되돌려 준다.
 */
const UNCLASSIFIED = new Set(['미분류', 'unclassified']);
const isUnclassifiedPath = (segments) => segments.length === 1 && UNCLASSIFIED.has(norm(segments[0]));

/** 라벨/생성문제 행이 nodePath 하위인가. 빈 경로는 전체 일치. */
function matchesPath(alias, classification, segments) {
  if (segments.length === 0) return true;
  const depths = depthsOf(classification);
  // 별칭표를 태우기 전에 가른다 — 정규형이 아니라 "depth1이 없다"가 매칭 조건이다.
  if (isUnclassifiedPath(segments)) return !depths[0] || UNCLASSIFIED.has(norm(depths[0]));
  if (segments.length > depths.length) return false;
  for (let i = 0; i < segments.length; i += 1) {
    if (!depths[i]) return false;
    if (canon(alias, depths[i]) !== canon(alias, segments[i])) return false;
  }
  return true;
}

/**
 * 채점 완료 행 전체(등록 + 생성)를 한 번만 모아 캐시한다.
 * 각 행: { isCorrect, classification, at, source, problemId }
 *   at = 등록 문제는 세션 생성일, 생성 문제는 제출/완료일 — 프론트 기간 필터와 같은 기준.
 */
async function loadUniverse(ctx) {
  return memo(ctx, 'universe', async () => {
    const db = ctx.db;
    const userId = ctx.userId;

    // (1) 등록 문제: sessions → problems → labels
    const { data: sessions, error: sErr } = await db
      .from('sessions').select('id, created_at').eq('user_id', userId);
    if (sErr) throw sErr;

    const sessionAt = new Map((sessions || []).map((s) => [s.id, s.created_at]));
    const sessionIds = [...sessionAt.keys()];

    const problems = [];
    for (let i = 0; i < sessionIds.length; i += ID_CHUNK) {
      const { data, error } = await db
        .from('problems').select('id, session_id').in('session_id', sessionIds.slice(i, i + ID_CHUNK));
      if (error) throw error;
      problems.push(...(data || []));
    }
    const problemSession = new Map(problems.map((p) => [p.id, p.session_id]));
    const problemIds = [...problemSession.keys()];

    const labeled = [];
    for (let i = 0; i < problemIds.length; i += ID_CHUNK) {
      const { data, error } = await db
        .from('labels').select('problem_id, classification, is_correct')
        .in('problem_id', problemIds.slice(i, i + ID_CHUNK));
      if (error) throw error;
      for (const row of data || []) {
        // 채점 계약: null은 집계에서 제외한다(오답으로 위조 금지)
        if (typeof row.is_correct !== 'boolean') continue;
        labeled.push({
          isCorrect: row.is_correct,
          classification: row.classification || {},
          at: sessionAt.get(problemSession.get(row.problem_id)) || null,
          source: 'registered',
          problemId: row.problem_id,
        });
      }
    }

    // (2) 생성 문제 풀이: 과제 응답 + 완료된 풀이 → generated_problems.classification
    const [aRes, sRes] = await Promise.all([
      db.from('assignment_responses').select('problem_id, is_correct, submitted_at').eq('student_id', userId),
      db.from('problem_solving_sessions').select('problem_id, is_correct, completed_at')
        .eq('user_id', userId).not('completed_at', 'is', null),
    ]);
    if (aRes.error) throw aRes.error;
    if (sRes.error) throw sRes.error;

    const genRaw = [];
    for (const r of aRes.data || []) {
      if (r.problem_id && typeof r.is_correct === 'boolean') {
        genRaw.push({ problemId: r.problem_id, isCorrect: r.is_correct, at: r.submitted_at });
      }
    }
    for (const r of sRes.data || []) {
      if (r.problem_id && typeof r.is_correct === 'boolean') {
        genRaw.push({ problemId: r.problem_id, isCorrect: r.is_correct, at: r.completed_at });
      }
    }

    const genIds = [...new Set(genRaw.map((r) => r.problemId))];
    const genClass = new Map();
    for (let i = 0; i < genIds.length; i += ID_CHUNK) {
      const { data, error } = await db
        .from('generated_problems').select('id, classification').in('id', genIds.slice(i, i + ID_CHUNK));
      if (error) throw error;
      for (const row of data || []) genClass.set(row.id, row.classification || {});
    }

    const generated = genRaw.map((r) => ({
      isCorrect: r.isCorrect,
      classification: genClass.get(r.problemId) || {},
      at: r.at,
      source: 'generated',
      problemId: r.problemId,
    }));

    return [...labeled, ...generated];
  });
}

const pct = (correct, total) => (total > 0 ? Math.round((correct / total) * 100) : null);

// ── 도구 ────────────────────────────────────────────────────────────

export const drilldownTool = defineTool({
  name: 'stats.drilldown',
  description:
    '특정 분류 노드의 정답률과 그 바로 아래 하위 분류별 정답률을 조회한다. '
    + '입력의 카테고리 요약에서 취약해 보이는 영역을 하나 골라, 실제로 어느 하위 유형이 문제인지 좁힐 때 쓴다. '
    + '미채점 문항은 집계에서 제외되므로 total은 "채점된 문항 수"다.',
  params: {
    nodePath: {
      type: 'string', required: true,
      description: "분류 경로. '>'로 구분한다. 예: '문법 > 시제' 또는 '독해'",
    },
  },
  handler: async ({ nodePath }, ctx) => {
    const [alias, universe] = await Promise.all([aliasMap(ctx), loadUniverse(ctx)]);
    const segments = splitPath(nodePath);
    if (segments.length === 0) return { error: 'nodePath가 비어 있습니다' };
    if (segments.length >= 4) {
      // depth4가 마지막이라 더 쪼갤 하위가 없다 — 집계만 돌려준다.
      segments.length = 4;
    }

    const rows = universe.filter((r) => matchesPath(alias, r.classification, segments));
    const total = rows.length;
    const correct = rows.filter((r) => r.isCorrect).length;

    // 하위 분류(다음 depth) 집계. 라벨은 저장된 원문 그대로 보여준다(정규형은 매칭용일 뿐).
    const childLevel = segments.length; // 0-based index of the next depth
    const children = new Map();
    if (childLevel < 4) {
      for (const row of rows) {
        const label = depthsOf(row.classification)[childLevel];
        if (!label) continue;
        const key = canon(alias, label);
        if (!children.has(key)) children.set(key, { label: String(label), total: 0, correct: 0 });
        const bucket = children.get(key);
        bucket.total += 1;
        if (row.isCorrect) bucket.correct += 1;
      }
    }

    return {
      nodePath: segments.join(' > '),
      total,
      correct,
      incorrect: total - correct,
      accuracy: pct(correct, total),
      children: [...children.values()]
        .map((c) => ({ ...c, incorrect: c.total - c.correct, accuracy: pct(c.correct, c.total) }))
        .sort((a, b) => b.total - a.total)
        .slice(0, 12),
    };
  },
});

export const wrongSamplesTool = defineTool({
  name: 'samples.wrong',
  description:
    '특정 분류 노드에 속한 오답 문항의 실제 내용(문제·선택지·학생답·정답·해설)을 표본으로 가져온다. '
    + '취약점의 원인을 문법·구조 패턴 수준에서 짚으려면 숫자가 아니라 이 원문이 필요하다. '
    + '한 번에 한 노드씩, 정말 파고들 노드에만 쓴다.',
  params: {
    nodePath: {
      type: 'string', required: true,
      description: "분류 경로. '>'로 구분. 예: '문법 > 시제 > 현재완료'",
    },
    limit: {
      type: 'integer', required: false, default: 8, min: 1, max: 15,
      description: '가져올 오답 표본 수',
    },
  },
  handler: async ({ nodePath, limit }, ctx) => {
    const alias = await aliasMap(ctx);
    const segments = splitPath(nodePath);
    if (segments.length === 0) return { error: 'nodePath가 비어 있습니다' };

    const db = ctx.db;
    const { data: sessions, error: sErr } = await db
      .from('sessions').select('id, created_at').eq('user_id', ctx.userId);
    if (sErr) throw sErr;
    const sessionIds = (sessions || []).map((s) => s.id);
    if (sessionIds.length === 0) return { nodePath: segments.join(' > '), samples: [], note: '분석된 시험지가 없습니다' };

    const problems = [];
    for (let i = 0; i < sessionIds.length; i += ID_CHUNK) {
      const { data, error } = await db
        .from('problems').select('id, content, problem_metadata').in('session_id', sessionIds.slice(i, i + ID_CHUNK));
      if (error) throw error;
      problems.push(...(data || []));
    }
    const problemMap = new Map(problems.map((p) => [p.id, p]));
    const problemIds = [...problemMap.keys()];

    const samples = [];
    for (let i = 0; i < problemIds.length && samples.length < limit; i += ID_CHUNK) {
      const { data, error } = await db
        .from('labels')
        .select('problem_id, classification, correct_answer, user_answer, is_correct')
        .in('problem_id', problemIds.slice(i, i + ID_CHUNK))
        .eq('is_correct', false);
      if (error) throw error;

      for (const row of data || []) {
        if (samples.length >= limit) break;
        if (!matchesPath(alias, row.classification, segments)) continue;
        const problem = problemMap.get(row.problem_id);
        const content = problem?.content || {};
        const meta = problem?.problem_metadata || {};
        const choices = Array.isArray(content.choices)
          ? content.choices.map((c) => String(typeof c === 'string' ? c : (c?.text ?? c?.label ?? '')).slice(0, 60)).filter(Boolean)
          : undefined;
        samples.push({
          stem: content.stem ? String(content.stem).slice(0, 220) : undefined,
          choices,
          user_answer: row.user_answer ?? null,
          correct_answer: row.correct_answer ?? null,
          problem_type: meta.problem_type ?? undefined,
          difficulty: meta.difficulty ?? undefined,
          analysis: meta.analysis ? String(meta.analysis).slice(0, 220) : undefined,
        });
      }
    }

    return {
      nodePath: segments.join(' > '),
      returned: samples.length,
      samples,
      ...(samples.length === 0 ? { note: '이 노드에는 오답 표본이 없습니다. 다른 노드를 보거나 결론으로 넘어가세요.' } : {}),
    };
  },
});

export const timeseriesTool = defineTool({
  name: 'stats.timeseries',
  description:
    '월별 정답률 추세를 조회한다. 같은 정답률이라도 나아지는 중인지 나빠지는 중인지에 따라 처방이 달라진다. '
    + 'nodePath를 비우면 전체 추세를 본다.',
  params: {
    nodePath: {
      type: 'string', required: false,
      description: "분류 경로('>' 구분). 생략하면 전체",
    },
    months: {
      type: 'integer', required: false, default: 6, min: 2, max: 12,
      description: '최근 몇 개월을 볼지',
    },
  },
  handler: async ({ nodePath, months }, ctx) => {
    const [alias, universe] = await Promise.all([aliasMap(ctx), loadUniverse(ctx)]);
    const segments = splitPath(nodePath);

    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - (months - 1));
    cutoff.setDate(1);
    cutoff.setHours(0, 0, 0, 0);

    const buckets = new Map();
    let undated = 0;
    for (const row of universe) {
      if (!matchesPath(alias, row.classification, segments)) continue;
      if (!row.at) { undated += 1; continue; }
      const date = new Date(row.at);
      if (Number.isNaN(date.getTime()) || date < cutoff) continue;
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      if (!buckets.has(key)) buckets.set(key, { month: key, total: 0, correct: 0 });
      const bucket = buckets.get(key);
      bucket.total += 1;
      if (row.isCorrect) bucket.correct += 1;
    }

    const series = [...buckets.values()]
      .sort((a, b) => a.month.localeCompare(b.month))
      .map((b) => ({ ...b, accuracy: pct(b.correct, b.total) }));

    return {
      nodePath: segments.length ? segments.join(' > ') : '전체',
      months,
      series,
      ...(undated ? { undatedExcluded: undated } : {}),
      ...(series.length === 0 ? { note: '해당 기간에 채점된 문항이 없습니다.' } : {}),
    };
  },
});

export const profileTool = defineTool({
  name: 'profile.get',
  description:
    '학생의 이름·나이·학년을 조회한다. 학습 루틴과 어투를 학년에 맞추려면 필요하다. '
    + '이름이 비어 있으면 절대 가짜 이름을 만들지 말고 "학생"으로 지칭한다.',
  params: {},
  handler: async (_args, ctx) => {
    const { data, error } = await ctx.db
      .from('profiles').select('name, age, grade').eq('user_id', ctx.userId).maybeSingle();
    if (error) throw error;
    const name = String(data?.name ?? '').trim();
    return {
      name: name || null,
      age: data?.age ? (parseInt(data.age, 10) || null) : null,
      grade: data?.grade || null,
      nameAvailable: !!name,
    };
  },
});

export const consultantTools = [drilldownTool, wrongSamplesTool, timeseriesTool, profileTool];
