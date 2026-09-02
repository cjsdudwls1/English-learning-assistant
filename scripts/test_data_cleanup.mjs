/**
 * test_data_cleanup.mjs — 테스트가 남긴 잔여 데이터 정리
 *
 * ┌ 왜 REST 가 아니라 Management API 인가 ─────────────────────────────────────
 * │ 2026-09-01 현재 프로젝트가 송신 한도 초과로 402(restricted)다. 이 상태에서는
 * │ 프로젝트 게이트웨이가 통째로 막혀 /rest/v1(PostgREST)도 Storage 도 응답하지
 * │ 않는다 — 서비스 롤 키가 있어도 조회조차 안 된다. 실측:
 * │   GET /rest/v1/shared_assignments → 402
 * │   {"message":"Service for this project is restricted ... exceed_egress_quota"}
 * │
 * │ 반면 api.supabase.com 은 플랫폼 경로라 제한과 무관하게 동작한다.
 * │ scripts/demo_cleanup.mjs 가 쓰는 것과 같은 엔드포인트·같은 규약이다.
 * └───────────────────────────────────────────────────────────────────────────
 *
 * 실행:
 *   조회만(기본):  node scripts/test_data_cleanup.mjs
 *   실제 삭제:     node scripts/test_data_cleanup.mjs --apply
 *   SQL 만 출력:   node scripts/test_data_cleanup.mjs --sql
 *
 * PAT: 환경변수 SUPABASE_PAT, 없으면 English-learning-assistant/.env.local 의
 *      SUPABASE_PAT= 줄에서 읽는다(.env.local 은 gitignore 대상이다).
 *      값은 어떤 경로로도 출력하지 않는다.
 *      발급: Dashboard → Account → Access Tokens.
 *
 * 자격증명을 아예 안 쓰고 싶으면 `--sql` 로 뽑아 Dashboard → SQL Editor 에 붙여 넣는다.
 * SQL Editor 도 플랫폼 경로라 402 와 무관하게 동작한다.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const PROJECT_REF = 'vkoegxohahpptdyipmkr';
const ENDPOINT = `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`;
const APPLY = process.argv.includes('--apply');
const SQL_ONLY = process.argv.includes('--sql');

/**
 * 지울 shared_assignments. UUID 앞 8자리로 적는다 — 화면·로그에 그 형태로 남기 때문이다.
 * 여기 없는 것은 절대 지워지지 않는다. 건수가 안 맞으면 트랜잭션째 중단된다.
 */
const TARGET_PREFIXES = ['08aff2c0', '6cd230e5', 'b79e4b3a', '038c6cc9'];

/** 실계정 보호 — 조회 결과에서 눈에 띄게 표시한다(삭제 대상 판별용). */
const PROTECTED_EMAILS = ['cjsdudwls1357@gmail.com'];

// ── SQL ──────────────────────────────────────────────────────────────────────

/** 공유 과제 전수 + 자식 건수. 삭제 판단의 1차 근거다. */
const Q_ASSIGNMENTS = `
SELECT
  left(sa.id::text, 8) AS id8,
  sa.title,
  to_char(sa.created_at, 'YYYY-MM-DD HH24:MI') AS created_at,
  u.email AS owner_email,
  c.name  AS class_name,
  (SELECT count(*) FROM public.assignment_problems  ap WHERE ap.assignment_id = sa.id) AS problems,
  (SELECT count(*) FROM public.assignment_targets   tg WHERE tg.assignment_id = sa.id) AS targets,
  (SELECT count(*) FROM public.assignment_responses rs WHERE rs.assignment_id = sa.id) AS responses
FROM public.shared_assignments sa
LEFT JOIN auth.users     u ON u.id = sa.created_by
LEFT JOIN public.classes c ON c.id = sa.class_id
ORDER BY sa.created_at;`;

/**
 * 보존 대상 확인 — 이미지 분석 세션.
 * 삭제는 shared_assignments 만 건드리고 sessions 와는 FK 로 이어져 있지도 않지만,
 * "안 지워진다"를 주장 대신 출력으로 확인해 둔다.
 */
const Q_SESSIONS = `
SELECT
  left(s.id::text, 8) AS id8,
  to_char(s.created_at, 'YYYY-MM-DD HH24:MI') AS created_at,
  u.email AS owner_email,
  (SELECT count(*) FROM public.problems p WHERE p.session_id = s.id) AS problems
FROM public.sessions s
LEFT JOIN auth.users u ON u.id = s.user_id
ORDER BY s.created_at DESC;`;

/** 계정별 잔여량. @test.com = E2E/수동 테스트 계정. */
const Q_BY_ACCOUNT = `
SELECT
  u.email,
  p.role,
  (SELECT count(*) FROM public.sessions             s   WHERE s.user_id     = u.id) AS sessions,
  (SELECT count(*) FROM public.shared_assignments   sa  WHERE sa.created_by = u.id) AS assignments,
  (SELECT count(*) FROM public.assignment_responses rs  WHERE rs.student_id = u.id) AS responses,
  (SELECT count(*) FROM public.generated_problems   gp  WHERE gp.user_id    = u.id) AS generated,
  (SELECT count(*) FROM public.agent_runs           ag  WHERE ag.user_id    = u.id) AS agent_runs
FROM auth.users u
LEFT JOIN public.profiles p ON p.user_id = u.id
ORDER BY (u.email LIKE '%@test.com') DESC, u.email;`;

/**
 * 스토리지 실사용량. 402 를 부른 송신량의 출처를 확인하는 자리다.
 * 다만 여기서 지우지는 않는다 — 이유는 파일 맨 아래 주석 참고.
 */
const Q_STORAGE = `
SELECT
  bucket_id,
  count(*) AS objects,
  count(*) FILTER (WHERE name LIKE '%/thumb/%') AS thumbs,
  pg_size_pretty(sum((metadata->>'size')::bigint)) AS total_size
FROM storage.objects
GROUP BY bucket_id
ORDER BY bucket_id;`;

/**
 * 삭제. 자식 3종은 전부
 *   assignment_id UUID NOT NULL REFERENCES shared_assignments(id) ON DELETE CASCADE
 * 로 선언돼 있어(20260328000000_add_roles_classes_assignments.sql) 같이 사라진다.
 * 따로 DELETE 를 쓰면 순서만 복잡해지고 얻는 게 없다.
 *   assignment_problems  → 과제-문제 연결 행만. generated_problems 원본은 남는다.
 *   assignment_targets   → 배정 정보
 *   assignment_responses → 학생 응답
 *
 * 건수 검증을 트랜잭션 안에 둔 이유: 접두어를 잘못 써서 엉뚱한 행이 걸려도
 * RAISE EXCEPTION 이 전체를 되돌려 아무것도 지워지지 않게 하기 위해서다.
 */
function deletionSql(prefixes) {
  const arr = prefixes.map((p) => `'${p.replace(/'/g, "''")}%'`).join(', ');
  return `
BEGIN;

CREATE TEMP TABLE _targets ON COMMIT DROP AS
SELECT sa.id, sa.title, sa.created_at
FROM public.shared_assignments sa
WHERE sa.id::text LIKE ANY (ARRAY[${arr}]);

DO $$
DECLARE
  expected CONSTANT int := ${prefixes.length};
  actual   int;
BEGIN
  SELECT count(*) INTO actual FROM _targets;
  IF actual <> expected THEN
    RAISE EXCEPTION '대상이 %건이어야 하는데 %건 걸렸다 — 아무것도 지우지 않고 중단한다', expected, actual;
  END IF;
END $$;

CREATE TEMP TABLE _deleted ON COMMIT DROP AS
WITH d AS (
  DELETE FROM public.shared_assignments
  WHERE id IN (SELECT id FROM _targets)
  RETURNING id, title, created_at
)
SELECT * FROM d;

SELECT
  left(d.id::text, 8) AS deleted_id8,
  d.title,
  to_char(d.created_at, 'YYYY-MM-DD HH24:MI') AS created_at,
  (SELECT count(*) FROM public.shared_assignments) AS remaining_assignments
FROM _deleted d
ORDER BY d.created_at;

COMMIT;`;
}

// ── --sql: 자격증명 없이 SQL 만 출력 ─────────────────────────────────────────
if (SQL_ONLY) {
  const blocks = [
    ['STEP 1-A  공유 과제 전수', Q_ASSIGNMENTS],
    ['STEP 1-B  보존 대상(이미지 분석 세션)', Q_SESSIONS],
    ['STEP 1-C  계정별 잔여량', Q_BY_ACCOUNT],
    ['STEP 1-D  스토리지 사용량', Q_STORAGE],
    [`STEP 2    삭제 (${TARGET_PREFIXES.length}건) — 1 을 확인한 뒤에만`, deletionSql(TARGET_PREFIXES)],
  ];
  console.log('-- Dashboard → SQL Editor 에 붙여 넣는다.');
  console.log('-- SQL Editor 는 마지막 문장의 결과만 보여주므로 STEP 1 은 하나씩 드래그해서 Run 한다.');
  console.log('-- STEP 2 는 트랜잭션이라 블록 전체를 한 번에 Run 해야 한다.');
  for (const [title, sql] of blocks) {
    console.log(`\n\n-- ════════ ${title} ════════${sql}`);
  }
  process.exit(0);
}

// ── PAT ──────────────────────────────────────────────────────────────────────
function findPat() {
  if (process.env.SUPABASE_PAT) return process.env.SUPABASE_PAT;
  const envLocal = join(dirname(fileURLToPath(import.meta.url)), '..', 'English-learning-assistant', '.env.local');
  try {
    const m = readFileSync(envLocal, 'utf8').match(/^SUPABASE_PAT=(.+)$/m);
    if (m) return m[1].trim().replace(/^["']|["']$/g, '');
  } catch { /* 없으면 아래에서 안내 */ }
  return null;
}

const PAT = findPat();
if (!PAT) {
  console.error('SUPABASE_PAT 이 없다. 둘 중 하나로 넣는다:');
  console.error('  1) English-learning-assistant/.env.local 에  SUPABASE_PAT=sbp_...  한 줄 추가 (gitignore 대상)');
  console.error('  2) 환경변수로 주입');
  console.error('자격증명 없이 하려면: node scripts/test_data_cleanup.mjs --sql  → SQL Editor 에 붙여 넣기');
  process.exit(1);
}

async function runQuery(sql) {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${PAT}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 400)}`);
  return JSON.parse(text);
}

// 한 섹션이 스키마 불일치로 실패해도 나머지는 진행한다.
async function section(title, fn) {
  console.log(`\n──────── ${title} ────────`);
  try {
    await fn();
  } catch (e) {
    console.error(`  ⚠ 실패: ${e.message}`);
  }
}

// ── main ─────────────────────────────────────────────────────────────────────
console.log('╔════════════════════════════════════════════════╗');
console.log(`║  test_data_cleanup — MODE: ${APPLY ? 'APPLY (실제 삭제)' : 'DRY-RUN (조회만)'}`);
console.log(`║  project: ${PROJECT_REF}`);
console.log(`║  삭제 후보: ${TARGET_PREFIXES.join(', ')}`);
console.log('╚════════════════════════════════════════════════╝');

await section('공유 과제 전수 (삭제 후보 ← 표시)', async () => {
  const rows = await runQuery(Q_ASSIGNMENTS);
  const marked = rows.map((r) => ({
    ...r,
    삭제대상: TARGET_PREFIXES.includes(r.id8) ? '←' : '',
    보호계정: PROTECTED_EMAILS.includes(r.owner_email) ? '★' : '',
  }));
  console.table(marked);

  const found = rows.filter((r) => TARGET_PREFIXES.includes(r.id8)).map((r) => r.id8);
  const missing = TARGET_PREFIXES.filter((p) => !found.includes(p));
  console.log(`  후보 ${TARGET_PREFIXES.length}건 중 실제 존재: ${found.length}건`);
  if (missing.length) console.log(`  ⚠ 없는 후보(이미 지워졌거나 id 오기): ${missing.join(', ')}`);
  const protectedHit = rows.filter((r) => TARGET_PREFIXES.includes(r.id8) && PROTECTED_EMAILS.includes(r.owner_email));
  if (protectedHit.length) console.log(`  ⚠ 보호 계정 소유 과제가 삭제 후보에 있다 — 확인 필요: ${protectedHit.map((r) => r.id8).join(', ')}`);
});

await section('보존 대상 — 이미지 분석 세션 (삭제와 무관)', async () => {
  console.table(await runQuery(Q_SESSIONS));
});

await section('계정별 잔여량', async () => {
  console.table(await runQuery(Q_BY_ACCOUNT));
});

await section('스토리지 사용량 (이 스크립트는 스토리지를 지우지 않는다)', async () => {
  console.table(await runQuery(Q_STORAGE));
});

if (APPLY) {
  await section('삭제 실행', async () => {
    const rows = await runQuery(deletionSql(TARGET_PREFIXES));
    console.log('  ✔ 삭제됨:');
    console.table(rows);
  });
} else {
  console.log('\nDRY-RUN 종료 — 변경 없음. 위 출력을 확인한 뒤 --apply 로 실행한다.');
}

/*
 * 스토리지를 여기서 지우지 않는 이유
 *
 * storage.objects 는 실제 파일의 메타데이터 행일 뿐이다. SQL 로 DELETE 하면 행만
 * 사라지고 S3 쪽 파일은 남아, 어디서도 참조되지 않는 채 용량만 차지한다. 지울 거면
 * Storage API(supabase.storage.from(...).remove([...])) 나 대시보드 Storage 화면으로
 * 지워야 파일까지 함께 사라진다 — 그런데 그 경로는 지금 402 로 막혀 있다.
 *
 * 그리고 지워도 402 는 안 풀린다. 한도를 넘긴 것은 저장량(455MB)이 아니라
 * 송신량(5.6GB)이고, 이미 쓴 값이라 파일을 지운다고 되돌아오지 않는다.
 * 한도는 리셋(2026-09-03) 또는 플랜 변경으로만 풀린다.
 */
