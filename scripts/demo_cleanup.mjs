/**
 * demo_cleanup.mjs — 시연 전 데모 데이터 정리 (I-1~I-4)
 *
 * 공유 DB이므로 기본은 DRY-RUN(조회만, 변경 0). 실제 반영은 --apply 플래그로만.
 * 실계정(천영진/gmail)은 절대 건드리지 않는다 — 변경은 (a) [E2E] 제목 접두어,
 * (b) 아래 FIXES에 사용자가 명시한 id로만 범위가 잡힌다.
 *
 * 실행:
 *   dry-run:  SUPABASE_PAT=sbp_xxx node demo_cleanup.mjs
 *   apply:    SUPABASE_PAT=sbp_xxx node demo_cleanup.mjs --apply
 *
 * PAT는 파일에 하드코딩하지 않는다(README 권장). Supabase Dashboard → Account → Access Tokens.
 * 규약은 edu/scripts/*.js(Management API)와 동일하나 PAT를 env로 받는다.
 */

const PROJECT_REF = 'vkoegxohahpptdyipmkr';
const ENDPOINT = `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`;
const PAT = process.env.SUPABASE_PAT;
const APPLY = process.argv.includes('--apply');

// 실계정 보호: 이 이메일(들)은 어떤 변경 대상에서도 제외
const PROTECTED_EMAILS = ['cjsdudwls1357@gmail.com'];

/* ─────────────────────────────────────────────────────────────
 * 사용자 입력 필요(dry-run 출력 보고 채운 뒤 --apply):
 *   - I-1: 손상 학원명 → 정상명.   { '<academy_id>': '정상 학원명' }
 *   - I-3: 이름 null 프로필 → 이름. { '<user_id>':   '학생 이름'   }
 * 비어 있으면 해당 UPDATE는 건너뛴다(경고만).
 * ───────────────────────────────────────────────────────────── */
const FIXES = {
  academyNames: {
    // '00000000-0000-0000-0000-000000000000': '천영진 영어학원',
  },
  profileNames: {
    // '00000000-0000-0000-0000-000000000000': '홍길동',
  },
};

// ── helpers ──────────────────────────────────────────────────
if (!PAT) {
  console.error('환경변수 SUPABASE_PAT 가 없습니다. 예: SUPABASE_PAT=sbp_xxx node demo_cleanup.mjs');
  process.exit(1);
}
const lit = (v) => (v === null || v === undefined ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`);

async function runQuery(sql) {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${PAT}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 400)}`);
  return res.json();
}

// 섹션 단위 실행 — 한 섹션이 스키마 불일치로 실패해도 나머지는 진행
async function section(title, fn) {
  console.log(`\n──────── ${title} ────────`);
  try {
    await fn();
  } catch (e) {
    console.error(`  ⚠ 섹션 실패(스키마 확인 필요): ${e.message}`);
  }
}

const notProtected = `u.email NOT IN (${PROTECTED_EMAILS.map(lit).join(', ')})`;

// ── main ─────────────────────────────────────────────────────
console.log(`\n╔═══════════════════════════════════════════════╗`);
console.log(`║  demo_cleanup  —  MODE: ${APPLY ? 'APPLY (실제 반영)' : 'DRY-RUN (조회만)'}`);
console.log(`║  project: ${PROJECT_REF}`);
console.log(`║  보호 계정: ${PROTECTED_EMAILS.join(', ')}`);
console.log(`╚═══════════════════════════════════════════════╝`);
if (!APPLY) console.log('※ 변경 없음. 반영하려면 --apply. 반드시 아래 출력을 먼저 검토하세요.');

// I-1 · 손상 학원명 ------------------------------------------------
await section('I-1  손상 학원명', async () => {
  const rows = await runQuery(`
    SELECT id, name, encode(convert_to(name,'UTF8'),'hex') AS name_hex
    FROM public.academies
    WHERE name LIKE '%?%' OR name LIKE '%' || chr(65533) || '%'
    ORDER BY name;`);
  if (!rows.length) { console.log('  손상 의심 학원 없음.'); }
  else { console.log(`  손상 의심 ${rows.length}건 (name_hex로 확인):`); console.table(rows); }

  const ids = Object.keys(FIXES.academyNames);
  if (!ids.length) { console.log('  → 정상명 매핑(FIXES.academyNames) 미입력 — UPDATE 건너뜀.'); return; }
  for (const id of ids) {
    const name = FIXES.academyNames[id];
    if (APPLY) {
      await runQuery(`UPDATE public.academies SET name=${lit(name)} WHERE id=${lit(id)};`);
      console.log(`  ✔ UPDATE academies ${id} → ${name}`);
    } else {
      console.log(`  [dry] UPDATE academies SET name=${lit(name)} WHERE id=${lit(id)};`);
    }
  }
});

// I-2 · [E2E] 테스트 오염 과제 ------------------------------------
await section('I-2  [E2E] 오염 과제', async () => {
  const cnt = await runQuery(`
    SELECT
      (SELECT count(*) FROM public.shared_assignments WHERE title LIKE '[E2E]%') AS e2e_assignments,
      (SELECT count(*) FROM public.assignment_responses r
         WHERE r.assignment_id IN (SELECT id FROM public.shared_assignments WHERE title LIKE '[E2E]%')) AS e2e_responses;`);
  console.table(cnt);

  // shared_assignments 를 참조하는 모든 자식 테이블(삭제 순서 검증용)
  const fks = await runQuery(`
    SELECT tc.table_name AS child_table, kcu.column_name AS child_col
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu ON kcu.constraint_name = tc.constraint_name
    JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name
    WHERE tc.constraint_type='FOREIGN KEY' AND ccu.table_name='shared_assignments';`);
  console.log('  shared_assignments 참조 자식 테이블:');
  console.table(fks);
  const extra = fks.filter((f) => f.child_table !== 'assignment_responses');
  if (extra.length) console.log(`  ⚠ assignment_responses 외 자식 존재 — 아래 삭제 전 수동 확인 필요: ${extra.map((e) => e.child_table).join(', ')}`);

  if (APPLY) {
    const d1 = await runQuery(`
      DELETE FROM public.assignment_responses
      WHERE assignment_id IN (SELECT id FROM public.shared_assignments WHERE title LIKE '[E2E]%');`);
    console.log('  ✔ DELETE assignment_responses (E2E)'); console.log('   ', JSON.stringify(d1));
    const d2 = await runQuery(`DELETE FROM public.shared_assignments WHERE title LIKE '[E2E]%';`);
    console.log('  ✔ DELETE shared_assignments (E2E)'); console.log('   ', JSON.stringify(d2));
  } else {
    console.log('  [dry] DELETE assignment_responses WHERE assignment_id IN (E2E 과제) → 그다음 shared_assignments (FK 순서 준수).');
  }
});

// I-3 · 이름 null 프로필 ------------------------------------------
await section('I-3  이름 null 프로필', async () => {
  const rows = await runQuery(`
    SELECT p.user_id, u.email, p.role
    FROM public.profiles p
    JOIN auth.users u ON u.id = p.user_id
    WHERE (p.name IS NULL OR btrim(p.name) = '') AND ${notProtected}
    ORDER BY p.role, u.email;`);
  if (!rows.length) { console.log('  이름 null 프로필 없음.'); }
  else { console.log(`  이름 null ${rows.length}건 (user_id를 FIXES.profileNames 키로 사용):`); console.table(rows); }

  const ids = Object.keys(FIXES.profileNames);
  if (!ids.length) { console.log('  → 이름 매핑(FIXES.profileNames) 미입력 — UPDATE 건너뜀.'); return; }
  for (const id of ids) {
    const name = FIXES.profileNames[id];
    if (APPLY) {
      await runQuery(`UPDATE public.profiles SET name=${lit(name)} WHERE user_id=${lit(id)};`);
      console.log(`  ✔ UPDATE profiles ${id} → ${name}`);
    } else {
      console.log(`  [dry] UPDATE profiles SET name=${lit(name)} WHERE user_id=${lit(id)};`);
    }
  }
});

// I-4 · 비현실적 정답률(≤5%) — 보고만, 위조 안 함 --------------------
await section('I-4  낮은 정답률 (보고 전용)', async () => {
  const rows = await runQuery(`
    SELECT r.student_id, u.email,
           count(*) FILTER (WHERE r.is_correct) AS correct,
           count(*) AS total,
           round(100.0 * count(*) FILTER (WHERE r.is_correct) / nullif(count(*),0), 1) AS rate
    FROM public.assignment_responses r
    JOIN auth.users u ON u.id = r.student_id
    WHERE r.is_correct IS NOT NULL
    GROUP BY r.student_id, u.email
    HAVING count(*) >= 20
       AND round(100.0 * count(*) FILTER (WHERE r.is_correct) / nullif(count(*),0), 1) <= 5
    ORDER BY rate;`);
  if (!rows.length) { console.log('  ≤5% 저정답률 학생 없음.'); }
  else {
    console.log(`  비현실적 저정답률 ${rows.length}명:`); console.table(rows);
    console.log('  → 권장: 데이터 위조 대신 현실적 데모 학원 신규 시드. 이 스크립트는 정답률을 변경하지 않음.');
  }
});

console.log(`\n완료. ${APPLY ? '반영됨(APPLY).' : 'DRY-RUN 종료 — 변경 없음.'}`);
