/**
 * analyze-image: Cloud Functions gen2 메인 핸들러
 *
 * 전체 이미지 분석 파이프라인을 서버에서 수행:
 * Extract → Crop → Detect → Classify → DB 저장
 *
 * 런타임: Node.js 22 (ESM)
 *
 * ── 이 파일은 서비스 두 개를 export한다. 설정이 서로 다르다 ──────────────
 *   analyzeImage (publisher, deploy-image.ps1)  : timeout 300s, cpu 1, **cpu-throttling ON**
 *   analyzeWorker(worker,    deploy-worker.ps1) : timeout 540s, cpu 2, cpu-throttling OFF(+boost)
 *
 * 이 구분이 중요한 이유: publisher는 스로틀 상태라 **응답을 flush한 뒤의 백그라운드 작업에
 * CPU가 할당되지 않는다.** 오래 걸리는 일은 Pub/Sub로 worker에 넘기거나(분석 파이프라인),
 * 요청 안에서 끝내야 한다(에이전트 루프 — handleAgentRun 주석 참조).
 * "이 함수는 600초"라고 적혀 있던 옛 주석이 정확히 이 함정이었다.
 *
 * 원본: index.ts (Edge Function b6fd71be)
 */

import functions from '@google-cloud/functions-framework';
import { GoogleGenAI } from '@google/genai';
import { createClient } from '@supabase/supabase-js';

import { StageError, markSessionFailed, parseModelError } from './shared/errors.js';
import { VERTEX_PROJECT_ID, VERTEX_LOCATION, CORRECT_SOURCE, SIMPLE_PIPELINE, SPLIT_PIPELINE, isAgentEnabled } from './shared/config.js';
import { loadTaxonomyData, buildTaxonomyLookupMaps } from './shared/taxonomy.js';
import { preprocessImage } from './shared/imagePreprocessor.js';
import { processPage } from './shared/processPage.js';
import { runSimpleExtractAndStructure } from './shared/simplePipeline.js';
import { runSplitPipeline } from './shared/splitPipeline.js';
import { uploadImages, createSession, saveProblems, saveLabels, finalizeAnalysisSession } from './shared/dbOperations.js';
import { downloadImagesFromStorage } from './shared/imageDownloader.js';
import { generateAllProblemTypes } from './shared/generateProblems.js';
import { verifySupabaseJWT } from './shared/jwtVerify.js';
import { publishAnalyzeJob, decodeAnalyzeJob } from './shared/pubsub.js';
import { dedupeProblemItems } from './shared/dedupe.js';
// BYOK(사용자 키): 활성 anthropic/openai 키가 있으면 해당 provider 어댑터로 분석.
import { buildUserKeyClient } from './shared/providerClientsNode.js';
import { getActiveUserKey } from './shared/userApiKeysNode.js';
// 에이전트 루프: Edge Function 60초로는 다단계 추론이 불가능해 여기 얹는다(handleAgentRun 참조).
import { createRun, finishRun } from './shared/agent/trace.js';
import { runConsultantAgent } from './shared/agent/agents/consultant.js';
import { runPlannerAgent } from './shared/agent/agents/planner.js';

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

function buildAIClient(userKey) {
  // BYOK: 사용자 활성 키(anthropic/openai)가 있으면 해당 provider 어댑터를 사용.
  // ⚠️ 이미지 분석 파이프라인은 Gemini 전용으로 튜닝됨(crop/bbox·모델시퀀스·thinkingBudget) →
  //    BYOK provider는 단순 경로로 동작해 정확도가 낮아질 수 있다(opt-in 전제, UI 경고 표시).
  if (userKey && userKey.apiKey) {
    return buildUserKeyClient(userKey.provider, userKey.apiKey, userKey.model ?? undefined);
  }
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
  const userKey = await getActiveUserKey(supabase, userId);
  const ai = buildAIClient(userKey);
  const sessionId = `gen-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  res.status(200).json({ success: true, sessionId, message: '백그라운드 생성 시작' });

  generateAllProblemTypes(supabase, ai, { userId, language, classification, types, ...aiOptions }, sessionId)
    .catch((err) => {
      console.error('[generate-all] 백그라운드 오류:', err?.message, { sessionId, userId });
    });
}

// ─── 에이전트 실행 ──────────────────────────────────────────
// 왜 여기인가: Edge Function은 60초 상한이라 "모델이 도구를 고르고 → 실행하고 → 결과를 보고
// 다시 고르는" 루프가 애초에 안 들어간다. 이 함수엔 JWT 검증·userId 가드·BYOK 키 조회가
// 이미 있어 그대로 재사용한다.
//
// ── 왜 fire-and-forget이 아닌가 (건드리기 전에 읽을 것) ──────────────
// 이 서비스(publisher)는 cpu-throttling=true다 — functions deploy 기본값이고 실측도 그렇다.
// 스로틀 상태에서는 **응답을 flush한 뒤의 백그라운드 작업에 CPU가 할당되지 않는다.** 즉
// `res.json(...)` 뒤에 이어붙인 await 체인은 다음 요청이 같은 인스턴스에 들어올 때까지 멈춘다.
// 그래서 루프는 요청 안에서 끝까지 돈다(요청 처리 중엔 CPU 100% 할당).
//
// 대신 deploy-image.ps1의 --timeout을 300s로 잡았다. timeout은 요청이 실제로 떠 있는 동안만
// 과금돼 유휴 비용이 0이다. --no-cpu-throttling으로 푸는 쪽은 4분 워밍업 핑이 인스턴스를 상시
// 살려두어 1vCPU 24/7 과금이 되므로 쓰지 않는다.
//
// 참고: 이 파일의 generate-all은 여전히 fire-and-forget인데, 그건 **검증된 패턴이라서가 아니라
// 아직 이 문제를 안 본 코드**다. 실제 트래픽이 도는 direct-upload 경로는 Pub/Sub로 넘겨
// analyze-worker(스로틀 해제)가 처리한다.
//
// runId를 프론트가 만들어 보내는 이유는 trace.js createRun 주석 참고.
const AGENT_HANDLERS = {
  consultant: runConsultantAgent,
  planner: runPlannerAgent,
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function handleAgentRun(req, res) {
  if (!SUPABASE_ANON_KEY) {
    res.status(500).json({ error: 'SUPABASE_ANON_KEY 환경변수가 없습니다' });
    return;
  }

  const authHeader = req.get('authorization');
  const jwtResult = await verifySupabaseJWT(authHeader, SUPABASE_URL, SUPABASE_ANON_KEY);
  if (!jwtResult.valid) {
    console.warn('[agent] JWT 검증 실패:', jwtResult.error);
    res.status(401).json({ error: 'Unauthorized: ' + jwtResult.error });
    return;
  }

  const body = req.body || {};
  const { agentType, input, runId: requestedRunId } = body;
  const userId = jwtResult.userId;

  if (body.userId && body.userId !== userId) {
    console.warn(`[agent] userId 불일치: body=${body.userId}, jwt=${userId}`);
    res.status(403).json({ error: 'Forbidden: userId does not match token' });
    return;
  }

  const runAgentHandler = AGENT_HANDLERS[agentType];
  if (!runAgentHandler) {
    res.status(400).json({ error: `지원하지 않는 agentType: ${agentType}` });
    return;
  }
  // 킬 스위치. **createRun보다 먼저** 본다 — 여기서 막아야 빈 런 행도, 모델 호출도 안 생긴다.
  // 프론트는 이 실패를 확정 실패로 보고 단발 Edge Function 경로로 떨어진다(useConsulting).
  if (!isAgentEnabled(agentType)) {
    console.warn(`[agent] 비활성화된 agentType 요청: ${agentType} (AGENT_DISABLED)`);
    res.status(503).json({ error: `에이전트가 비활성화되어 있습니다: ${agentType}`, agentDisabled: true });
    return;
  }
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    res.status(400).json({ error: 'input 객체가 필요합니다' });
    return;
  }
  // 프론트가 만든 id. UUID 형태만 받는다(임의 문자열을 그대로 PK로 밀어넣지 않는다).
  // 남의 런 id를 찍어 보내도 unique 위반으로 409일 뿐이고, SELECT는 RLS가 user_id로 막는다.
  if (typeof requestedRunId !== 'string' || !UUID_RE.test(requestedRunId)) {
    res.status(400).json({ error: 'runId(UUID)가 필요합니다' });
    return;
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // 도구가 보는 DB는 **호출자 권한**이다. 에이전트가 "이 학생을 볼 수 있는가"를 코드로 판정하지
  // 않고 RLS에 맡긴다 — 도구가 늘어날수록 코드 가드는 반드시 빠지는 곳이 생기지만 RLS는 안 빠진다.
  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const userKey = await getActiveUserKey(supabase, userId);
  const ai = buildAIClient(userKey);

  const runId = requestedRunId;
  try {
    await createRun(supabase, { id: runId, userId, agentType, input });
  } catch (e) {
    if (e?.duplicate) {
      // 같은 runId 재전송 = 이미 도는 런이다. 모델을 두 번 부르지 않는다(그대로 과금이다).
      console.warn('[agent] 중복 runId 요청 무시:', { runId, agentType, userId });
      res.status(409).json({ error: '이미 진행 중인 실행입니다', runId });
      return;
    }
    console.error('[agent] 실행 기록 생성 실패:', e?.message);
    res.status(500).json({ error: '에이전트 실행을 시작하지 못했습니다' });
    return;
  }

  console.log(`[agent] 시작: runId=${runId}, agentType=${agentType}, userId=${userId}`);

  // 루프를 요청 안에서 끝낸다(위 cpu-throttling 주석 참고).
  // finishRun을 응답보다 **먼저** 끝내는 게 중요하다 — 프론트의 1차 완료 신호는 HTTP 응답이
  // 아니라 agent_runs UPDATE의 Realtime이고, fetch가 끊긴 경우엔 그게 유일한 신호다.
  let outcome;
  try {
    outcome = await runAgentHandler({ ai, supabase, userClient, runId, userId, input });
  } catch (err) {
    console.error('[agent] 실행 오류:', err?.message, { runId, agentType, userId });
    await finishRun(supabase, runId, {
      status: 'failed',
      stopReason: err?.stopReason ?? null,
      error: err?.message ?? String(err),
      totalTokens: err?.totalTokens ?? 0,
      modelCalls: err?.modelCalls ?? 0,
    });
    res.status(500).json({ error: err?.message ?? '에이전트 실행에 실패했습니다', runId });
    return;
  }

  await finishRun(supabase, runId, {
    status: 'completed',
    stopReason: outcome.stopReason,
    result: outcome.result,
    totalTokens: outcome.totalTokens,
    modelCalls: outcome.modelCalls,
  });

  console.log(`[agent] 완료: runId=${runId}, stopReason=${outcome.stopReason}, tokens=${outcome.totalTokens}, calls=${outcome.modelCalls}`);
  res.status(200).json({ success: true, runId, agentType, stopReason: outcome.stopReason });
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

// dedupeProblemItems → shared/dedupe.js로 추출.
// 병합 키에 페이지 인덱스(_page_index)를 도입: 서로 다른 페이지의 같은 problem_number를
// '다른 문제'로 보존해 cross-page backfill 오염·소실을 차단한다(워크북은 페이지마다 1번부터
// 재시작 → 번호 충돌이 기본 시나리오. 실측 세션 4d1509b0 참조).

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

  if (SPLIT_PIPELINE || SIMPLE_PIPELINE) {
    // 크롭 없는 통짜 이미지 경로. 페이지 분리/크롭 없이 모델이 전체를 보고 처리하므로
    // 여러 페이지에 걸친 지문도 자연히 병합된다. 두 변형이 있다:
    //  - SPLIT_PIPELINE=1: 역할분리 3-호출 병렬(구조 ∥ 학생답 ∥ 정답). 이미지 입력 3배.
    //  - 기본(SIMPLE_PIPELINE): 2-스텝(이미지 1회 자유추출 → 텍스트 구조화).
    // env SIMPLE_PIPELINE=0 이고 SPLIT_PIPELINE도 아니면 아래 4-Pass 경로.
    // 서버 측 전처리(긴 변 2048px + JPEG 92%, EXIF 정립)를 모든 이미지에 적용.
    // 프론트 compressImage()와 같은 사양이라 프론트를 거친 이미지는 재인코딩 없이 통과한다.
    for (const imageData of images) {
      try {
        const { imageBase64, mimeType } = await preprocessImage(imageData.imageBase64, imageData.mimeType);
        imageData.imageBase64 = imageBase64;
        imageData.mimeType = mimeType;
      } catch (e) {
        console.error(`[handler] 이미지 전처리 실패(원본 사용): ${e?.message}`, { sessionId });
      }
    }
    try {
      const runPipeline = SPLIT_PIPELINE ? runSplitPipeline : runSimpleExtractAndStructure;
      console.log(`[handler] 파이프라인=${SPLIT_PIPELINE ? 'split(3-call)' : 'simple(2-step)'}`, { sessionId });
      const { items, usedModel } = await runPipeline({
        ai, sessionId, images, taxonomyData, userLanguage,
      });
      allValidatedItems = items;
      finalUsedModel = usedModel;
    } catch (e) {
      console.error(`[handler] 파이프라인 실패:`, e?.message, { sessionId });
    }
    // 이미지 메모리 해제
    for (const imageData of images) imageData.imageBase64 = '';
  } else {
    // ── 기존 4-Pass 경로(롤백용) ──
    // 배치 병렬 처리 (batch_size=3). 원본: index.ts ANALYSIS_BATCH_SIZE
    for (let batchStart = 0; batchStart < images.length; batchStart += ANALYSIS_BATCH_SIZE) {
      const batchEnd = Math.min(batchStart + ANALYSIS_BATCH_SIZE, images.length);
      const batchIndices = Array.from({ length: batchEnd - batchStart }, (_, i) => batchStart + i);

      console.log(`[handler] 배치 처리 (페이지 ${batchStart + 1}-${batchEnd})...`, { sessionId });

      const batchResults = await Promise.all(batchIndices.map(async (idx) => {
        const imageData = images[idx];
        try {
          // 서버 측 이미지 전처리: 긴 변 2048px + JPEG 92%로 리사이즈
          const { imageBase64: resizedBase64, mimeType: resizedMimeType } = await preprocessImage(
            imageData.imageBase64, imageData.mimeType
          );
          imageData.imageBase64 = resizedBase64;
          imageData.mimeType = resizedMimeType;

          const { pageItems, usedModel } = await processPage({
            ai, sessionId, imageData, pageNum: idx + 1, totalPages: images.length, taxonomyData, userLanguage,
            correctSource: CORRECT_SOURCE, // 기본 'crop'(행위보존). env CORRECT_SOURCE=fullpage 로 비용 -25% 경로.
          });
          return { pageItems, usedModel, pageIndex: idx };
        } catch (pageError) {
          console.error(`[handler] 페이지 ${idx + 1} 실패:`, pageError?.message, { sessionId });
          return null;
        }
      }));

      for (const result of batchResults) {
        if (!result) continue;
        // 페이지 인덱스 태깅 → dedupeProblemItems가 다른 페이지의 같은 번호를 구분(오염·소실 방지)
        for (const it of result.pageItems) it._page_index = result.pageIndex;
        allValidatedItems.push(...result.pageItems);
        finalUsedModel = result.usedModel;
      }

      // 분석 완료된 페이지의 이미지 메모리 해제
      for (const idx of batchIndices) {
        if (images[idx]) images[idx].imageBase64 = '';
      }
    }

    // 다중 페이지 결과 병합: (페이지,번호) 키로 페이지 '내' 중복만 제거하고, 다른 페이지의
    // 같은 번호는 다른 문제로 보존(cross-page 오염·소실 방지). 이후 _page_index는 불필요 →
    // DB 페이로드 누출 방지 위해 제거.
    allValidatedItems = dedupeProblemItems(allValidatedItems, sessionId);
    for (const it of allValidatedItems) delete it._page_index;
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

  if (req.body?.mode === 'agent') {
    await handleAgentRun(req, res);
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

    // BYOK: legacy(inline) 경로는 여기서 직접 분석 → 활성 키 조회.
    // (Direct Upload 경로는 worker가 userId로 자체 조회하므로 publish payload에 키 미포함)
    const userKey = await getActiveUserKey(supabase, userId);
    const ai = buildAIClient(userKey);

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
    // BYOK: Direct Upload 주 경로의 실제 분석은 여기(worker). userId로 활성 키 조회.
    const userKey = await getActiveUserKey(supabase, userId);
    if (userKey) {
      console.log(`[worker] BYOK provider 사용: ${userKey.provider} (이미지 분석 — Gemini 전용 파이프라인 우회, 정확도 하락 가능)`, { sessionId });
    }
    const ai = buildAIClient(userKey);
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
