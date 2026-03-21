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
 *   3. GCP Cloud Functions gen2 HTTP 엔드포인트 직접 호출
 *   4. 결과 요약 출력 (problems + labels 테이블 검증)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

// ─── 설정 ───
const TEST_EMAIL = 'cjsdudwls1357@gmail.com';
const TEST_PASSWORD = 'asas6012';

// .env 파일에서 환경 변수 로드
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.resolve(__dirname, '../../English-learning-assistant/.env');

let SUPABASE_URL = '';
let SUPABASE_ANON_KEY = '';
let GCF_URL = '';

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
    if (trimmed.startsWith('VITE_ANALYZE_GCF_URL=')) {
      GCF_URL = trimmed.split('=').slice(1).join('=');
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

if (!GCF_URL) {
  console.error('[ERROR] VITE_ANALYZE_GCF_URL이 .env에 없습니다');
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

// ─── 메인 ───

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.log('사용법: node test-analyze-image.mjs "이미지경로1.jpg" ["이미지경로2.jpg" ...]');
    process.exit(1);
  }

  console.log('='.repeat(60));
  console.log('  이미지 분석 E2E 테스트 (GCP Cloud Functions)');
  console.log('='.repeat(60));

  // 1. Supabase SDK 초기화 및 로그인
  console.log('\n[STEP 1] Supabase SDK 초기화 및 로그인...');
  console.log(`[CONFIG] Supabase URL: ${SUPABASE_URL}`);
  console.log(`[CONFIG] GCF URL: ${GCF_URL}`);

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

  // 3. GCP Cloud Function 직접 HTTP 호출
  console.log('\n[STEP 3] GCP Cloud Function 호출...');
  const startTime = Date.now();

  const gcfResponse = await fetch(GCF_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ images, userId, language: 'ko' }),
  });

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  if (!gcfResponse.ok) {
    const errorText = await gcfResponse.text();
    console.error(`[ERROR] Cloud Function 실패 (${gcfResponse.status}):`, errorText.substring(0, 500));
    process.exit(1);
  }

  const gcfResult = await gcfResponse.json();
  const sessionId = gcfResult?.sessionId;

  if (!sessionId) {
    console.error('[ERROR] 세션 ID가 응답에 없습니다:', JSON.stringify(gcfResult));
    process.exit(1);
  }

  console.log(`[GCF] 분석 완료 (${elapsed}초), 세션 ID: ${sessionId}`);

  // 4. 결과 출력 (DB 검증)
  console.log('\n' + '='.repeat(60));
  console.log('  분석 결과 (DB 검증)');
  console.log('='.repeat(60));

  // 세션 정보
  const { data: session } = await supabase
    .from('sessions')
    .select('id, status, analysis_model, failure_stage, failure_message')
    .eq('id', sessionId)
    .single();

  console.log(`  세션 ID: ${session?.id}`);
  console.log(`  상태: ${session?.status}`);
  console.log(`  모델: ${session?.analysis_model}`);
  if (session?.failure_stage) {
    console.log(`  실패 단계: ${session.failure_stage}`);
    console.log(`  에러: ${session.failure_message}`);
  }

  // 문제 + 라벨 조회
  const { data: problems } = await supabase
    .from('problems')
    .select('id, index_in_image, content, problem_metadata')
    .eq('session_id', sessionId)
    .order('index_in_image', { ascending: true });

  console.log(`  추출된 문제 수: ${(problems || []).length}`);

  if (problems && problems.length > 0) {
    const problemIds = problems.map(p => p.id);
    const { data: labels, error: labelsError } = await supabase
      .from('labels')
      .select('problem_id, user_answer, correct_answer, is_correct, classification')
      .in('problem_id', problemIds);

    if (labelsError) {
      console.error('[ERROR] labels 조회 실패:', labelsError);
    }

    const labelMap = new Map((labels || []).map(l => [l.problem_id, l]));

    console.log(`  labels 레코드 수: ${(labels || []).length}`);
    console.log('');
    console.log('  ┌───────┬──────────────────────────────────┬──────────┬──────────┬──────────┐');
    console.log('  │ 번호  │ 분류                             │ 정답     │ 사용자   │ 채점     │');
    console.log('  ├───────┼──────────────────────────────────┼──────────┼──────────┼──────────┤');

    for (const p of problems) {
      const content = p.content || {};
      const label = labelMap.get(p.id);
      const cls = label?.classification || {};
      const num = String(content.problem_number || p.index_in_image + 1).padEnd(5);
      const depth = [cls.depth1, cls.depth2].filter(Boolean).join(' > ').substring(0, 32).padEnd(32);

      // labels 테이블 우선, fallback으로 content
      const correct = String(label?.correct_answer || content.correct_answer || '-').padEnd(8);
      const user = String(label?.user_answer || content.user_answer || '-').padEnd(8);
      const grade = label?.is_correct === true ? 'O' : (label?.is_correct === false ? 'X' : '-');
      console.log(`  │ ${num} │ ${depth} │ ${correct} │ ${user} │ ${grade.padEnd(8)} │`);
    }

    console.log('  └───────┴──────────────────────────────────┴──────────┴──────────┴──────────┘');

    // 검증 요약
    console.log('\n  ── 검증 결과 ──');
    const labelsWithUserAnswer = (labels || []).filter(l => l.user_answer && l.user_answer !== '');
    const labelsWithCorrectAnswer = (labels || []).filter(l => l.correct_answer && l.correct_answer !== '');
    const labelsWithIsCorrect = (labels || []).filter(l => l.is_correct !== null);

    console.log(`  labels 총 레코드: ${(labels || []).length} / ${problems.length} (예상)`);
    console.log(`  user_answer 있음: ${labelsWithUserAnswer.length}`);
    console.log(`  correct_answer 있음: ${labelsWithCorrectAnswer.length}`);
    console.log(`  is_correct 판정: ${labelsWithIsCorrect.length}`);

    if ((labels || []).length === 0) {
      console.log('\n  [FAIL] labels 레코드가 0건입니다. saveLabels 함수 에러를 확인하세요.');
    } else if ((labels || []).length === problems.length) {
      console.log('\n  [PASS] 모든 문제에 labels 레코드가 생성되었습니다.');
    }
  }

  console.log(`\n[SUCCESS] 테스트 완료`);
  console.log(`[URL] https://english-learningassistant.netlify.app/edit/${sessionId}`);
}

main().catch(err => {
  console.error('\n[FATAL]', err.message || err);
  process.exit(1);
});

