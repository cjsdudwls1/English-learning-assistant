#!/usr/bin/env node
/**
 * test-deploy.js — 배포된 GCF에 테스트 이미지 전송 → DB 결과 검증
 *
 * 사용법:
 *   node test-deploy.js [--image img06|img07|img08|img09] [--all]
 *
 * 기본: img07 (3문제, 가장 빠름) 하나만 테스트
 * --all: 4개 전부 테스트
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import { TEST_CASES, checkUserAnswer } from './test-config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const GCF_URL = 'https://analyze-image-jg35qrg4wa-du.a.run.app';
const POLL_INTERVAL_MS = 5000;
const MAX_POLL_ATTEMPTS = 120; // 10분

// ─── 환경 변수 로드 ─────────────────────────────────────
function loadEnvYaml() {
  const envPath = path.join(__dirname, '.env.yaml');
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, 'utf-8').split('\n');
  for (const line of lines) {
    const match = line.match(/^(\w+):\s*'(.+)'$/);
    if (match && !process.env[match[1]]) {
      process.env[match[1]] = match[2];
    }
  }
}

function sep(title) {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  ${title}`);
  console.log('═'.repeat(60));
}

// ─── GCF 호출 ────────────────────────────────────────────
async function callGCF(testCase, userId) {
  const imageBuffer = fs.readFileSync(testCase.imagePath);
  const imageBase64 = imageBuffer.toString('base64');

  const body = {
    images: [{
      imageBase64,
      mimeType: 'image/jpeg',
      fileName: path.basename(testCase.imagePath),
    }],
    userId,
    language: 'ko',
  };

  console.log(`  POST ${GCF_URL} (${(imageBuffer.length / 1024).toFixed(0)}KB)...`);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 600_000);

  try {
    const res = await fetch(GCF_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    const json = await res.json();
    if (!json.sessionId) throw new Error(`응답에 sessionId 없음: ${JSON.stringify(json)}`);
    console.log(`  sessionId: ${json.sessionId}`);
    return json.sessionId;
  } catch (err) {
    clearTimeout(timeout);
    throw err;
  }
}

// ─── DB 폴링 ─────────────────────────────────────────────
async function pollSession(supabase, sessionId) {
  for (let i = 0; i < MAX_POLL_ATTEMPTS; i++) {
    const { data, error } = await supabase
      .from('sessions')
      .select('status, failure_stage, failure_message')
      .eq('id', sessionId)
      .single();

    if (error) throw new Error(`세션 조회 실패: ${error.message}`);

    if (data.status === 'completed' || data.status === 'labeled') {
      console.log(`  세션 완료: status=${data.status}`);
      return data;
    }
    if (data.status === 'failed') {
      throw new Error(`세션 실패: stage=${data.failure_stage}, msg=${data.failure_message}`);
    }

    process.stdout.write(`  폴링 ${i + 1}/${MAX_POLL_ATTEMPTS} (status=${data.status})...\r`);
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new Error('폴링 타임아웃 (10분)');
}

// ─── DB 결과 검증 ────────────────────────────────────────
async function verifyDBResults(supabase, sessionId, testCase) {
  // problems + labels 조인 조회
  const { data: problems, error } = await supabase
    .from('problems')
    .select('id, index_in_image, content, problem_metadata')
    .eq('session_id', sessionId)
    .order('index_in_image', { ascending: true });

  if (error) throw new Error(`problems 조회 실패: ${error.message}`);

  const expectedUser = testCase.expectedUser.split(',').map(s => s.trim());
  const expectedCorrect = testCase.expectedCorrect.split(',').map(s => s.trim());

  console.log(`  DB 문제 수: ${problems.length} (기대: ${expectedUser.length})`);

  const results = [];
  for (let i = 0; i < problems.length; i++) {
    const prob = problems[i];

    // labels 조회
    const { data: labels } = await supabase
      .from('labels')
      .select('user_answer, correct_answer, is_correct, classification')
      .eq('problem_id', prob.id)
      .single();

    const actU = String(labels?.user_answer ?? '');
    const actC = String(labels?.correct_answer ?? '');
    const userPass = checkUserAnswer(testCase, i, actU);
    const correctPass = (expectedCorrect[i] || '?') === actC;

    // 안전성: 기존 기능 검증
    const content = prob.content || {};
    const hasPassage = !!(content.passage || content.stem);
    const hasChoices = Array.isArray(content.choices) && content.choices.length > 0;
    const hasClassification = !!(labels?.classification?.depth1);

    results.push({
      num: content.problem_number || i,
      userAnswer: { expected: expectedUser[i], actual: actU, pass: userPass },
      correctAnswer: { expected: expectedCorrect[i], actual: actC, pass: correctPass },
      safety: { hasPassage, hasChoices, hasClassification },
    });
  }

  return results;
}

// ─── 메인 ────────────────────────────────────────────────
async function main() {
  loadEnvYaml();

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    console.error('[오류] .env.yaml에 SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 필요');
    process.exit(2);
  }
  const supabase = createClient(supabaseUrl, supabaseKey);

  // 테스트 유저 ID (서비스 롤 키로 조회)
  const { data: users } = await supabase.auth.admin.listUsers();
  const testUserId = users?.users?.[0]?.id;
  if (!testUserId) {
    console.error('[오류] 테스트 사용자를 찾을 수 없음');
    process.exit(2);
  }
  console.log(`  테스트 사용자: ${testUserId}`);

  // 테스트 대상 선택
  const runAll = process.argv.includes('--all');
  const imageArg = process.argv.find((a, i) => process.argv[i - 1] === '--image');
  let cases = runAll ? TEST_CASES : [TEST_CASES.find(t => t.id === (imageArg || 'img07'))];
  cases = cases.filter(Boolean);

  let allPass = true;
  for (const testCase of cases) {
    sep(`E2E 테스트: ${testCase.id}`);

    // 1. GCF 호출
    const sessionId = await callGCF(testCase, testUserId);

    // 2. 완료 대기
    await pollSession(supabase, sessionId);

    // 3. DB 검증
    const results = await verifyDBResults(supabase, sessionId, testCase);

    // 4. 결과 출력
    for (const r of results) {
      const uIcon = r.userAnswer.pass ? '✓' : '✗';
      const cIcon = r.correctAnswer.pass ? '✓' : '✗';
      const sIcon = (r.safety.hasPassage && r.safety.hasChoices && r.safety.hasClassification) ? '✓' : '✗';
      console.log(`  Q${r.num}: user=${uIcon}${r.userAnswer.actual}(${r.userAnswer.expected}) correct=${cIcon}${r.correctAnswer.actual}(${r.correctAnswer.expected}) safety=${sIcon}`);
      if (!r.userAnswer.pass || !r.correctAnswer.pass) allPass = false;
      if (!r.safety.hasPassage) console.log(`    ⚠ 지문 없음`);
      if (!r.safety.hasChoices) console.log(`    ⚠ 선택지 없음`);
      if (!r.safety.hasClassification) console.log(`    ⚠ 분류 없음`);
    }

    // 5. 테스트 세션 삭제 (DB 오염 방지)
    console.log(`  테스트 세션 정리: ${sessionId}`);
    await supabase.from('labels').delete().in('problem_id',
      (await supabase.from('problems').select('id').eq('session_id', sessionId)).data?.map(p => p.id) || []
    );
    await supabase.from('problems').delete().eq('session_id', sessionId);
    await supabase.from('sessions').delete().eq('id', sessionId);
  }

  console.log();
  console.log(`  ====> E2E 결과: ${allPass ? 'PASS ✓' : 'FAIL ✗'}`);
  process.exit(allPass ? 0 : 1);
}

main().catch(err => {
  console.error('[치명적 오류]', err);
  process.exit(2);
});
