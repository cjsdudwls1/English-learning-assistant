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
 *
 * 원본: index.ts (Edge Function b6fd71be)
 */

import functions from '@google-cloud/functions-framework';
import { GoogleGenAI } from '@google/genai';
import { createClient } from '@supabase/supabase-js';

import { StageError, markSessionFailed } from './shared/errors.js';
import { VERTEX_PROJECT_ID, VERTEX_LOCATION } from './shared/config.js';
import { loadTaxonomyData, buildTaxonomyLookupMaps } from './shared/taxonomy.js';
import { cropRegions } from './shared/imageCropper.js';
import { preprocessImage } from './shared/imagePreprocessor.js';
import { executePassA, executePass0, executePassB, executePassBFullImage, executePassC, detectSubjectiveUserAnswers } from './shared/passes.js';
import { uploadImages, createSession, saveProblems, saveLabels, updateProblemMetadata, completeSession } from './shared/dbOperations.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// ─── 배치 병렬 처리 상수 ────────────────────────────────────
// 원본: index.ts ANALYSIS_BATCH_SIZE
const ANALYSIS_BATCH_SIZE = 3;

// ─── 라이프사이클 이벤트 핸들러 ─────────────────────────────
// 원본: index.ts (Edge Function의 addEventListener 대응)
process.on('unhandledRejection', (reason) => {
  console.error('[Lifecycle] Unhandled promise rejection:', reason);
});

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

// ─── Vertex AI 인증 사전 검증 ───────────────────────────────
// 원본: sessionManager.ts#validateVertexAuth

/**
 * Vertex AI 서비스계정 인증을 사전 검증한다.
 * 실패 시 세션을 'auth_failed'로 마킹하고 에러를 throw한다.
 */
async function validateVertexAuth(supabase, sessionId) {
  const serviceAccountJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!serviceAccountJson) {
    console.log('[handler] Vertex AI 인증 검증: GOOGLE_SERVICE_ACCOUNT_JSON 없음, ADC 사용');
    return;
  }

  try {
    console.log('[handler] Vertex AI 인증 사전 검증 시작...');
    const creds = JSON.parse(serviceAccountJson);
    if (!creds.client_email || !creds.private_key) {
      throw new Error('서비스계정 JSON에 client_email 또는 private_key가 없습니다');
    }
    console.log('[handler] Vertex AI 인증 검증 완료:', { clientEmail: creds.client_email });
  } catch (authError) {
    console.error('[handler] Vertex AI 인증 사전 검증 실패', {
      sessionId,
      error: authError?.message,
    });
    await markSessionFailed(supabase, sessionId, 'auth_failed', authError);
    throw authError;
  }
}

// ─── Pass B 결과 병합 (mergeHandwritingMarks) ───────────────
// 원본: pageAnalyzer.ts#mergeHandwritingMarks

/**
 * Pass B marks를 검증하고 pageItems에 병합한다.
 * - 객관식(선택지 1~5)의 경우 범위 밖이면 폐기
 * - 주관식/서술형/O/X는 자유 텍스트 허용
 * - user_answer, correct_answer, user_marked_correctness 모두 병합
 */
function mergeHandwritingMarks(pageItems, marks, sessionId) {
  if (marks.length === 0) return;

  // 진단 로그: 필터링 전 전체 marks 출력
  console.log(`[Pass B] Raw marks BEFORE filtering:`, {
    sessionId,
    marks: marks.map(m =>
      `Q${m.problem_number}: user_answer=${m.user_answer}, correct_answer=${m.correct_answer ?? 'N/A'}`
    ),
  });

  for (const mark of marks) {
    // 선택지 범위 초과 검증: 객관식인 경우만 유효한 선택지 번호(1~5) 체크
    if (mark.user_answer) {
      const ansNum = parseInt(mark.user_answer, 10);
      // 순수 숫자인데 범위 밖인 경우만 폐기 (주관식/서술형 자유 텍스트는 허용)
      if (!isNaN(ansNum) && String(ansNum) === String(mark.user_answer).trim() && (ansNum < 1 || ansNum > 5)) {
        console.log(`[Pass B] Q${mark.problem_number}: answer "${mark.user_answer}" is a number out of choice range (1-5) → discarded`);
        mark.user_answer = null;
        mark.ambiguous = true;
      }
    }
  }

  // problem_number → mark 데이터 매핑 (user_answer + correct_answer + user_marked_correctness)
  const markMap = new Map();
  for (const mark of marks) {
    markMap.set(String(mark.problem_number), {
      user_answer: mark.user_answer,
      correct_answer: mark.correct_answer || null,
      user_marked_correctness: mark.user_marked_correctness || null,
    });
  }

  for (const item of pageItems) {
    const pNum = String(item.problem_number || '');
    const match = markMap.get(pNum);
    if (match) {
      item.user_answer = match.user_answer;
      item.correct_answer = match.correct_answer;
      item.user_marked_correctness = match.user_marked_correctness;
    }
  }

  console.log(`[handler] Pass B 병합 완료: ${marks.length}개 marks`, {
    sessionId,
    mergeDetails: marks.map(m =>
      `Q${m.problem_number}: user=${m.user_answer ?? 'null'}, correct=${m.correct_answer ?? 'null'}`
    ),
  });
}

/**
 * 단일 페이지에 대한 4-Pass 분석 파이프라인 실행
 * Pass A(구조) + Pass 0(좌표) → 크롭 → Pass B(필기) → Pass C(분류)
 *
 * 원본: pageAnalyzer.ts#analyzeOnePage
 */
async function processPage({ ai, sessionId, imageData, pageNum, totalPages, taxonomyData, userLanguage }) {
  // Pass A + Pass 0 병렬 실행
  const [passAResult, pass0Result] = await Promise.all([
    executePassA({ ai, sessionId, imageBase64: imageData.imageBase64, mimeType: imageData.mimeType, pageNum, totalPages, taxonomyData }),
    executePass0({ ai, sessionId, imageBase64: imageData.imageBase64, mimeType: imageData.mimeType }),
  ]);

  const pageItems = passAResult.parsed?.items || passAResult.parsed?.problems || passAResult.parsed?.pages?.[0]?.problems || [];
  console.log(`[handler] Pass A: ${pageItems.length}개 문제 (${passAResult.model}), Pass 0: ${pass0Result.bboxes.length}개 bbox`, { sessionId });

  // Pass A 결과에서 문제 유형 판별 (객관식 vs 주관식)
  const questionContextMap = new Map();
  for (const item of pageItems) {
    const hasChoices = Array.isArray(item.choices) && item.choices.length > 0;
    const instructionText = item.instruction || '';
    const isSubjective = !hasChoices || instructionText.includes('서술형') || instructionText.includes('고쳐 쓰') || instructionText.includes('바꿔 쓰');
    questionContextMap.set(String(item.problem_number), {
      isSubjective,
      instruction: instructionText,
      questionBody: item.question_body || '',
    });
  }

  // Pass B: 크롭 기반 필기 인식 또는 전체 이미지 fallback
  let passBResult;

  if (pass0Result.bboxes.length > 0) {
    // bbox가 있으면: 서버 사이드 크롭 → Pass B 크롭 기반 분석
    try {
      const cropResult = await cropRegions(imageData.imageBase64, imageData.mimeType, pass0Result.bboxes);
      const answerAreaCrops = cropResult.answerAreaCrops;
      const fullCrops = cropResult.fullCrops;
      console.log(`[handler] 크롭: ${answerAreaCrops.length} answer + ${fullCrops.length} full`, { sessionId });

      passBResult = await executePassB({ ai, sessionId, answerAreaCrops, fullCrops, questionContextMap });
      console.log(`[handler] Pass B (크롭): ${passBResult.marks.length}개 marks (기대: ${pageItems.length}개)`, { sessionId });

      // 크롭 기반 marks가 부족하면 (fetch failed 등) 전체 이미지 fallback으로 보충
      if (passBResult.marks.length < pageItems.length) {
        console.log(`[handler] Pass B marks 부족 (${passBResult.marks.length}/${pageItems.length}), 전체 이미지 fallback 보충 시작`, { sessionId });
        const fallbackResult = await executePassBFullImage({
          ai, sessionId,
          imageBase64: imageData.imageBase64,
          mimeType: imageData.mimeType,
          totalPages,
        });
        console.log(`[handler] Pass B fallback 보충: ${fallbackResult.marks.length}개 marks`, { sessionId });

        // fallback marks를 기존에 누적 (기존 크롭 결과 우선, 누락분만 보충)
        for (const fbMark of fallbackResult.marks) {
          const existing = passBResult.marks.find(m => String(m.problem_number) === String(fbMark.problem_number));
          if (!existing) {
            passBResult.marks.push(fbMark);
          } else {
            // 기존에 user_answer가 없으면 fallback에서 보충
            if (!existing.user_answer && fbMark.user_answer) {
              existing.user_answer = fbMark.user_answer;
            }
            if (!existing.correct_answer && fbMark.correct_answer) {
              existing.correct_answer = fbMark.correct_answer;
            }
          }
        }
        console.log(`[handler] Pass B 최종 병합: ${passBResult.marks.length}개 marks`, { sessionId });
      }
    } catch (cropError) {
      // 크롭 실패 시: 전체 이미지 기반 fallback (이전 pageAnalyzer.ts:288-297 복원)
      console.error(`[handler] 크롭/Pass B 실패, 전체 이미지 fallback:`, cropError?.message, { sessionId });
      passBResult = await executePassBFullImage({
        ai, sessionId,
        imageBase64: imageData.imageBase64,
        mimeType: imageData.mimeType,
        totalPages,
      });
      console.log(`[handler] Pass B (full-image fallback): ${passBResult.marks.length}개 marks`, { sessionId });
    }
  } else {
    // bbox 0개: 전체 이미지 기반 분석 (이전 pageAnalyzer.ts:298-308 복원)
    console.log(`[handler] Pass 0: bbox 0개, 전체 이미지 fallback으로 전환`, { sessionId });
    passBResult = await executePassBFullImage({
      ai, sessionId,
      imageBase64: imageData.imageBase64,
      mimeType: imageData.mimeType,
      totalPages,
    });
    console.log(`[handler] Pass B (full-image fallback): ${passBResult.marks.length}개 marks`, { sessionId });
  }

  // Pass B 결과 병합: 원본 mergeHandwritingMarks 방식으로 검증 + 병합
  // 먼저 pageItems의 user_answer/correct_answer/user_marked_correctness를 null로 초기화
  for (const item of pageItems) {
    item.user_answer = null;
    item.user_marked_correctness = null;
    item.correct_answer = null;
  }
  mergeHandwritingMarks(pageItems, passBResult.marks, sessionId);

  // Subjective questions: full-image based user_answer detection (overrides crop-based results)
  const subjectiveProblems = [];
  for (const [pNum, ctx] of questionContextMap) {
    if (ctx.isSubjective) {
      subjectiveProblems.push({ problem_number: pNum, instruction: ctx.instruction, questionBody: ctx.questionBody });
    }
  }
  if (subjectiveProblems.length > 0) {
    console.log(`[handler] 주관식 ${subjectiveProblems.length}개 문제 → 전체 이미지 기반 user_answer 감지`, { sessionId });
    const subjectiveResult = await detectSubjectiveUserAnswers({
      ai, sessionId,
      imageBase64: imageData.imageBase64, mimeType: imageData.mimeType,
      subjectiveProblems,
    });
    for (const mark of subjectiveResult.marks) {
      const item = pageItems.find(it => String(it.problem_number) === String(mark.problem_number));
      if (item && mark.user_answer != null) {
        item.user_answer = mark.user_answer;
      }
    }
  }

  // Pass C: 분류 (visual_context가 있으면 이미지도 전달)
  const passCResult = await executePassC({
    ai, sessionId, taxonomyData, pageItems, userLanguage,
    imageBase64: imageData.imageBase64, mimeType: imageData.mimeType,
  });
  console.log(`[handler] Pass C: ${passCResult.classifications.length}개 분류`, { sessionId });
  for (const cls of passCResult.classifications) {
    const matchedItem = pageItems.find(item => String(item.problem_number) === String(cls.problem_number));
    if (matchedItem) {
      matchedItem.classification = cls.classification;
      matchedItem.metadata = cls.metadata;
      // correct_answer는 Pass B에서 설정된 값을 보존
    }
  }

  return { pageItems, usedModel: passAResult.model };
}

/**
 * 백그라운드 분석 파이프라인 (응답 전송 후 실행)
 *
 * 원본: index.ts 백그라운드 작업 블록
 */
async function runAnalysisPipeline(supabase, ai, sessionId, images, userLanguage) {
  console.log(`[handler] 백그라운드 분석 시작: ${images.length}개 이미지`, { sessionId });

  // Vertex AI 인증 사전 검증
  await validateVertexAuth(supabase, sessionId);

  // Taxonomy 데이터 로드
  const taxonomyData = await loadTaxonomyData(supabase);
  const { taxonomyByDepthKey, taxonomyByCode } = await buildTaxonomyLookupMaps(supabase, userLanguage, sessionId);

  let allValidatedItems = [];
  let finalUsedModel = '';

  // 배치 병렬 처리 (batch_size=3)
  // 원본: index.ts ANALYSIS_BATCH_SIZE
  for (let batchStart = 0; batchStart < images.length; batchStart += ANALYSIS_BATCH_SIZE) {
    const batchEnd = Math.min(batchStart + ANALYSIS_BATCH_SIZE, images.length);
    const batchIndices = Array.from({ length: batchEnd - batchStart }, (_, i) => batchStart + i);

    console.log(`[handler] 배치 처리 (페이지 ${batchStart + 1}-${batchEnd})...`, { sessionId });

    const batchResults = await Promise.all(batchIndices.map(async (idx) => {
      const imageData = images[idx];
      try {
        // 서버 측 이미지 전처리: 긴 변 1200px + JPEG 80%로 리사이즈
        const { imageBase64: resizedBase64, mimeType: resizedMimeType } = await preprocessImage(
          imageData.imageBase64, imageData.mimeType
        );
        imageData.imageBase64 = resizedBase64;
        imageData.mimeType = resizedMimeType;

        const { pageItems, usedModel } = await processPage({
          ai, sessionId, imageData, pageNum: idx + 1, totalPages: images.length, taxonomyData, userLanguage,
        });
        return { pageItems, usedModel };
      } catch (pageError) {
        console.error(`[handler] 페이지 ${idx + 1} 실패:`, pageError?.message, { sessionId });
        return null;
      }
    }));

    for (const result of batchResults) {
      if (!result) continue;
      allValidatedItems.push(...result.pageItems);
      finalUsedModel = result.usedModel;
    }

    // 분석 완료된 페이지의 이미지 메모리 해제
    for (const idx of batchIndices) {
      if (images[idx]) images[idx].imageBase64 = '';
    }
  }

  if (allValidatedItems.length === 0) {
    if (images.length > 0) {
      console.error(`[handler] ${images.length}개 페이지에서 0문항 추출됨`, { sessionId, usedModel: finalUsedModel });
    }
    await markSessionFailed(supabase, sessionId, 'extract_empty', new Error('추출된 문제 없음'));
    return;
  }

  console.log(`[handler] 전체 분석 완료: ${allValidatedItems.length}개 문항`, { sessionId, usedModel: finalUsedModel });

  // DB 저장
  const savedProblems = await saveProblems(supabase, sessionId, allValidatedItems);

  if (!savedProblems || savedProblems.length === 0) {
    console.error(`[handler] 0문제 저장됨, 세션 실패 처리`, { sessionId });
    await markSessionFailed(supabase, sessionId, 'insert_problems', new Error('Inserted 0 problems'));
    return;
  }

  console.log(`[handler] ${savedProblems.length}개 문제 저장`, { sessionId });

  // Labels 저장 (taxonomy 보강 포함) — 실패 시 StageError throw
  await saveLabels(supabase, sessionId, savedProblems, allValidatedItems, taxonomyByDepthKey, taxonomyByCode);

  // 메타데이터 업데이트
  await updateProblemMetadata(supabase, savedProblems, allValidatedItems, userLanguage);

  // 세션 완료 (labeled 상태 가드 포함)
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

    // ── 언어 설정: 프론트엔드 전달값 → DB profiles → 기본값 'ko' ──
    // 원본: index.ts:81-93
    let userLanguage = language === 'en' ? 'en' : 'ko';

    if (!language) {
      try {
        const { data: profile } = await supabase
          .from('profiles')
          .select('language')
          .eq('user_id', userId)
          .single();

        if (profile?.language === 'ko' || profile?.language === 'en') {
          userLanguage = profile.language;
        }
      } catch (profileError) {
        console.warn('[handler] 프로필 언어 조회 실패, 기본값 ko 사용:', profileError?.message);
      }
    }

    // Vertex AI 모드: 서비스계정 JSON 키로 인증
    const serviceAccountJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
    const aiOptions = {
      vertexai: true,
      project: VERTEX_PROJECT_ID,
      location: VERTEX_LOCATION,
    };
    if (serviceAccountJson) {
      try {
        aiOptions.googleAuthOptions = { credentials: JSON.parse(serviceAccountJson) };
        console.log('[handler] Vertex AI: 서비스계정 JSON 키 인증 사용');
      } catch (e) {
        console.error('[handler] GOOGLE_SERVICE_ACCOUNT_JSON 파싱 실패, ADC 폴백:', e.message);
      }
    }
    const ai = new GoogleGenAI(aiOptions);

    console.log(`[handler] ${images.length}개 이미지 분석 시작 (userId: ${userId}, language: ${userLanguage})`);

    const imageUrls = await uploadImages(supabase, images, userId);
    sessionId = await createSession(supabase, userId, imageUrls);
    console.log(`[handler] 세션 생성: ${sessionId}`);

    // 파이프라인을 응답 전에 완료하지 않고, 세션 생성 후 즉시 응답 반환
    // Cloud Functions gen2는 응답 후에도 인스턴스가 바로 종료되지 않으므로 파이프라인 계속 실행됨
    res.status(200).json({ success: true, sessionId });

    // fire-and-forget: 에러 발생 시 DB에 기록
    runAnalysisPipeline(supabase, ai, sessionId, images, userLanguage).catch(async (pipelineError) => {
      console.error('[handler] 백그라운드 파이프라인 오류:', pipelineError?.message, { sessionId });
      try {
        const stage = pipelineError instanceof StageError ? pipelineError.stage : 'unknown';
        await markSessionFailed(supabase, sessionId, stage, pipelineError);
      } catch (failError) {
        console.error('[handler] markSessionFailed 실패:', failError?.message, { sessionId });
      }
    });

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
