/**
 * E2E 잔여물(`[E2E] …` 과제) 정리.
 *
 * 왜 필요한가: assignment-flow.spec.ts는 serial 모드라 앞 test가 실패하면 삭제 test까지
 * 도달하지 못했다. afterAll 정리를 붙여 재발은 막았지만(같은 파일 주석 참조), 그 전에 쌓인
 * 잔여물은 남는다 — 2026-08-26 실측 13개 실행분, 응답 36건 전부 오답. 이게 학생 통계와
 * 학습 컨설턴트에 그대로 섞였다.
 *
 * 동작: **원본을 먼저 JSON으로 덤프한 뒤** shared_assignments만 지운다
 * (assignment_problems/targets/responses는 FK ON DELETE CASCADE로 따라 지워진다).
 * 지우는 id는 스캔 시점에 고정한다 — 삭제 도중 새 E2E 런이 만든 과제를 휩쓸지 않기 위해서다.
 *
 *   node scripts/clean-e2e-residue.mjs           # 덤프만 (기본값)
 *   node scripts/clean-e2e-residue.mjs --apply   # 실제 삭제
 *
 * `.env`(VITE_SUPABASE_URL) + `.env.local`(SUPABASE_SERVICE_ROLE_KEY)에서 자격증명을 읽는다.
 * 두 파일 모두 커밋 대상이 아니다.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createClient } from '@supabase/supabase-js';

const APPLY = process.argv.includes('--apply');
// 덤프 위치. 기본은 리포 안 .e2e-backup/(gitignore됨) — 커밋되지 않게 한다.
const BACKUP_DIR = process.env.E2E_BACKUP_DIR || resolve(process.cwd(), '.e2e-backup');

const env = {};
for (const f of ['.env', '.env.local']) {
  try {
    for (const line of readFileSync(f, 'utf-8').split(/\r?\n/)) {
      const m = /^([A-Z_]+)=(.*)$/.exec(line.trim());
      if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch {}
}
const db = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const must = async (q) => {
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
};

// 1) 대상 고정
const asg = await must(
  db.from('shared_assignments').select('*').like('title', '[E2E]%').order('created_at'),
);
const ids = asg.map((a) => a.id);
if (ids.length === 0) {
  console.log('대상 없음.');
  process.exit(0);
}

const [problems, targets, responses] = await Promise.all([
  must(db.from('assignment_problems').select('*').in('assignment_id', ids)),
  must(db.from('assignment_targets').select('*').in('assignment_id', ids)),
  must(db.from('assignment_responses').select('*').in('assignment_id', ids)),
]);

// 2) 덤프 (지우기 전에 반드시)
mkdirSync(BACKUP_DIR, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const path = join(BACKUP_DIR, `e2e-cleanup-${stamp}.json`);
writeFileSync(
  path,
  JSON.stringify({ takenAt: new Date().toISOString(), shared_assignments: asg, assignment_problems: problems, assignment_targets: targets, assignment_responses: responses }, null, 2),
  'utf-8',
);
console.log('백업:', path);
console.log(`대상 shared_assignments ${asg.length} / problems ${problems.length} / targets ${targets.length} / responses ${responses.length}`);

// 3) 안전장치: 이 과제들에 붙은 응답이 전부 E2E 학생 것인지 확인
const students = [...new Set(responses.map((r) => r.student_id))];
const profs = students.length
  ? await must(db.from('profiles').select('user_id, email').in('user_id', students))
  : [];
const bad = profs.filter((p) => !String(p.email || '').endsWith('@test.com'));
if (bad.length) {
  console.error('중단: @test.com이 아닌 계정의 응답이 섞여 있다 →', bad.map((p) => p.email));
  process.exit(1);
}
console.log('응답 소유자:', profs.map((p) => p.email).join(', ') || '(없음)');

if (!APPLY) {
  console.log('\n--apply 없음 → 덤프만 하고 종료.');
  process.exit(0);
}

// 4) 삭제
const { error } = await db.from('shared_assignments').delete().in('id', ids);
if (error) throw error;

// 5) 사후 확인
const [leftA, leftR] = await Promise.all([
  must(db.from('shared_assignments').select('id').in('id', ids)),
  must(db.from('assignment_responses').select('id').in('assignment_id', ids)),
]);
console.log(`\n삭제 후 남은 과제 ${leftA.length}건, 남은 응답 ${leftR.length}건 (둘 다 0이어야 정상)`);
