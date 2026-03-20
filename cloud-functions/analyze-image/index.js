/**
 * analyze-image: Cloud Functions gen2 메인 핸들러
 *
 * 전체 이미지 분석 파이프라인을 서버에서 수행:
 * Extract → Crop → Detect → Classify → DB 저장
 *
 * 타임아웃: 600초 (10분), 런타임: Node.js 22 (ESM)
 *
 * 요청 후 즉시 sessionId를 반환하고,
 * 나머지 처리는 백그라운드에서 계속 실행됨.
 */

import functions from '@google-cloud/functions-framework';
import { GoogleGenAI } from '@google/genai';
import { createClient } from '@supabase/supabase-js';

import { StageError, markSessionFailed } from './shared/errors.js';
import { VERTEX_PROJECT_ID, VERTEX_LOCATION } from './shared/config.js';
import { loadTaxonomyData, buildTaxonomyLookup } from './shared/taxonomy.js';
import { cropRegions } from './shared/imageCropper.js';
import { executePassA, executePass0, executePassB, executePassC } from './shared/passes.js';
import { uploadImages, createSession, saveProblems, saveLabels, updateProblemMetadata, completeSession } from './shared/dbOperations.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function setCorsHeaders(res) {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

function validateRequest(body) {
  const { images, userId } = body || {};
  if (!images || !Array.isArray(images) || images.length === 0 || !userId) {
    return { isValid: false, error: 'images[]와 userId가 필요합니다.' };
  }
  return { isValid: true, images, userId, language: body.language };
}

/**
 * 단일 페이지에 대한 4-Pass 분석 파이프라인 실행
 * Pass A(구조) + Pass 0(좌표) → 크롭 → Pass B(필기) → Pass C(분류)
 */
async function processPage({ ai, sessionId, imageData, pageNum, totalPages, taxonomyData }) {
  // Pass A + Pass 0 병렬 실행
  const [passAResult, pass0Result] = await Promise.all([
    executePassA({ ai, sessionId, imageBase64: imageData.imageBase64, mimeType: imageData.mimeType, pageNum, totalPages, taxonomyData }),
    executePass0({ ai, sessionId, imageBase64: imageData.imageBase64, mimeType: imageData.mimeType }),
  ]);

  const pageItems = passAResult.parsed?.items || passAResult.parsed?.problems || passAResult.parsed?.pages?.[0]?.problems || [];
  console.log(`[handler] Pass A: ${pageItems.length}개 문제 (${passAResult.model}), Pass 0: ${pass0Result.bboxes.length}개 bbox`, { sessionId });

  // 서버 사이드 크롭
  let answerAreaCrops = [];
  let fullCrops = [];
  if (pass0Result.bboxes.length > 0) {
    const cropResult = await cropRegions(imageData.imageBase64, imageData.mimeType, pass0Result.bboxes);
    answerAreaCrops = cropResult.answerAreaCrops;
    fullCrops = cropResult.fullCrops;
    console.log(`[handler] 크롭: ${answerAreaCrops.length} answer + ${fullCrops.length} full`, { sessionId });
  }

  // Pass B: 필기 인식
  const passBResult = await executePassB({ ai, sessionId, answerAreaCrops, fullCrops });
  console.log(`[handler] Pass B: ${passBResult.marks.length}개 marks`, { sessionId });
  for (const mark of passBResult.marks) {
    const matchedItem = pageItems.find(item => String(item.problem_number) === String(mark.problem_number));
    if (matchedItem) {
      matchedItem.user_answer = mark.user_answer;
      matchedItem.correct_answer = mark.correct_answer;
    }
  }

  // Pass C: 분류
  const passCResult = await executePassC({ ai, sessionId, taxonomyData, pageItems, userLanguage: 'ko' });
  console.log(`[handler] Pass C: ${passCResult.classifications.length}개 분류`, { sessionId });
  for (const cls of passCResult.classifications) {
    const matchedItem = pageItems.find(item => String(item.problem_number) === String(cls.problem_number));
    if (matchedItem) {
      matchedItem.classification = cls.classification;
      matchedItem.metadata = cls.metadata;
    }
  }

  return { pageItems, usedModel: passAResult.model };
}

/**
 * 백그라운드 분석 파이프라인 (응답 전송 후 실행)
 */
async function runAnalysisPipeline(supabase, ai, sessionId, images, userLanguage) {
  const taxonomyData = await loadTaxonomyData(supabase);
  const { taxonomyByDepthKey } = buildTaxonomyLookup(taxonomyData);

  let allValidatedItems = [];
  let finalUsedModel = '';

  for (let pageIndex = 0; pageIndex < images.length; pageIndex++) {
    const imageData = images[pageIndex];
    try {
      const { pageItems, usedModel } = await processPage({
        ai, sessionId, imageData, pageNum: pageIndex + 1, totalPages: images.length, taxonomyData,
      });
      allValidatedItems.push(...pageItems);
      finalUsedModel = usedModel;
    } catch (pageError) {
      console.error(`[handler] 페이지 ${pageIndex + 1} 실패:`, pageError?.message, { sessionId });
    }
    // 메모리 해제
    imageData.imageBase64 = '';
  }

  if (allValidatedItems.length === 0) {
    await markSessionFailed(supabase, sessionId, 'extract_empty', new Error('추출된 문제 없음'));
    return;
  }

  // DB 저장
  const savedProblems = await saveProblems(supabase, sessionId, allValidatedItems);
  console.log(`[handler] ${savedProblems.length}개 문제 저장`, { sessionId });

  await saveLabels(supabase, sessionId, savedProblems, allValidatedItems, taxonomyByDepthKey);
  await updateProblemMetadata(supabase, savedProblems, allValidatedItems, userLanguage);
  await completeSession(supabase, sessionId, finalUsedModel);

  console.log(`[handler] 분석 완료: ${sessionId}`);
}

// ─── HTTP 엔트리포인트 ──────────────────────────────────────
functions.http('analyzeImage', async (req, res) => {
  setCorsHeaders(res);
  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  let sessionId;

  try {
    const validation = validateRequest(req.body);
    if (!validation.isValid) { res.status(400).json({ error: validation.error }); return; }

    const { images, userId, language } = validation;
    const userLanguage = language === 'en' ? 'en' : 'ko';
    // Vertex AI 모드: Cloud Function 서비스 계정(ADC)으로 자동 인증
    const ai = new GoogleGenAI({
      vertexai: true,
      project: VERTEX_PROJECT_ID,
      location: VERTEX_LOCATION,
    });

    console.log(`[handler] ${images.length}개 이미지 분석 시작 (userId: ${userId})`);

    const imageUrls = await uploadImages(supabase, images, userId);
    sessionId = await createSession(supabase, userId, imageUrls);
    console.log(`[handler] 세션 생성: ${sessionId}`);

    // 파이프라인을 응답 전에 완료 (Cloud Functions gen2는 응답 후 실행 보장 안 함)
    await runAnalysisPipeline(supabase, ai, sessionId, images, userLanguage);

    res.status(200).json({ success: true, sessionId });

  } catch (error) {
    console.error('[handler] 치명적 오류:', error?.message, error?.stack);
    if (supabase && sessionId) {
      const stage = error instanceof StageError ? error.stage : 'unknown';
      await markSessionFailed(supabase, sessionId, stage, error);
    }
    if (!res.headersSent) {
      res.status(500).json({ error: error?.message || '서버 내부 오류', sessionId });
    }
  }
});
