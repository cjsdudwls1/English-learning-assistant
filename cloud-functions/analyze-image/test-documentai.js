#!/usr/bin/env node
/**
 * test-documentai.js
 *
 * 로컬에서 Document AI API 호출을 테스트하는 스크립트입니다.
 * 지정된 이미지를 읽어 Base64로 변환한 후, callDocumentAI 함수를 호출하고
 * 반환된 텍스트 결과를 출력합니다.
 *
 * 사용법:
 *   node test-documentai.js [이미지경로]
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { callDocumentAI } from './shared/documentAiClient.js';

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

async function main() {
  loadEnvYaml();

  // 테스트용 기본 이미지 경로 설정
  const DEFAULT_IMAGE = path.resolve(__dirname, '../../test_image/이어지는 지문/KakaoTalk_20251202_101043325_07.jpg');
  const imagePath = process.argv[2] ? path.resolve(process.argv[2]) : DEFAULT_IMAGE;

  // DOCUMENT_AI_PROCESSOR_ID 환경변수 확인
  if (!process.env.DOCUMENT_AI_PROCESSOR_ID) {
    console.error(`[DocumentAI] ────────────────────────────────────────────────────────`);
    console.error(`[DocumentAI] [오류] DOCUMENT_AI_PROCESSOR_ID 환경변수가 설정되지 않았습니다.`);
    console.error(`[DocumentAI]`);
    console.error(`[DocumentAI] Document AI 프로세서를 먼저 생성해야 합니다:`);
    console.error(`[DocumentAI]   1. GCP 콘솔 → Document AI → 프로세서 갤러리 이동`);
    console.error(`[DocumentAI]   2. "Enterprise Document OCR" 프로세서 생성 (리전: us)`);
    console.error(`[DocumentAI]   3. 생성된 프로세서 ID를 .env.yaml에 추가:`);
    console.error(`[DocumentAI]      DOCUMENT_AI_PROCESSOR_ID: '<프로세서 ID>'`);
    console.error(`[DocumentAI]      DOCUMENT_AI_LOCATION: 'us'`);
    console.error(`[DocumentAI] ────────────────────────────────────────────────────────`);
    process.exit(1);
  }

  console.log(`[DocumentAI] ────────────────────────────────────────────────────────`);
  console.log(`[DocumentAI] Document AI 호출 테스트 시작`);
  console.log(`[DocumentAI] 프로세서 ID: ${process.env.DOCUMENT_AI_PROCESSOR_ID}`);
  console.log(`[DocumentAI] 리전: ${process.env.DOCUMENT_AI_LOCATION || 'us'}`);
  console.log(`[DocumentAI] 이미지 경로: ${imagePath}`);

  if (!fs.existsSync(imagePath)) {
    console.error(`[DocumentAI] [오류] 이미지 파일을 찾을 수 없습니다: ${imagePath}`);
    process.exit(1);
  }

  // 1. 이미지 로드 및 Base64 변환
  console.log(`[DocumentAI] 1단계: 이미지 로드 및 Base64 변환`);
  const imageBuffer = fs.readFileSync(imagePath);
  const ext = path.extname(imagePath).toLowerCase();

  // MIME 타입 판별
  const mimeMap = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.pdf': 'application/pdf'
  };
  const mimeType = mimeMap[ext] || 'image/jpeg';

  const imageBase64 = imageBuffer.toString('base64');
  console.log(`[DocumentAI]  - 원본 크기: ${(imageBuffer.length / 1024).toFixed(1)}KB`);
  console.log(`[DocumentAI]  - MIME 타입: ${mimeType}`);

  // 2. callDocumentAI 호출
  console.log(`[DocumentAI] 2단계: callDocumentAI 호출 진행`);
  try {
    const result = await callDocumentAI(imageBase64, mimeType);
    
    // 3. 결과 출력
    console.log(`[DocumentAI] 3단계: 추출된 텍스트 결과`);
    console.log(`[DocumentAI] ────────────────────────────────────────────────────────`);
    console.log(result.text || '(추출된 텍스트 없음)');
    console.log(`[DocumentAI] ────────────────────────────────────────────────────────`);
    
    // 추출된 페이지 정보 요약 출력
    if (result.pages && result.pages.length > 0) {
      console.log(`[DocumentAI] 처리된 페이지 수: ${result.pages.length}`);
    }
  } catch (error) {
    console.error(`[DocumentAI] [오류] API 호출 중 예외 발생:`, error);
    process.exit(1);
  }
}

main().catch(err => {
  console.error(`[DocumentAI] [치명적 오류]`, err);
  process.exit(2);
});
