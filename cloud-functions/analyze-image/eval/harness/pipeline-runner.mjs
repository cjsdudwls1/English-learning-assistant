/**
 * 로컬 파이프라인 러너 (eval 전용)
 * - 프로덕션과 동일 분기(config.SIMPLE_PIPELINE)로 파이프라인을 재현한다.
 *   - SIMPLE_PIPELINE ON(기본): index.js와 동일하게 preprocessImage → runSimpleExtractAndStructure.
 *     프로덕션은 세션의 모든 이미지를 일괄 전달하지만 eval은 GT가 페이지 단위이므로 1장 배열로 호출.
 *   - OFF: 구 4-Pass 경로 preprocessImage → processPage.
 * - 분류(Pass C)는 채점과 무관 → runClassification:false 로 생략(비용 절약).
 * - DB/Supabase 미사용. Document AI는 .env.yaml의 DOCUMENT_AI_PROCESSOR_ID가 있으면
 *   프로덕션처럼 자동 활성화된다(동일 서비스계정 JWT 인증).
 */
import fs from 'node:fs';
import path from 'node:path';
import { GoogleGenAI } from '@google/genai';
import { VERTEX_PROJECT_ID, VERTEX_LOCATION, CORRECT_SOURCE, SIMPLE_PIPELINE } from '../../shared/config.js';
import { preprocessImage } from '../../shared/imagePreprocessor.js';
import { processPage } from '../../shared/processPage.js';
import { runSimpleExtractAndStructure } from '../../shared/simplePipeline.js';

// run-eval.mjs가 console.log를 침묵시키므로 경로 표식은 console.error로 1회 출력
console.error(`[pipeline-runner] pipeline=${SIMPLE_PIPELINE ? 'simple(extract→structure)' : '4pass(processPage)'}`);

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
 * @returns {{ problem_number, user_answer, correct_answer, user_marked_correctness, choices }[]}
 *   user_marked_correctness/choices 포함: is_correct 시뮬(computeIsCorrect)이 prod 채점과 동치되도록.
 *   (score.mjs 추출품질 채점은 user_answer/correct_answer만 사용 → 추가 필드 무시, 무영향)
 */
export async function runPipelineOnImage({ ai, imagePath, pageNum = 1, totalPages = 1, sessionId, correctSource = CORRECT_SOURCE }) {
  const buf = fs.readFileSync(imagePath);
  const ext = path.extname(imagePath).toLowerCase();
  const mimeType = EXT_TO_MIME[ext] || 'image/jpeg';

  // 프로덕션 동일: 긴 변 1200px + JPEG 80% 리사이즈
  const pre = await preprocessImage(buf.toString('base64'), mimeType);
  const imageData = { imageBase64: pre.imageBase64, mimeType: pre.mimeType };

  const sid = sessionId || `eval-${path.basename(imagePath)}-${Date.now()}`;
  let pageItems;
  if (SIMPLE_PIPELINE) {
    ({ items: pageItems } = await runSimpleExtractAndStructure({
      ai, sessionId: sid, images: [imageData],
      taxonomyData: [], userLanguage: 'ko',
      runClassification: false,
    }));
  } else {
    ({ pageItems } = await processPage({
      ai, sessionId: sid, imageData,
      pageNum, totalPages,
      taxonomyData: [], userLanguage: 'ko',
      runClassification: false,
      correctSource, // 'crop'(현재) | 'fullpage'(하이브리드): correct 추론 소스 전환
    }));
  }

  return pageItems.map(it => ({
    problem_number: String(it.problem_number ?? '').trim(),
    user_answer: it.user_answer ?? null,
    correct_answer: it.correct_answer ?? null,
    user_marked_correctness: it.user_marked_correctness ?? null,
    choices: Array.isArray(it.choices) ? it.choices : [],
  }));
}
