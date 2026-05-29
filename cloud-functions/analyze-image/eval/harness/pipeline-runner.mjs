/**
 * 로컬 파이프라인 러너 (eval 전용)
 * - 프로덕션과 동일한 shared/processPage.js를 호출해 충실히 재현한다.
 *   (runAnalysisPipeline의 페이지 처리 = preprocessImage → processPage 와 동일 순서)
 * - Pass C(분류)는 채점과 무관 → runClassification:false 로 생략(비용 절약).
 * - DB/Supabase 미사용. Document AI는 .env.yaml의 DOCUMENT_AI_PROCESSOR_ID가 있으면
 *   프로덕션처럼 자동 활성화된다(동일 서비스계정 JWT 인증).
 */
import fs from 'node:fs';
import path from 'node:path';
import { GoogleGenAI } from '@google/genai';
import { VERTEX_PROJECT_ID, VERTEX_LOCATION } from '../../shared/config.js';
import { preprocessImage } from '../../shared/imagePreprocessor.js';
import { processPage } from '../../shared/processPage.js';

const EXT_TO_MIME = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp',
};

/** index.js#buildAIClient 복제 (행위 동일) */
export function buildAIClient() {
  const serviceAccountJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  const aiOptions = { vertexai: true, project: VERTEX_PROJECT_ID, location: VERTEX_LOCATION };
  if (serviceAccountJson) {
    try {
      aiOptions.googleAuthOptions = { credentials: JSON.parse(serviceAccountJson) };
    } catch (e) {
      console.error('[pipeline-runner] GOOGLE_SERVICE_ACCOUNT_JSON 파싱 실패, ADC 폴백:', e.message);
    }
  }
  return new GoogleGenAI(aiOptions);
}

/**
 * 단일 이미지에 대해 실제 파이프라인 실행 → marks 추출
 * @returns {{ problem_number, user_answer, correct_answer }[]}
 */
export async function runPipelineOnImage({ ai, imagePath, pageNum = 1, totalPages = 1, sessionId, correctSource = 'crop' }) {
  const buf = fs.readFileSync(imagePath);
  const ext = path.extname(imagePath).toLowerCase();
  const mimeType = EXT_TO_MIME[ext] || 'image/jpeg';

  // 프로덕션 동일: 긴 변 1200px + JPEG 80% 리사이즈
  const pre = await preprocessImage(buf.toString('base64'), mimeType);
  const imageData = { imageBase64: pre.imageBase64, mimeType: pre.mimeType };

  const sid = sessionId || `eval-${path.basename(imagePath)}-${Date.now()}`;
  const { pageItems } = await processPage({
    ai, sessionId: sid, imageData,
    pageNum, totalPages,
    taxonomyData: [], userLanguage: 'ko',
    runClassification: false,
    correctSource, // 'crop'(현재) | 'fullpage'(하이브리드): correct 추론 소스 전환
  });

  return pageItems.map(it => ({
    problem_number: String(it.problem_number ?? '').trim(),
    user_answer: it.user_answer ?? null,
    correct_answer: it.correct_answer ?? null,
  }));
}
