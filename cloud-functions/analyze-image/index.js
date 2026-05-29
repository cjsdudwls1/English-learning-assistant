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

import { StageError, markSessionFailed, parseModelError } from './shared/errors.js';
import { VERTEX_PROJECT_ID, VERTEX_LOCATION, CORRECT_SOURCE } from './shared/config.js';
import { loadTaxonomyData, buildTaxonomyLookupMaps } from './shared/taxonomy.js';
import { preprocessImage } from './shared/imagePreprocessor.js';
import { processPage } from './shared/processPage.js';
import { uploadImages, createSession, saveProblems, saveLabels, finalizeAnalysisSession } from './shared/dbOperations.js';
import { downloadImagesFromStorage } from './shared/imageDownloader.js';
import { generateAllProblemTypes } from './shared/generateProblems.js';
import { verifySupabaseJWT } from './shared/jwtVerify.js';
import { publishAnalyzeJob, decodeAnalyzeJob } from './shared/pubsub.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

// ─── AI Provider 가용성 검사 ────────────────────────────────
// 프론트엔드에서 선택한 aiProvider/aiModel을 받아 API 키 존재 여부로 가용성을 판정한다.
// 키가 비어 있으면 503 + code='provider_unavailable' 응답 → 프론트엔드가 "서비스 준비중입니다" 표시.
//
// Gemini(Vertex): 기존 GOOGLE_SERVICE_ACCOUNT_JSON 또는 ADC가 있으면 항상 동작.
// OpenAI: OPENAI_API_KEY 필요. (실제 호출 로직은 키 확보 후 별도 PR로 추가)
// Claude: ANTHROPIC_API_KEY 필요. (실제 호출 로직은 키 확보 후 별도 PR로 추가)
const SUPPORTED_PROVIDERS = ['gemini', 'openai', 'claude'];
const DEFAULT_PROVIDER = 'gemini';

function checkProviderAvailability(provider) {
  if (provider === 'openai') {
    const hasKey = !!(process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY.trim());
    return { available: hasKey, reason: hasKey ? null : 'OPENAI_API_KEY 미설정' };
  }
  if (provider === 'claude') {
    const hasKey = !!(process.env.ANTHROPIC_API_KEY && process.env.ANTHROPIC_API_KEY.trim());
    return { available: hasKey, reason: hasKey ? null : 'ANTHROPIC_API_KEY 미설정' };
  }
  // gemini는 기존 Vertex AI 자격증명 흐름 그대로 사용
  return { available: true, reason: null };
}

// ─── 배치 병렬 처리 상수 ────────────────────────────────────
// 원본: index.ts ANALYSIS_BATCH_SIZE (3→5: 5장 업로드 시 단일 배치로 처리)
const ANALYSIS_BATCH_SIZE = 5;

// 워치독: GCF 540s 타임아웃 전 470s에 self-abort + markSessionFailed
// - 540s - 470s = 70s 여유: markSessionFailed(10s timeout) + SIGTERM grace(10s) + DB 응답 지연 버퍼
const PIPELINE_WATCHDOG_MS = 470_000;

// in-flight 세션 추적: SIGTERM 시 일괄 markSessionFailed
const inFlightSessions = new Map();

// ─── 라이프사이클 이벤트 핸들러 ─────────────────────────────
// 원본: index.ts (Edge Function의 addEventListener 대응)
process.on('unhandledRejection', (reason) => {
  console.error('[Lifecycle] Unhandled promise rejection:', reason);
});

/**
 * GCF Gen2 인스턴스 종료 시그널: timeout/scale-down 직전 in-flight 세션을 failed로 마킹.
 * SIGTERM grace period(기본 10s) 내에 동기적으로 처리해야 좀비 세션 차단 가능.
 */
async function flushInFlightOnTerminate(reason) {
  if (inFlightSessions.size === 0) return;
  console.warn(`[Lifecycle] ${reason} 수신, in-flight ${inFlightSessions.size}개 세션 마킹 시작`);
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  await Promise.allSettled([...inFlightSessions.entries()].map(async ([sid, ctx]) => {
    try {
      ctx.abortCtrl?.abort();
      await markSessionFailed(supabase, sid, 'sigterm', new Error(`GCF 인스턴스 ${reason}`));
    } catch (e) {
      console.error('[Lifecycle] SIGTERM 마킹 실패:', sid, e?.message);
    }
  }));
  inFlightSessions.clear();
}

process.on('SIGTERM', () => { flushInFlightOnTerminate('SIGTERM').catch(() => {}); });
process.on('SIGINT', () => { flushInFlightOnTerminate('SIGINT').catch(() => {}); });

function setCorsHeaders(res) {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

function validateRequest(body) {
  const { imagePaths, images, userId } = body || {};
  if (!userId) {
    return { isValid: false, error: 'userId가 필요합니다.' };
  }

  // AI provider/model: 미지정 시 기본값(gemini)로 폴백. 지원 외 provider는 거절.
  let aiProvider = (body?.aiProvider || DEFAULT_PROVIDER).toString();
  if (!SUPPORTED_PROVIDERS.includes(aiProvider)) {
    return { isValid: false, error: `지원하지 않는 aiProvider: ${aiProvider}` };
  }
  const aiModel = body?.aiModel ? body.aiModel.toString() : null;

  // 신규 (Direct Upload): imagePaths[]만 받음 — base64 페이로드 미경유
  if (Array.isArray(imagePaths) && imagePaths.length > 0) {
    const MAX_IMAGES = 10;
    if (imagePaths.length > MAX_IMAGES) {
      return { isValid: false, error: `imagePaths는 최대 ${MAX_IMAGES}개까지 허용됩니다.` };
    }
    for (const p of imagePaths) {
      if (typeof p !== 'string' || !p.trim()) {
        return { isValid: false, error: 'imagePaths 항목은 비어있지 않은 문자열이어야 합니다.' };
      }
      // path traversal 차단 + bucket prefix 검증
      if (p.includes('..') || p.startsWith('/') || p.startsWith('\\')) {
        return { isValid: false, error: '잘못된 imagePath 형식입니다.' };
      }
      // RLS와 동일한 prefix 가드 (Service Role은 RLS 우회하므로 여기서 검증)
      const firstSegment = p.split('/')[0];
      if (firstSegment !== userId) {
        return { isValid: false, error: 'imagePath의 user 폴더가 userId와 일치하지 않습니다.' };
      }
    }
    return { isValid: true, imagePaths, userId, language: body.language, aiProvider, aiModel };
  }
  // 레거시 (base64 inline): images[]
  if (Array.isArray(images) && images.length > 0) {
    return { isValid: true, images, userId, language: body.language, aiProvider, aiModel };
  }
  return { isValid: false, error: 'imagePaths[] 또는 images[]가 필요합니다.' };
}

async function authenticateRequest(req) {
  if (!SUPABASE_ANON_KEY) {
    return { ok: false, status: 500, error: 'SUPABASE_ANON_KEY 환경변수가 없습니다' };
  }
  const jwtResult = await verifySupabaseJWT(req.get('authorization'), SUPABASE_URL, SUPABASE_ANON_KEY);
  if (!jwtResult.valid) {
    console.warn('[analyze-image] JWT 검증 실패:', jwtResult.error);
    return { ok: false, status: 401, error: 'Unauthorized: ' + jwtResult.error };
  }
  const bodyUserId = req.body?.userId;
  if (bodyUserId && bodyUserId !== jwtResult.userId) {
    console.warn(`[analyze-image] userId 불일치: body=${bodyUserId}, jwt=${jwtResult.userId}`);
    return { ok: false, status: 403, error: 'Forbidden: userId does not match token' };
  }
  return { ok: true, userId: jwtResult.userId };
}

function buildAIClient() {
  const serviceAccountJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  const aiOptions = {
    vertexai: true,
    project: VERTEX_PROJECT_ID,
    location: VERTEX_LOCATION,
  };
  if (serviceAccountJson) {
    try {
      aiOptions.googleAuthOptions = { credentials: JSON.parse(serviceAccountJson) };
    } catch (e) {
      console.error('[handler] GOOGLE_SERVICE_ACCOUNT_JSON 파싱 실패, ADC 폴백:', e.message);
    }
  }
  return new GoogleGenAI(aiOptions);
}

async function handleGenerateAll(req, res) {
  if (!SUPABASE_ANON_KEY) {
    res.status(500).json({ error: 'SUPABASE_ANON_KEY 환경변수가 없습니다' });
    return;
  }

  const jwtResult = await verifySupabaseJWT(req.get('authorization'), SUPABASE_URL, SUPABASE_ANON_KEY);
  if (!jwtResult.valid) {
    console.warn('[generate-all] JWT 검증 실패:', jwtResult.error);
    res.status(401).json({ error: 'Unauthorized: ' + jwtResult.error });
    return;
  }

  const body = req.body || {};
  const { types, userId, language, classification, ...aiOptions } = body;

  if (userId !== jwtResult.userId) {
    console.warn(`[generate-all] userId 불일치: body=${userId}, jwt=${jwtResult.userId}`);
    res.status(403).json({ error: 'Forbidden: userId does not match token' });
    return;
  }

  if (!Array.isArray(types) || types.length === 0) {
    res.status(400).json({ error: 'types[] 가 비어있거나 유효하지 않습니다' });
    return;
  }
  for (const t of types) {
    if (!t.problemType || typeof t.problemCount !== 'number' || t.problemCount <= 0 || t.problemCount > 50) {
      res.status(400).json({ error: `유효하지 않은 type 항목: ${JSON.stringify(t)}` });
      return;
    }
  }
  if (!language || (language !== 'ko' && language !== 'en')) {
    res.status(400).json({ error: 'language는 ko 또는 en 이어야 합니다' });
    return;
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const ai = buildAIClient();
  const sessionId = `gen-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  res.status(200).json({ success: true, sessionId, message: '백그라운드 생성 시작' });

  generateAllProblemTypes(supabase, ai, { userId, language, classification, types, ...aiOptions }, sessionId)
    .catch((err) => {
      console.error('[generate-all] 백그라운드 오류:', err?.message, { sessionId, userId });
    });
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

// mergeHandwritingMarks, processPage → shared/processPage.js로 추출 (eval/prod 단일 소스화)

/**
 * 페이지 경계에서 발생하는 중복 problem_number 제거
 * - "[41~42] 다음 글을 읽고…" 같은 범위 지문 헤더가 다음(이어지는) 페이지에서
 *   선택지·본문·답이 전부 빈 껍데기 문항으로 재추출되는 노이즈를 차단한다.
 * - 같은 problem_number가 둘 이상이면 "실질 점수"(선택지>본문/지문>답>지시문)가
 *   가장 높은 항목만 남기고, 버리는 쪽의 답/지문 필드는 남는 항목에 결손 보충한다
 *   (페이지가 갈리며 한쪽에만 들어간 필기 마크/지문 유실 방지).
 * - 등장 순서(페이지 순서)는 보존한다. saveProblems/saveLabels가 배열 인덱스로
 *   매칭하므로 본 함수는 두 호출 이전에 단 한 번만 적용해야 한다.
 */
function dedupeProblemItems(items, sessionId) {
  const substanceScore = (it) => {
    const choices = Array.isArray(it.choices) ? it.choices.length : 0;
    const hasAns = (it.correct_answer != null && String(it.correct_answer).trim() !== '')
      || (it.user_answer != null && String(it.user_answer).trim() !== '');
    const hasBody = !!(it.question_body && String(it.question_body).trim())
      || !!(it.passage && String(it.passage).trim())
      || !!(it.shared_passage_ref && String(it.shared_passage_ref).trim());
    const hasInstr = !!(it.instruction && String(it.instruction).trim());
    return choices * 10 + (hasAns ? 5 : 0) + (hasBody ? 2 : 0) + (hasInstr ? 1 : 0);
  };

  // 버리는 항목의 비어있지 않은 답/지문 필드를 남는 항목의 결손에 보충
  const backfill = (keep, drop) => {
    for (const f of ['user_answer', 'correct_answer', 'user_marked_correctness', 'passage', 'shared_passage_ref', 'question_body']) {
      const cur = keep[f];
      const curEmpty = cur == null || (typeof cur === 'string' && cur.trim() === '');
      if (curEmpty && drop[f] != null && String(drop[f]).trim() !== '') keep[f] = drop[f];
    }
  };

  const byNum = new Map(); // problem_number → 채택된 item
  const order = [];
  let droppedCount = 0;
  for (const it of items) {
    const key = String(it.problem_number ?? '').trim();
    if (!key) { order.push(it); continue; } // 번호 없는 항목은 그대로 보존
    if (!byNum.has(key)) {
      byNum.set(key, it);
      order.push(it);
      continue;
    }
    const prev = byNum.get(key);
    droppedCount++;
    if (substanceScore(it) > substanceScore(prev)) {
      backfill(it, prev); // 새 항목 채택, 이전 항목 정보 보충 후 자리 교체
      const idx = order.indexOf(prev);
      if (idx >= 0) order[idx] = it;
      byNum.set(key, it);
    } else {
      backfill(prev, it); // 이전 항목 유지, 새 항목 정보 보충
    }
  }
  if (droppedCount > 0) {
    console.log(`[handler] 중복 problem_number 제거: ${items.length} → ${order.length} (${droppedCount}개 병합)`, { sessionId });
  }
  return order;
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
          correctSource: CORRECT_SOURCE, // 기본 'crop'(행위보존). env CORRECT_SOURCE=fullpage 로 비용 -25% 경로.
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

  // 페이지 경계 중복 problem_number 제거 (예: [41~42] 범위 헤더가 이어지는
  // 페이지에서 빈 껍데기로 재추출되는 노이즈 차단)
  allValidatedItems = dedupeProblemItems(allValidatedItems, sessionId);

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

  // 메타데이터 + 세션 완료를 단일 트랜잭션 RPC로 atomic 처리 (25P02 cascade 차단)
  await finalizeAnalysisSession(supabase, sessionId, finalUsedModel, savedProblems, allValidatedItems, userLanguage);

  console.log(`[handler] 분석 완료: ${sessionId}`);
}

// ─── HTTP 엔트리포인트 ──────────────────────────────────────
functions.http('analyzeImage', async (req, res) => {
  setCorsHeaders(res);
  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  if (req.query?.warmup === '1') {
    // keep-warm 핑(Cloud Scheduler): DB/AI 미접근·즉시 200이라 인증 불필요.
    // Supabase JWT 검증을 걸면 Scheduler가 사용자 토큰을 보낼 수 없어 매 핑마다 401 →
    // 콜드스타트 방지 무효 + 로그 노이즈 + alert 오발동. 빈 200만 반환하므로 익명 spike도 quota 미소진.
    // (실제 분석/generate-all 경로는 아래에서 여전히 JWT 필수)
    res.status(200).json({ ok: true, warmup: true });
    return;
  }

  if (req.body?.mode === 'generate-all') {
    await handleGenerateAll(req, res);
    return;
  }

  // JWT 검증 + userId 일치 가드 (악의적 호출로 quota 소진 방지)
  const authResult = await authenticateRequest(req);
  if (!authResult.ok) {
    res.status(authResult.status).json({ error: authResult.error });
    return;
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  let sessionId;

  try {
    const validation = validateRequest(req.body);
    if (!validation.isValid) { res.status(400).json({ error: validation.error }); return; }

    const { imagePaths, images, userId, language, aiProvider, aiModel } = validation;

    // Provider 가용성 가드: API 키 미설정 시 503 + code='provider_unavailable'
    // 프론트엔드는 이 코드를 받으면 "서비스 준비중입니다" 메시지로 표시한다.
    const availability = checkProviderAvailability(aiProvider);
    if (!availability.available) {
      console.warn(`[analyze-image] provider 미가용: ${aiProvider} (${availability.reason})`);
      res.status(503).json({
        error: '서비스 준비중입니다.',
        code: 'provider_unavailable',
        provider: aiProvider,
      });
      return;
    }

    const useDirectUpload = Array.isArray(imagePaths) && imagePaths.length > 0;
    const imageCount = useDirectUpload ? imagePaths.length : images.length;

    if (userId !== authResult.userId) {
      res.status(403).json({ error: 'Forbidden: userId does not match token' });
      return;
    }

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

    const ai = buildAIClient();

    console.log(`[handler] ${imageCount}개 이미지 분석 시작 (userId: ${userId}, language: ${userLanguage}, mode: ${useDirectUpload ? 'direct-upload' : 'legacy-inline'})`);

    // Direct Upload 경로: image_urls 컬럼에 storage path 그대로 저장.
    // C7 fix v2: bucket private + signed URL 영구 저장 시 24h 만료 → history 깨짐.
    // frontend가 표시 시점에 createSignedUrl로 변환하도록 책임 이관 (utils/imageUrl.ts).
    const initialImageUrls = useDirectUpload ? imagePaths : [];
    sessionId = await createSession(supabase, userId, initialImageUrls);
    console.log(`[handler] 세션 생성: ${sessionId}`);

    if (useDirectUpload) {
      // ── Phase 3 아키텍처: Pub/Sub 큐 게재 → analyze-worker가 처리 ──
      // 장점: analyze-image는 가벼운 publish만 수행 → max-instances 작게 유지, 안정적 throughput
      try {
        await publishAnalyzeJob({ sessionId, userId, imagePaths, userLanguage, aiProvider, aiModel });
      } catch (publishError) {
        console.error('[handler] Pub/Sub publish 실패:', publishError?.message, { sessionId });
        await markSessionFailed(supabase, sessionId, 'pubsub_publish', publishError);
        res.status(500).json({ error: 'Pub/Sub publish 실패', sessionId });
        return;
      }
      res.status(200).json({ success: true, sessionId, queued: true });
      return;
    }

    // ── 레거시 inline base64 경로: 기존 in-process 백그라운드 처리 유지 ──
    // (Pub/Sub message는 10MB 제한이라 base64 페이로드를 옮길 수 없음)
    res.status(200).json({ success: true, sessionId });

    const abortCtrl = new AbortController();
    const watchdog = setTimeout(async () => {
      console.error(`[handler] 워치독 타임아웃 (${PIPELINE_WATCHDOG_MS}ms): self-abort + markSessionFailed`, { sessionId });
      abortCtrl.abort();
      try {
        await markSessionFailed(supabase, sessionId, 'watchdog_timeout', new Error('파이프라인 워치독 초과'));
      } catch (e) {
        console.error('[handler] 워치독 markSessionFailed 실패:', e?.message, { sessionId });
      }
    }, PIPELINE_WATCHDOG_MS);

    inFlightSessions.set(sessionId, { abortCtrl, startedAt: Date.now() });

    (async () => {
      try {
        const legacyUrls = await uploadImages(supabase, images, userId);
        const { error: updateError } = await supabase
          .from('sessions')
          .update({ image_urls: legacyUrls })
          .eq('id', sessionId);
        if (updateError) {
          console.warn('[handler] image_urls 업데이트 실패 (분석은 계속):', updateError?.message, { sessionId });
        }
        await runAnalysisPipeline(supabase, ai, sessionId, images, userLanguage);
      } catch (pipelineError) {
        if (abortCtrl.signal.aborted) {
          console.warn('[handler] 파이프라인 abort됨 (워치독/SIGTERM):', pipelineError?.message, { sessionId });
        } else {
          console.error('[handler] 백그라운드 파이프라인 오류:', pipelineError?.message, { sessionId });
          try {
            const stage = pipelineError instanceof StageError ? pipelineError.stage : 'unknown';
            await markSessionFailed(supabase, sessionId, stage, pipelineError);
          } catch (failError) {
            console.error('[handler] markSessionFailed 실패:', failError?.message, { sessionId });
          }
        }
      } finally {
        clearTimeout(watchdog);
        inFlightSessions.delete(sessionId);
      }
    })();

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

// ─── Pub/Sub Worker 엔트리포인트 (Phase 3) ──────────────────
// gcloud functions deploy analyze-worker --entry-point=analyzeWorker --trigger-topic=analyze-jobs
//
// Pub/Sub 메시지: { sessionId, userId, imagePaths, userLanguage }
// 1) imagePaths → Storage 다운로드 → base64
// 2) runAnalysisPipeline (Pass A/0/B/C → DB 저장 → finalizeAnalysisSession)
// 3) 워치독 470s + abort + markSessionFailed
//
// Worker가 throw하면 Pub/Sub가 재시도 (메시지 ack 안 함) — at-least-once delivery
// 중복 방지: 세션 status='completed' 또는 'failed'면 worker가 즉시 ack 후 종료
functions.cloudEvent('analyzeWorker', async (cloudEvent) => {
  let payload;
  try {
    payload = decodeAnalyzeJob(cloudEvent.data?.message);
  } catch (decodeError) {
    console.error('[worker] payload 디코드 실패 (메시지 폐기):', decodeError?.message);
    return; // ack — 재시도해도 같은 메시지라 무한 루프 방지
  }
  const { sessionId, userId, imagePaths, userLanguage, aiProvider, aiModel } = payload;
  const provider = aiProvider || DEFAULT_PROVIDER;
  console.log(`[worker] 작업 시작: sessionId=${sessionId}, userId=${userId}, images=${imagePaths.length}, lang=${userLanguage}, provider=${provider}, model=${aiModel || 'default'}`);

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // Worker 측 provider 재검증: publish 이후 키가 회수되었을 수 있어 fail-fast.
  // 키가 없으면 세션을 failed로 마킹하고 ack (재시도 무의미)
  const availability = checkProviderAvailability(provider);
  if (!availability.available) {
    console.warn(`[worker] provider 미가용 (${provider}: ${availability.reason}) → 세션 failed`, { sessionId });
    try {
      await markSessionFailed(supabase, sessionId, 'provider_unavailable', new Error(`${provider} 서비스 준비중입니다.`));
    } catch (e) {
      console.error('[worker] provider_unavailable markSessionFailed 실패:', e?.message, { sessionId });
    }
    return;
  }

  // ── C1 fix v4: atomic CAS 멱등성 (단일 status .eq 매치) ──
  // 1) 사전 SELECT: orphan/completed/failed 조기 ack + lease 만료 판정 (정보 채집)
  // 2) atomic CAS: UPDATE ... WHERE id=? AND status=<expected>
  //    - expected = 'pending' (정상 케이스) 또는 'processing' (lease 만료 시 takeover)
  //    - 두 worker가 동시 도착해도 PostgreSQL의 UPDATE row-level lock으로 한 명만 성공
  //    - PostgREST의 nested or(and(...)) 문법은 timestamp 인코딩 등에서 fragile → 단순 .eq()로 회피
  const nowISO = new Date().toISOString();
  let expectedStatus = 'pending';
  try {
    const { data: existing, error: selectErr } = await supabase
      .from('sessions')
      .select('status, updated_at')
      .eq('id', sessionId)
      .maybeSingle();
    if (selectErr) {
      console.warn('[worker] 세션 status 사전 조회 실패 (pending 가정으로 계속):', selectErr.message, { sessionId });
    } else if (!existing) {
      console.warn(`[worker] session row 없음 → orphan message ack`, { sessionId });
      return;
    } else if (existing.status === 'completed' || existing.status === 'failed') {
      console.warn(`[worker] 세션이 이미 ${existing.status} 상태: ack 후 종료`, { sessionId });
      return;
    } else if (existing.status === 'processing') {
      const ageMs = existing.updated_at ? (Date.now() - new Date(existing.updated_at).getTime()) : 0;
      if (ageMs < 8 * 60 * 1000) {
        console.warn(`[worker] 다른 worker가 ${Math.round(ageMs/1000)}s 전 처리 중 (lease 8m): ack 후 종료`, { sessionId });
        return;
      }
      // lease 만료 → takeover 시도
      expectedStatus = 'processing';
      console.warn(`[worker] lease 만료 (${Math.round(ageMs/1000)}s) → takeover 시도`, { sessionId });
    }
  } catch (selectError) {
    console.warn('[worker] 세션 status 사전 조회 예외 (pending 가정으로 계속):', selectError?.message, { sessionId });
  }

  try {
    const { data: leased, error: leaseErr } = await supabase
      .from('sessions')
      .update({ status: 'processing', updated_at: nowISO })
      .eq('id', sessionId)
      .eq('status', expectedStatus)
      .select('id');
    if (leaseErr) {
      console.error('[worker] CAS lease 시도 실패 (transient → Pub/Sub retry):', leaseErr.message, { sessionId });
      throw new StageError('lease_cas_failed', leaseErr);
    }
    if (!leased || leased.length === 0) {
      console.warn(`[worker] CAS lease 실패 (expected=${expectedStatus}): 다른 worker가 status 변경. ack 후 종료`, { sessionId });
      return;
    }
    console.log('[worker] CAS lease 획득', { sessionId, expectedStatus });
  } catch (leaseException) {
    if (leaseException instanceof StageError) throw leaseException;
    console.error('[worker] CAS lease 예외 (transient → Pub/Sub retry):', leaseException?.message, { sessionId });
    throw new StageError('lease_cas_exception', leaseException);
  }

  const abortCtrl = new AbortController();
  const watchdog = setTimeout(async () => {
    console.error(`[worker] 워치독 타임아웃 (${PIPELINE_WATCHDOG_MS}ms): self-abort + markSessionFailed`, { sessionId });
    abortCtrl.abort();
    try {
      await markSessionFailed(supabase, sessionId, 'watchdog_timeout', new Error('Worker 파이프라인 워치독 초과'));
    } catch (e) {
      console.error('[worker] 워치독 markSessionFailed 실패:', e?.message, { sessionId });
    }
  }, PIPELINE_WATCHDOG_MS);

  inFlightSessions.set(sessionId, { abortCtrl, startedAt: Date.now() });

  try {
    // C1 fix: validateVertexAuth를 try 블록 안으로 이동 — 인증 실패는 영구 결함이므로 markSessionFailed + ack
    await validateVertexAuth(supabase, sessionId);
    const ai = buildAIClient();
    const pipelineImages = await downloadImagesFromStorage(supabase, imagePaths, sessionId);
    await runAnalysisPipeline(supabase, ai, sessionId, pipelineImages, userLanguage);
    console.log(`[worker] 완료: ${sessionId}`);
  } catch (pipelineError) {
    if (abortCtrl.signal.aborted) {
      console.warn('[worker] 파이프라인 abort됨:', pipelineError?.message, { sessionId });
      // abort는 영구 — markSessionFailed 이미 워치독에서 처리
      return;
    }
    console.error('[worker] 파이프라인 오류:', pipelineError?.message, { sessionId });
    const stage = pipelineError instanceof StageError ? pipelineError.stage : 'unknown';

    // C1 fix: transient error는 throw → Pub/Sub exponential backoff 재시도 활용
    // (rate_limit / server_overload / timeout — 단기 인프라 결함)
    // permanent error는 markSessionFailed + ack
    const parsed = parseModelError(pipelineError);
    const isTransient = parsed.isRateLimit || parsed.isServerOverload || parsed.isTimeout;

    if (isTransient) {
      console.warn('[worker] transient error → Pub/Sub retry로 위임:', { sessionId, stage, ...parsed });
      throw pipelineError; // NACK → Pub/Sub가 exponential backoff로 재시도
    }

    try {
      await markSessionFailed(supabase, sessionId, stage, pipelineError);
    } catch (failError) {
      console.error('[worker] markSessionFailed 실패:', failError?.message, { sessionId });
    }
    // permanent error는 throw하지 않음 → ack
  } finally {
    clearTimeout(watchdog);
    inFlightSessions.delete(sessionId);
  }
});
