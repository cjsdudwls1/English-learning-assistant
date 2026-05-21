/**
 * PR-C 부하 테스트 (Stagger 버전): 30명을 100-300ms 간격으로 발사
 * - 학원 실제 시나리오 시뮬레이션 (사람이 하나씩 일광)
 * - 코드 변경 없이 부하 패턴만 ramp-up으로 변경
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://vkoegxohahpptdyipmkr.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = process.env.SUPABASE_ANON_KEY || 'sb_publishable_y0ZeufG01WW57EWJs4GJUw_tFsr34qV';
const GCF_URL = process.env.GCF_URL || 'https://analyze-image-jg35qrg4wa-du.a.run.app';
if (!SERVICE_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY env var required');

const N_USERS = 30;
const PROBLEMS_PER_TYPE = 1;
const STAGGER_MIN_MS = 100;
const STAGGER_MAX_MS = 300;

const admin = createClient(SUPABASE_URL, SERVICE_KEY);
const anon = createClient(SUPABASE_URL, ANON_KEY);

const ts = () => new Date().toISOString().slice(11, 23);
const log = (tag, ...args) => console.log(`[${ts()}] [${tag}]`, ...args);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const randStagger = () => STAGGER_MIN_MS + Math.random() * (STAGGER_MAX_MS - STAGGER_MIN_MS);

function percentile(arr, p) {
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

async function createTestUser(idx) {
  const email = `loadtest-stagger-${Date.now()}-${idx}@example.com`;
  const password = 'TestPassword12345!';

  const { data: createData, error: e1 } = await admin.auth.admin.createUser({
    email, password, email_confirm: true,
  });
  if (e1) throw new Error(`createUser[${idx}]: ${e1.message}`);

  const { data: signIn, error: e2 } = await anon.auth.signInWithPassword({ email, password });
  if (e2) throw new Error(`signIn[${idx}]: ${e2.message}`);

  return { userId: createData.user.id, token: signIn.session.access_token };
}

async function callGCF(user, idx) {
  const start = Date.now();
  try {
    const resp = await fetch(GCF_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${user.token}` },
      body: JSON.stringify({
        mode: 'generate-all',
        types: [
          { problemType: 'ox', problemCount: PROBLEMS_PER_TYPE },
          { problemType: 'short_answer', problemCount: PROBLEMS_PER_TYPE },
        ],
        userId: user.userId,
        language: 'ko',
        classification: { depth1: '문법' },
      }),
    });
    const text = await resp.text();
    return { idx, status: resp.status, ok: resp.status === 200, elapsed: Date.now() - start, body: text.slice(0, 200) };
  } catch (err) {
    return { idx, status: 0, ok: false, elapsed: Date.now() - start, body: err.message };
  }
}

async function pollAllProblems(userIds, expectedPerUser, maxWaitMs) {
  const start = Date.now();
  const expectedTotal = userIds.length * expectedPerUser;
  while (Date.now() - start < maxWaitMs) {
    const { data, error } = await admin
      .from('generated_problems')
      .select('user_id, problem_type')
      .in('user_id', userIds);
    if (error) {
      log('POLL', 'error:', error.message);
      return { rows: [], total: 0, byUser: {} };
    }
    const byUser = data.reduce((acc, r) => { acc[r.user_id] = (acc[r.user_id] || 0) + 1; return acc; }, {});
    const completedUsers = Object.values(byUser).filter(n => n >= expectedPerUser).length;
    log('POLL', `${data.length}/${expectedTotal} 문제, ${completedUsers}/${userIds.length} user 완료 (${Math.round((Date.now() - start) / 1000)}s)`);
    if (data.length >= expectedTotal) return { rows: data, total: data.length, byUser };
    await sleep(5000);
  }
  const { data } = await admin
    .from('generated_problems')
    .select('user_id, problem_type')
    .in('user_id', userIds);
  const byUser = (data || []).reduce((acc, r) => { acc[r.user_id] = (acc[r.user_id] || 0) + 1; return acc; }, {});
  return { rows: data || [], total: (data || []).length, byUser };
}

async function main() {
  let users = [];

  try {
    log('SETUP', `${N_USERS}명 user 병렬 생성 시작...`);
    const setupStart = Date.now();
    const setupResults = await Promise.allSettled(
      Array.from({ length: N_USERS }, (_, i) => createTestUser(i))
    );
    users = setupResults.filter(r => r.status === 'fulfilled').map(r => r.value);
    log('SETUP', `${users.length}명 생성 완료 (${Date.now() - setupStart}ms)`);

    log('WARMUP', `5개 인스턴스 사전 warmup...`);
    await Promise.all(Array.from({ length: 5 }, () =>
      fetch(`${GCF_URL}?warmup=1`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).catch(() => null)
    ));
    await sleep(500);

    log('FIRE', `${users.length}개 GCF 호출 ${STAGGER_MIN_MS}-${STAGGER_MAX_MS}ms 간격 발사`);
    const fireStart = Date.now();
    const callPromises = [];
    for (let i = 0; i < users.length; i++) {
      callPromises.push(callGCF(users[i], i));
      if (i < users.length - 1) {
        await sleep(randStagger());
      }
    }
    const callResults = await Promise.all(callPromises);
    const fireElapsed = Date.now() - fireStart;
    log('FIRE', `모든 호출 응답 받음 (총 ${fireElapsed}ms)`);

    const successes = callResults.filter(r => r.ok);
    const failures = callResults.filter(r => !r.ok);
    const responseTimes = successes.map(r => r.elapsed);

    log('STATS', '─────── 호출 결과 ───────');
    log('STATS', `성공률: ${successes.length}/${users.length} (${(successes.length / users.length * 100).toFixed(1)}%)`);
    if (responseTimes.length > 0) {
      const avg = responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length;
      log('STATS', `응답: avg=${avg.toFixed(0)}ms, p50=${percentile(responseTimes, 50)}ms, p95=${percentile(responseTimes, 95)}ms, max=${Math.max(...responseTimes)}ms`);
    }
    if (failures.length > 0) {
      const byStatus = failures.reduce((acc, r) => { acc[r.status] = (acc[r.status] || 0) + 1; return acc; }, {});
      log('STATS', '실패:', byStatus, '예시:', failures[0].body);
    }

    if (successes.length === 0) throw new Error('모든 호출 실패');

    log('WAIT', `백그라운드 생성 대기 (최대 300초)...`);
    const expectedPerUser = 2;
    const succeededUserIds = successes.map(r => users[r.idx].userId);
    const pollResult = await pollAllProblems(succeededUserIds, expectedPerUser, 300_000);

    log('RESULT', '─────── 생성 결과 ───────');
    const fullyCompletedUsers = Object.values(pollResult.byUser).filter(n => n >= expectedPerUser).length;
    log('RESULT', `완성 user: ${fullyCompletedUsers}/${succeededUserIds.length}`);
    log('RESULT', `총 문제: ${pollResult.total}/${succeededUserIds.length * expectedPerUser}`);

    if (fullyCompletedUsers === succeededUserIds.length) {
      log('RESULT', '✅ Stagger 시나리오 무중단 검증 성공');
    } else if (fullyCompletedUsers >= succeededUserIds.length * 0.9) {
      log('RESULT', `⚠️ 90% 이상 (${fullyCompletedUsers}/${succeededUserIds.length})`);
    } else {
      log('RESULT', `❌ 완성률 ${(fullyCompletedUsers / succeededUserIds.length * 100).toFixed(1)}%`);
    }

  } catch (err) {
    log('ERROR', err.message);
    process.exitCode = 1;
  } finally {
    if (users.length > 0) {
      log('CLEANUP', `${users.length}명 user 삭제...`);
      const userIds = users.map(u => u.userId);
      try {
        await admin.from('generated_problems').delete().in('user_id', userIds);
        await admin.from('problem_generation_status').delete().in('user_id', userIds);
      } catch {}
      await Promise.allSettled(users.map(u => admin.auth.admin.deleteUser(u.userId)));
      log('CLEANUP', '완료');
    }
  }
}

main();
