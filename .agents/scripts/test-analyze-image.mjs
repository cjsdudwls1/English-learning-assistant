#!/usr/bin/env node
/**
 * 이미지 분석 E2E 테스트 스크립트
 * 
 * 사용법:
 *   node test-analyze-image.mjs "이미지경로1.jpg" ["이미지경로2.jpg" ...]
 * 
 * 동작:
 *   1. Supabase SDK 로그인
 *   2. 이미지 base64 변환
 *   3. analyze-image Edge Function 호출 (SDK의 functions.invoke 사용)
 *   4. 세션 상태 폴링 (최대 5분)
 *   5. 결과 요약 출력
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

// ─── 설정 ───
const TEST_EMAIL = 'cjsdudwls1357@gmail.com';
const TEST_PASSWORD = 'asas6012';
const POLL_INTERVAL_MS = 3000;
const MAX_POLL_TIME_MS = 5 * 60 * 1000; // 5분

// .env 파일에서 환경 변수 로드
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.resolve(__dirname, '../../English-learning-assistant/.env');

let SUPABASE_URL = '';
let SUPABASE_ANON_KEY = '';

try {
  const envContent = fs.readFileSync(envPath, 'utf-8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('VITE_SUPABASE_URL=')) {
      SUPABASE_URL = trimmed.split('=').slice(1).join('=');
    }
    if (trimmed.startsWith('VITE_SUPABASE_ANON_KEY=')) {
      SUPABASE_ANON_KEY = trimmed.split('=').slice(1).join('=');
    }
  }
} catch (e) {
  console.error('[ERROR] .env 파일을 읽을 수 없습니다:', envPath);
  process.exit(1);
}

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('[ERROR] VITE_SUPABASE_URL 또는 VITE_SUPABASE_ANON_KEY가 .env에 없습니다');
  process.exit(1);
}

// Supabase JS SDK 로드 (프론트엔드 앱의 node_modules에서)
let createClient;
const nodeModulesPath = path.resolve(__dirname, '../../English-learning-assistant/node_modules/@supabase/supabase-js');
try {
  const mod = require(nodeModulesPath);
  createClient = mod.createClient;
} catch (e) {
  console.error('[ERROR] @supabase/supabase-js가 설치되어 있지 않습니다.');
  console.error(`  경로: ${nodeModulesPath}`);
  console.error('  실행: cd English-learning-assistant/English-learning-assistant && npm install');
  process.exit(1);
}

// ─── 유틸리티 ───

function imageToBase64(filePath) {
  const absPath = path.resolve(filePath);
  if (!fs.existsSync(absPath)) {
    throw new Error(`파일이 존재하지 않습니다: ${absPath}`);
  }

  const buffer = fs.readFileSync(absPath);
  const base64 = buffer.toString('base64');
  const ext = path.extname(absPath).toLowerCase();
  const mimeMap = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };
  const mimeType = mimeMap[ext] || 'image/jpeg';
  const fileName = path.basename(absPath);

  console.log(`[IMAGE] ${fileName}: ${buffer.length} bytes → base64 ${base64.length} chars, type=${mimeType}`);
  return { imageBase64: base64, mimeType, fileName };
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ─── 메인 ───

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.log('사용법: node test-analyze-image.mjs "이미지경로1.jpg" ["이미지경로2.jpg" ...]');
    process.exit(1);
  }

  console.log('='.repeat(60));
  console.log('  이미지 분석 E2E 테스트');
  console.log('='.repeat(60));

  // 1. Supabase SDK 초기화 및 로그인
  console.log('\n[STEP 1] Supabase SDK 초기화 및 로그인...');
  console.log(`[CONFIG] URL: ${SUPABASE_URL}`);
  console.log(`[CONFIG] Key: ${SUPABASE_ANON_KEY.substring(0, 20)}...`);

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
    email: TEST_EMAIL,
    password: TEST_PASSWORD,
  });

  if (authError) {
    throw new Error(`로그인 실패: ${authError.message}`);
  }

  const userId = authData.user.id;
  console.log(`[AUTH] 로그인 성공 (userId: ${userId.substring(0, 8)}...)`);

  // 2. 이미지 변환
  console.log('\n[STEP 2] 이미지 base64 변환...');
  const images = [];
  for (const filePath of args.slice(0, 3)) {
    try {
      images.push(imageToBase64(filePath));
    } catch (e) {
      console.error(`[ERROR] ${e.message}`);
    }
  }

  if (images.length === 0) {
    console.error('[ERROR] 유효한 이미지가 없습니다');
    process.exit(1);
  }

  // 3. Edge Function 호출 (SDK functions.invoke 사용)
  console.log('\n[STEP 3] analyze-image Edge Function 호출...');
  
  // 디버깅: 현재 세션 정보 출력
  const { data: sessionData } = await supabase.auth.getSession();
  console.log(`[DEBUG] Session exists: ${!!sessionData.session}`);
  console.log(`[DEBUG] Access token (first 50): ${sessionData.session?.access_token?.substring(0, 50)}...`);

  const { data: fnData, error: fnError } = await supabase.functions.invoke('analyze-image', {
    body: { images, userId, language: 'ko' },
  });

  if (fnError) {
    console.error('[DEBUG] fnError:', JSON.stringify(fnError, null, 2));
    console.error('[DEBUG] fnError.context:', fnError.context);
    // FunctionsHttpError인 경우 응답 데이터 추출 시도
    if (fnData) {
      console.error('[DEBUG] fnData despite error:', JSON.stringify(fnData).substring(0, 500));
    }
    throw new Error(`Edge Function error: ${fnError.message || JSON.stringify(fnError)}`);
  }

  const sessionId = fnData?.sessionId;
  if (!sessionId) {
    throw new Error(`세션 ID가 응답에 없습니다: ${JSON.stringify(fnData)}`);
  }

  console.log(`[API] 세션 생성됨: ${sessionId}`);

  // 4. 폴링
  console.log('\n[STEP 4] 분석 결과 대기 중...');
  const startTime = Date.now();
  let session = null;

  while (Date.now() - startTime < MAX_POLL_TIME_MS) {
    const { data: sessions } = await supabase
      .from('sessions')
      .select('id, status, analysis_model, failure_stage, failure_message')
      .eq('id', sessionId)
      .single();

    if (!sessions) {
      await sleep(POLL_INTERVAL_MS);
      continue;
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    if (sessions.status === 'completed') {
      console.log(`\n[POLL] 분석 완료 (${elapsed}초, 모델: ${sessions.analysis_model})`);
      session = sessions;
      break;
    }

    if (sessions.status === 'failed') {
      console.log(`\n[POLL] 분석 실패 (${elapsed}초, 단계: ${sessions.failure_stage})`);
      session = sessions;
      break;
    }

    process.stdout.write(`\r[POLL] 분석 중... ${elapsed}초 경과 (모델: ${sessions.analysis_model || '대기'})`);
    await sleep(POLL_INTERVAL_MS);
  }

  // 5. 결과 출력
  console.log('\n' + '='.repeat(60));
  console.log('  분석 결과');
  console.log('='.repeat(60));

  if (!session) {
    console.log('[TIMEOUT] 세션 결과를 가져올 수 없습니다');
    console.log(`[TIP] 수동 확인: npx supabase functions logs analyze-image --project-ref vkoegxohahpptdyipmkr --scroll`);
    process.exit(1);
  }

  console.log(`  세션 ID: ${session.id}`);
  console.log(`  상태: ${session.status}`);
  console.log(`  모델: ${session.analysis_model}`);

  if (session.status === 'failed') {
    console.log(`  실패 단계: ${session.failure_stage}`);
    console.log(`  에러 메시지: ${session.failure_message}`);
    console.log('\n[FAILED] 분석이 실패했습니다');
    process.exit(1);
  }

  // 문제 조회
  const { data: problems } = await supabase
    .from('problems')
    .select('id, index_in_image, content, problem_metadata')
    .eq('session_id', sessionId)
    .order('index_in_image', { ascending: true });

  console.log(`  추출된 문제 수: ${(problems || []).length}`);

  if (problems && problems.length > 0) {
    const problemIds = problems.map(p => p.id);
    const { data: labels } = await supabase
      .from('labels')
      .select('problem_id, classification, ai_answer, user_mark')
      .in('problem_id', problemIds);

    const labelMap = new Map((labels || []).map(l => [l.problem_id, l]));

    console.log('\n  ┌───────┬──────────────────────────────────┬──────────┬──────────┐');
    console.log('  │ 번호  │ 분류                             │ 정답     │ 사용자   │');
    console.log('  ├───────┼──────────────────────────────────┼──────────┼──────────┤');

    for (const p of problems) {
      const content = p.content || {};
      const label = labelMap.get(p.id);
      const cls = label?.classification || {};
      const num = String(content.problem_number || p.index_in_image + 1).padEnd(5);
      const depth = [cls.depth1, cls.depth2].filter(Boolean).join(' > ').substring(0, 32).padEnd(32);
      const correct = String(content.correct_answer || label?.ai_answer || '-').padEnd(8);
      const user = String(content.user_answer || '-').padEnd(8);
      console.log(`  │ ${num} │ ${depth} │ ${correct} │ ${user} │`);
    }

    console.log('  └───────┴──────────────────────────────────┴──────────┴──────────┘');
  }

  console.log(`\n[SUCCESS] 분석 완료`);
  console.log(`[URL] https://english-learningassistant.netlify.app/edit/${sessionId}`);
}

main().catch(err => {
  console.error('\n[FATAL]', err.message || err);
  process.exit(1);
});
