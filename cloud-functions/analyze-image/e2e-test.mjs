/**
 * PR-E end-to-end 통합 테스트
 * - 임시 user 생성 → sign-in → GCF 호출 → DB 확인 → cleanup
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://vkoegxohahpptdyipmkr.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = process.env.SUPABASE_ANON_KEY || 'sb_publishable_y0ZeufG01WW57EWJs4GJUw_tFsr34qV';
const GCF_URL = process.env.GCF_URL || 'https://analyze-image-jg35qrg4wa-du.a.run.app';
if (!SERVICE_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY env var required');

const admin = createClient(SUPABASE_URL, SERVICE_KEY);
const anon = createClient(SUPABASE_URL, ANON_KEY);

function log(tag, ...args) {
  console.log(`[${new Date().toISOString()}] [${tag}]`, ...args);
}

async function pollProblems(userId, expectedCount, maxWaitMs = 120_000) {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const { data, error } = await admin
      .from('generated_problems')
      .select('id, problem_type, stem, correct_answer, explanation')
      .eq('user_id', userId);
    if (error) {
      log('POLL', 'error:', error.message);
      return [];
    }
    log('POLL', `${data.length}/${expectedCount} (${Math.round((Date.now() - start) / 1000)}s)`);
    if (data.length >= expectedCount) return data;
    await new Promise(r => setTimeout(r, 3000));
  }
  const { data } = await admin
    .from('generated_problems')
    .select('id, problem_type, stem, correct_answer, explanation')
    .eq('user_id', userId);
  return data || [];
}

async function main() {
  const email = `e2e-test-${Date.now()}@example.com`;
  const password = 'TestPassword12345!';
  let userId;

  try {
    log('SETUP', `테스트 user 생성: ${email}`);
    const { data: createData, error: e1 } = await admin.auth.admin.createUser({
      email, password, email_confirm: true,
    });
    if (e1) throw new Error('createUser: ' + e1.message);
    userId = createData.user.id;
    log('SETUP', `user_id=${userId}`);

    log('SETUP', 'sign-in 시도...');
    const { data: signIn, error: e2 } = await anon.auth.signInWithPassword({ email, password });
    if (e2) throw new Error('signIn: ' + e2.message);
    const token = signIn.session.access_token;
    log('SETUP', `토큰 발급 완료 (${token.length}자)`);

    const expected = [
      { problemType: 'ox', problemCount: 2 },
      { problemType: 'short_answer', problemCount: 2 },
    ];
    const expectedTotal = expected.reduce((s, t) => s + t.problemCount, 0);

    log('CALL', `GCF 호출: types=${expected.map(t => t.problemType).join(',')} count=${expectedTotal}`);
    const callStart = Date.now();
    const resp = await fetch(GCF_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({
        mode: 'generate-all',
        types: expected,
        userId,
        language: 'ko',
        classification: { depth1: '문법' },
      }),
    });
    const respText = await resp.text();
    const responseTimeMs = Date.now() - callStart;
    log('CALL', `응답: HTTP ${resp.status} (${responseTimeMs}ms)`);
    log('CALL', 'body:', respText);

    if (resp.status !== 200) {
      throw new Error(`GCF 호출 실패: ${resp.status} ${respText}`);
    }
    const result = JSON.parse(respText);
    if (!result.success || !result.sessionId) {
      throw new Error(`예상치 못한 응답: ${respText}`);
    }
    if (responseTimeMs > 5000) {
      log('WARN', `fire-and-forget이 5초 초과: ${responseTimeMs}ms (백그라운드 실행 의심)`);
    } else {
      log('CALL', `✅ fire-and-forget 정상 (${responseTimeMs}ms)`);
    }

    log('WAIT', `백그라운드 생성 대기 (최대 120초)...`);
    const problems = await pollProblems(userId, expectedTotal, 120_000);

    log('RESULT', `문제 ${problems.length}/${expectedTotal}개 생성됨`);
    if (problems.length === 0) {
      log('RESULT', '❌ 문제 미생성 - status 테이블 확인...');
      const { data: status } = await admin
        .from('problem_generation_status')
        .select('*').eq('user_id', userId);
      log('STATUS', JSON.stringify(status, null, 2));
      throw new Error('문제 미생성');
    }

    const byType = problems.reduce((acc, p) => {
      acc[p.problem_type] = (acc[p.problem_type] || 0) + 1;
      return acc;
    }, {});
    log('RESULT', '유형별:', byType);
    log('RESULT', '샘플 문제 1:', JSON.stringify({
      type: problems[0].problem_type,
      stem: problems[0].stem?.substring(0, 100) + '...',
      correct_answer: problems[0].correct_answer,
      explanation: problems[0].explanation?.substring(0, 80),
    }, null, 2));

    const success = problems.length >= expectedTotal * 0.5;
    log('RESULT', success ? '✅ 통합 테스트 성공' : '❌ 부분 실패');

  } catch (err) {
    log('ERROR', err.message);
    process.exitCode = 1;
  } finally {
    if (userId) {
      log('CLEANUP', `테스트 user 삭제: ${userId}`);
      try {
        await admin.from('generated_problems').delete().eq('user_id', userId);
        await admin.from('problem_generation_status').delete().eq('user_id', userId);
        await admin.auth.admin.deleteUser(userId);
        log('CLEANUP', '완료');
      } catch (cleanupErr) {
        log('CLEANUP', '실패:', cleanupErr.message);
      }
    }
  }
}

main();
