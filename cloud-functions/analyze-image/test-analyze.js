#!/usr/bin/env node
/**
 * test-analyze.js  ─  이미지 분석 파이프라인 로컬 통합 테스트
 *
 * DB(Supabase) 없이 Vertex AI 모델 호출 + 이미지 전처리 + 크롭 + 4-Pass 분석을
 * 로컬에서 직접 실행하여 user_answer·correct_answer가 올바른지 검증한다.
 *
 * 사용법:
 *   node test-analyze.js [이미지경로] [기대_사용자답안] [기대_실제답안]
 *
 * 예시:
 *   node test-analyze.js "../../test_image/이어지는 지문/이어지는 지문/KakaoTalk_20251202_101043325_07.jpg" "4,5,2" "5,3,5"
 *
 * 환경 변수:
 *   .env.yaml에서 GOOGLE_SERVICE_ACCOUNT_JSON을 읽거나,
 *   환경 변수로 직접 설정 가능.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI } from '@google/genai';

import { VERTEX_PROJECT_ID, VERTEX_LOCATION } from './shared/config.js';
import { preprocessImage } from './shared/imagePreprocessor.js';
import { cropRegions } from './shared/imageCropper.js';
import { executePassA, executePass0, executePassB, executePassC } from './shared/passes.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─── 환경 변수 로드 (.env.yaml 간이 파서) ───────────────────
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

// ─── 유틸리티 ──────────────────────────────────────────────
function sep(title) {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  ${title}`);
  console.log('═'.repeat(60));
}

function printTable(rows) {
  const header = ['문제번호', '사용자답안', '실제답안'];
  const colWidths = header.map((h, i) => Math.max(h.length, ...rows.map(r => String(r[i] ?? '-').length)));
  const line = colWidths.map(w => '─'.repeat(w + 2)).join('┼');
  console.log('┌' + colWidths.map(w => '─'.repeat(w + 2)).join('┬') + '┐');
  console.log('│ ' + header.map((h, i) => h.padEnd(colWidths[i])).join(' │ ') + ' │');
  console.log('├' + line + '┤');
  for (const row of rows) {
    console.log('│ ' + row.map((c, i) => String(c ?? '-').padEnd(colWidths[i])).join(' │ ') + ' │');
  }
  console.log('└' + colWidths.map(w => '─'.repeat(w + 2)).join('┴') + '┘');
}

// ─── 메인 ──────────────────────────────────────────────────
async function main() {
  loadEnvYaml();

  // 기본값: 사용자 지정 이미지 경로 및 기대 답안
  const DEFAULT_IMAGE = path.resolve(__dirname, '../../../test_image/이어지는 지문/이어지는 지문/KakaoTalk_20251202_101043325_07.jpg');
  const DEFAULT_EXPECTED_USER = '4,5,2';
  const DEFAULT_EXPECTED_CORRECT = '5,3,5';

  const imagePath = process.argv[2] ? path.resolve(process.argv[2]) : DEFAULT_IMAGE;
  const expectedUserStr = process.argv[3] || DEFAULT_EXPECTED_USER;
  const expectedCorrectStr = process.argv[4] || DEFAULT_EXPECTED_CORRECT;

  const expectedUser = expectedUserStr.split(',').map(s => s.trim());
  const expectedCorrect = expectedCorrectStr.split(',').map(s => s.trim());

  // 이미지 파일 확인
  if (!fs.existsSync(imagePath)) {
    console.error(`[오류] 이미지 파일을 찾을 수 없습니다: ${imagePath}`);
    process.exit(1);
  }

  sep('이미지 분석 파이프라인 테스트');
  console.log(`  이미지: ${imagePath}`);
  console.log(`  기대 사용자답안: [${expectedUser.join(', ')}]`);
  console.log(`  기대 실제답안:   [${expectedCorrect.join(', ')}]`);

  // Vertex AI 초기화
  const serviceAccountJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  const aiOptions = {
    vertexai: true,
    project: VERTEX_PROJECT_ID,
    location: VERTEX_LOCATION,
  };
  if (serviceAccountJson) {
    try {
      aiOptions.googleAuthOptions = { credentials: JSON.parse(serviceAccountJson) };
      console.log('  인증: Vertex AI 서비스계정 JSON 키');
    } catch (e) {
      console.error('[경고] GOOGLE_SERVICE_ACCOUNT_JSON 파싱 실패, ADC 폴백:', e.message);
    }
  } else {
    console.log('  인증: Application Default Credentials (ADC)');
  }
  const ai = new GoogleGenAI(aiOptions);

  // 이미지 로드 & Base64 변환
  sep('1단계: 이미지 로드 및 전처리');
  const imageBuffer = fs.readFileSync(imagePath);
  const ext = path.extname(imagePath).toLowerCase();
  const mimeMap = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };
  const originalMimeType = mimeMap[ext] || 'image/jpeg';
  const imageBase64 = imageBuffer.toString('base64');
  console.log(`  원본: ${(imageBuffer.length / 1024).toFixed(1)}KB, MIME: ${originalMimeType}`);

  const { imageBase64: resizedBase64, mimeType: resizedMimeType } = await preprocessImage(imageBase64, originalMimeType);
  console.log(`  전처리 완료: ${(Buffer.from(resizedBase64, 'base64').length / 1024).toFixed(1)}KB, MIME: ${resizedMimeType}`);

  // 세션 ID: 테스트용 임의 값
  const sessionId = `test-${Date.now()}`;

  // Pass A: 구조 추출
  sep('2단계: Pass A (구조 추출)');
  const taxonomyData = []; // 테스트에서는 taxonomy 없이 실행
  const passAResult = await executePassA({
    ai, sessionId,
    imageBase64: resizedBase64,
    mimeType: resizedMimeType,
    pageNum: 1, totalPages: 1,
    taxonomyData,
  });
  const pageItems = passAResult.parsed?.items || passAResult.parsed?.problems || passAResult.parsed?.pages?.[0]?.problems || [];
  console.log(`  추출된 문제 수: ${pageItems.length}`);
  console.log(`  사용 모델: ${passAResult.model}`);
  for (const item of pageItems) {
    console.log(`  - Q${item.problem_number}: ${(item.instruction || item.question_text || '').substring(0, 60)}...`);
  }

  // Pass 0: 바운딩 박스
  sep('3단계: Pass 0 (바운딩 박스 좌표)');
  const pass0Result = await executePass0({
    ai, sessionId,
    imageBase64: resizedBase64,
    mimeType: resizedMimeType,
  });
  console.log(`  감지된 bbox 수: ${pass0Result.bboxes.length}`);
  for (const bbox of pass0Result.bboxes) {
    console.log(`  - Q${bbox.problem_number}: full=${JSON.stringify(bbox.full_bbox)}, answer=${JSON.stringify(bbox.answer_area_bbox)}`);
  }

  // 크롭
  sep('4단계: 이미지 크롭');
  let answerAreaCrops = [];
  let fullCrops = [];
  if (pass0Result.bboxes.length > 0) {
    const cropResult = await cropRegions(resizedBase64, resizedMimeType, pass0Result.bboxes);
    answerAreaCrops = cropResult.answerAreaCrops;
    fullCrops = cropResult.fullCrops;
    console.log(`  답안영역 크롭: ${answerAreaCrops.length}개`);
    console.log(`  전체영역 크롭: ${fullCrops.length}개`);
  } else {
    console.log('  bbox가 없어 크롭을 건너뜁니다.');
  }

  // Pass B: 필기 인식
  sep('5단계: Pass B (필기 인식 → user_answer, correct_answer)');
  const passBResult = await executePassB({ ai, sessionId, answerAreaCrops, fullCrops });
  console.log(`  인식된 marks: ${passBResult.marks.length}개`);
  for (const mark of passBResult.marks) {
    console.log(`  - Q${mark.problem_number}: user_answer=${mark.user_answer}, correct_answer=${mark.correct_answer}`);
    const matchedItem = pageItems.find(item => String(item.problem_number) === String(mark.problem_number));
    if (matchedItem) {
      matchedItem.user_answer = mark.user_answer;
      matchedItem.correct_answer = mark.correct_answer;
    }
  }

  // 결과 요약
  sep('결과 요약');
  const resultRows = pageItems.map(item => [
    item.problem_number,
    item.user_answer ?? '-',
    item.correct_answer ?? '-',
  ]);
  printTable(resultRows);

  // 기대값 비교 & 검증
  sep('검증');
  const actualUserAnswers = pageItems.map(item => String(item.user_answer ?? ''));
  const actualCorrectAnswers = pageItems.map(item => String(item.correct_answer ?? ''));

  let allPass = true;
  const checks = [];

  for (let i = 0; i < Math.max(expectedUser.length, pageItems.length); i++) {
    const pNum = pageItems[i]?.problem_number || `?${i + 1}`;
    const expU = expectedUser[i] || '?';
    const actU = actualUserAnswers[i] || '?';
    const expC = expectedCorrect[i] || '?';
    const actC = actualCorrectAnswers[i] || '?';
    const userOk = expU === actU;
    const correctOk = expC === actC;
    const ok = userOk && correctOk;
    if (!ok) allPass = false;
    checks.push({ pNum, expU, actU, userOk, expC, actC, correctOk, ok });
  }

  for (const c of checks) {
    const userStatus = c.userOk ? 'OK' : 'FAIL';
    const correctStatus = c.correctOk ? 'OK' : 'FAIL';
    const icon = c.ok ? '[PASS]' : '[FAIL]';
    console.log(`  ${icon} Q${c.pNum}: user_answer(기대=${c.expU}, 실제=${c.actU}) ${userStatus} | correct_answer(기대=${c.expC}, 실제=${c.actC}) ${correctStatus}`);
  }

  console.log();
  if (allPass) {
    console.log('  ====> 전체 결과: PASS (모든 문제 일치)');
  } else {
    console.log('  ====> 전체 결과: FAIL (불일치 항목 있음)');
  }
  console.log();

  // 상세 JSON 덤프
  if (process.argv.includes('--verbose')) {
    sep('상세 데이터 (--verbose)');
    console.log(JSON.stringify({
      passA: passAResult.parsed,
      pass0: pass0Result.bboxes,
      passB: passBResult.marks,
      pageItems,
    }, null, 2));
  }

  process.exit(allPass ? 0 : 1);
}

main().catch(err => {
  console.error('[치명적 오류]', err);
  process.exit(2);
});
