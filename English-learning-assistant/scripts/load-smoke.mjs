// 경량 부하 스모크 — 통계 조회 경로(로그인 → /stats 데이터 로드) 재현.
//
// 프로덕션 Supabase를 대상으로 하므로 **읽기 전용** 쿼리만 실행한다 (쓰기/삭제 절대 금지).
// 재현 경로 (src/services/stats.ts fetchHierarchicalStats + utils/taxonomyMapping.ts):
//   signInWithPassword → taxonomy 전체 → sessions(user_id) → problems(session_id IN)
//   → labels(problem_id IN) → assignment_responses + problem_solving_sessions (병렬)
//
// 실행 (프론트 폴더에서):
//   $env:E2E_PASSWORD='<QA 비밀번호>'; node scripts/load-smoke.mjs
// 옵션 env: LOAD_VUS(기본 20), LOAD_ITERATIONS(기본 3), LOAD_EMAIL(기본 test111@test.com)
//
// 자격증명·키는 env/.env에서만 읽고 절대 출력하지 않는다.
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

// .env.local > .env 순으로 VITE_SUPABASE_* 로드 (값은 로그에 출력하지 않는다)
function loadEnv() {
  const vars = {};
  for (const f of ['.env', '.env.local']) {
    try {
      for (const line of readFileSync(path.join(ROOT, f), 'utf8').split(/\r?\n/)) {
        const m = line.match(/^\s*(VITE_SUPABASE_URL|VITE_SUPABASE_ANON_KEY)\s*=\s*(.+?)\s*$/);
        if (m) vars[m[1]] = m[2].replace(/^["']|["']$/g, '');
      }
    } catch { /* 파일 없으면 무시 */ }
  }
  return vars;
}

const env = loadEnv();
const SUPABASE_URL = process.env.VITE_SUPABASE_URL || env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY;
const EMAIL = process.env.LOAD_EMAIL || 'test111@test.com';
const PASSWORD = process.env.LOAD_PASSWORD || process.env.E2E_PASSWORD;
const VUS = Number(process.env.LOAD_VUS || 20);
const ITERATIONS = Number(process.env.LOAD_ITERATIONS || 3);
const ID_CHUNK = 500; // stats.ts와 동일

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY를 찾지 못했습니다 (.env 또는 env).');
  process.exit(1);
}
if (!PASSWORD) {
  console.error('E2E_PASSWORD(또는 LOAD_PASSWORD) 환경변수가 필요합니다.');
  process.exit(1);
}

function newClient() {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

const now = () => performance.now();

// step별 latency 샘플 수집기
const samples = {}; // step -> number[]
function record(step, ms) {
  (samples[step] ||= []).push(ms);
}
const errors = []; // { vu, iter, step, message }

async function timed(step, vu, iter, fn) {
  const t0 = now();
  try {
    const r = await fn();
    record(step, now() - t0);
    return r;
  } catch (e) {
    record(step, now() - t0);
    errors.push({ vu, iter, step, message: e?.message || String(e) });
    throw e;
  }
}

// /stats 1회 로드 재현 — 반환값은 행 수(리포트용)
async function statsPipeline(sb, userId, vu, iter) {
  const t0 = now();

  const { data: tax, error: te } = await timed('taxonomy', vu, iter, () =>
    sb.from('taxonomy').select('depth1, depth2, depth3, depth4, depth1_en, depth2_en, depth3_en, depth4_en'));
  if (te) throw te;

  const { data: sessions, error: se } = await timed('sessions', vu, iter, () =>
    sb.from('sessions').select('id, created_at').eq('user_id', userId));
  if (se) throw se;

  let problems = [];
  const sessionIds = (sessions || []).map((s) => s.id);
  await timed('problems', vu, iter, async () => {
    for (let i = 0; i < sessionIds.length; i += ID_CHUNK) {
      const { data, error } = await sb.from('problems').select('id, session_id')
        .in('session_id', sessionIds.slice(i, i + ID_CHUNK));
      if (error) throw error;
      problems.push(...(data || []));
    }
  });

  let labels = 0;
  const problemIds = problems.map((p) => p.id);
  await timed('labels', vu, iter, async () => {
    for (let i = 0; i < problemIds.length; i += ID_CHUNK) {
      const { data, error } = await sb.from('labels')
        .select('problem_id, classification, is_correct, user_mark')
        .in('problem_id', problemIds.slice(i, i + ID_CHUNK));
      if (error) throw error;
      labels += (data || []).length;
    }
  });

  const [aRes, sRes] = await timed('generated', vu, iter, () => Promise.all([
    sb.from('assignment_responses').select('problem_id, is_correct, submitted_at').eq('student_id', userId),
    sb.from('problem_solving_sessions').select('problem_id, is_correct, completed_at').eq('user_id', userId).not('completed_at', 'is', null),
  ]));
  if (aRes.error) throw aRes.error;
  if (sRes.error) throw sRes.error;

  record('pipeline_total', now() - t0);
  return {
    taxonomy: (tax || []).length,
    sessions: sessionIds.length,
    problems: problems.length,
    labels,
    generated: (aRes.data || []).length + (sRes.data || []).length,
  };
}

async function runVU(vu) {
  const sb = newClient();
  // 로그인 — rate limit(429) 시 2초 백오프 1회 재시도
  let userId;
  for (let attempt = 1; ; attempt++) {
    try {
      const { data, error } = await timed('login', vu, 0, () =>
        sb.auth.signInWithPassword({ email: EMAIL, password: PASSWORD }));
      if (error) throw error;
      userId = data.user.id;
      break;
    } catch (e) {
      if (attempt >= 2) return; // 에러는 timed에서 이미 집계됨
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  let rows;
  for (let iter = 1; iter <= ITERATIONS; iter++) {
    try {
      rows = await statsPipeline(sb, userId, vu, iter);
    } catch { /* 에러는 timed에서 집계, 다음 iteration 계속 */ }
  }
  return rows;
}

function pct(sorted, p) {
  if (sorted.length === 0) return NaN;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

function summarize(step) {
  const arr = (samples[step] || []).slice().sort((a, b) => a - b);
  if (arr.length === 0) return null;
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  return {
    n: arr.length,
    min: arr[0], mean, p50: pct(arr, 50), p95: pct(arr, 95), max: arr[arr.length - 1],
  };
}

const fmt = (ms) => `${Math.round(ms)}ms`;

async function main() {
  console.log(`부하 스모크 시작 — VU ${VUS} × iteration ${ITERATIONS} (읽기 전용, 계정 1개 공유)`);

  // 베이스라인: 무부하 순차 1회 (동시 실행과 비교 기준)
  console.log('\n[1/2] 베이스라인 (VU 1, 순차 1회)...');
  const baselineRows = await runVU(0);
  const baseline = summarize('pipeline_total');
  // 베이스라인 샘플은 본 측정과 섞이지 않도록 초기화
  for (const k of Object.keys(samples)) delete samples[k];
  errors.length = 0;

  console.log(`[2/2] 동시 부하 (VU ${VUS} 동시 시작)...`);
  const t0 = now();
  const results = await Promise.all(Array.from({ length: VUS }, (_, i) => runVU(i + 1)));
  const wallMs = now() - t0;

  const rows = results.find(Boolean) || baselineRows;
  const totalPipelines = (samples['pipeline_total'] || []).length;
  const attempted = VUS * ITERATIONS;

  console.log('\n===== 부하 스모크 리포트 =====');
  console.log(`대상 경로: 로그인 → /stats 데이터 로드 (fetchHierarchicalStats 재현)`);
  console.log(`데이터 규모(계정 ${EMAIL}): ${JSON.stringify(rows)}`);
  console.log(`베이스라인(무부하 1회): pipeline ${baseline ? fmt(baseline.p50) : 'N/A'}`);
  console.log(`동시 실행 벽시계: ${fmt(wallMs)} (VU ${VUS}, 파이프라인 완주 ${totalPipelines}/${attempted})`);
  console.log(`에러: ${errors.length}건 (에러율 ${(errors.length / (attempted + VUS) * 100).toFixed(1)}%)`);
  for (const e of errors.slice(0, 10)) console.log(`  - VU${e.vu} iter${e.iter} [${e.step}] ${e.message}`);

  console.log('\n단계별 latency (동시 부하):');
  const stepOrder = ['login', 'taxonomy', 'sessions', 'problems', 'labels', 'generated', 'pipeline_total'];
  for (const step of stepOrder) {
    const s = summarize(step);
    if (!s) continue;
    console.log(`  ${step.padEnd(15)} n=${String(s.n).padStart(3)}  p50=${fmt(s.p50).padStart(7)}  p95=${fmt(s.p95).padStart(7)}  max=${fmt(s.max).padStart(7)}`);
  }

  // 실패 판정: 에러율 5% 초과 또는 파이프라인 p95가 10초 초과면 비정상
  const total = summarize('pipeline_total');
  const errRate = errors.length / (attempted + VUS);
  const failed = errRate > 0.05 || (total && total.p95 > 10_000);
  console.log(`\n판정: ${failed ? 'FAIL' : 'PASS'} (기준: 에러율 ≤5%, pipeline p95 ≤10s)`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error('치명적 오류:', e?.message || e);
  process.exit(1);
});
