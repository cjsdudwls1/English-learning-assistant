// sessionManager.ts — 세션 생명주기 관리 모듈
// 세션 생성, 완료 상태 업데이트, Vertex AI 인증 사전 검증

import { markSessionFailed, type FailureStage } from '../../_shared/errors.ts';
import { MODEL_SEQUENCE } from '../../_shared/models.ts';

// ─── 타입 정의 ─────────────────────────────────────────────

export interface CreateSessionParams {
  supabase: any;
  userId: string;
  imageUrls: string[];
}

export interface CreateSessionResult {
  sessionId: string;
  sessionData: any;
}

export interface CompleteSessionParams {
  supabase: any;
  sessionId: string;
  usedModel: string;
}

export interface ValidateVertexAuthParams {
  supabase: any;
  sessionId: string;
}

// ─── 세션 생성 ─────────────────────────────────────────────

/**
 * 분석 세션을 생성한다.
 *
 * - image_urls를 검증/정리하여 저장
 * - 상태: 'processing'
 * - 저장 후 데이터 정합성 검증 로그 출력
 */
export async function createSession(params: CreateSessionParams): Promise<CreateSessionResult> {
  const { supabase, userId, imageUrls } = params;

  console.log('Step 2: Create session...', {
    imageUrlsCount: imageUrls.length,
    imageUrls,
  });

  // image_urls 배열 검증 및 정리
  const cleanedImageUrls = imageUrls.filter((url: string) => url && typeof url === 'string' && url.trim().length > 0);
  if (cleanedImageUrls.length !== imageUrls.length) {
    console.warn('Step 2: Some image URLs were invalid and filtered out', {
      originalCount: imageUrls.length,
      cleanedCount: cleanedImageUrls.length,
    });
  }

  const finalImageUrls = cleanedImageUrls.length > 0 ? cleanedImageUrls : imageUrls;

  console.log('Step 2: Final image URLs to save', {
    originalCount: imageUrls.length,
    cleanedCount: cleanedImageUrls.length,
    finalCount: finalImageUrls.length,
    finalUrls: finalImageUrls,
  });

  const { data: sessionData, error: sessionError } = await supabase
    .from('sessions')
    .insert({
      user_id: userId,
      image_urls: finalImageUrls,
      analysis_model: MODEL_SEQUENCE[0],
      status: 'processing'
    })
    .select('id, image_urls')
    .single();

  if (sessionError) {
    console.error('Step 2: Session insert error', sessionError);
    throw sessionError;
  }

  const sessionId = sessionData.id;

  // 저장된 데이터 검증
  console.log('Step 2: Session created', {
    sessionId,
    insertedImageUrls: sessionData.image_urls,
    imageUrlsType: typeof sessionData.image_urls,
    imageUrlsIsArray: Array.isArray(sessionData.image_urls),
    imageUrlsLength: Array.isArray(sessionData.image_urls) ? sessionData.image_urls.length : 0,
    expectedCount: imageUrls.length,
  });

  if (!Array.isArray(sessionData.image_urls)) {
    console.error('Step 2: WARNING - image_urls is not an array!', {
      sessionId,
      type: typeof sessionData.image_urls,
      value: sessionData.image_urls,
    });
  } else if (sessionData.image_urls.length !== imageUrls.length) {
    console.warn('Step 2: WARNING - image_urls count mismatch!', {
      sessionId,
      expected: imageUrls.length,
      actual: sessionData.image_urls.length,
    });
  }

  console.log('Step 2 completed: Session created with ID', sessionId);
  return { sessionId, sessionData };
}

// ─── 세션 완료 업데이트 ────────────────────────────────────

/**
 * 세션 상태를 'completed'로 업데이트한다.
 * 이미 'labeled' 상태인 경우 덮어쓰지 않도록 가드한다.
 */
export async function completeSession(params: CompleteSessionParams): Promise<void> {
  const { supabase, sessionId, usedModel } = params;

  const modelsUsed = {
    ocr: 'none (direct multimodal)',
    analysis: usedModel,
  };
  console.log(`[Background] Step 7: Update session status to completed...`, { sessionId, modelsUsed });

  const { error: statusUpdateError } = await supabase
    .from('sessions')
    .update({
      status: 'completed',
      analysis_model: usedModel,
      models_used: modelsUsed,
    })
    .eq('id', sessionId)
    // 사용자 라벨링이 이미 끝나 labeled로 바뀐 경우 되돌리지 않도록 가드
    .eq('status', 'processing');

  if (statusUpdateError) {
    console.error(`[Background] Step 7 error: Status update error`, { sessionId, error: statusUpdateError });
  } else {
    console.log(`[Background] Step 7 completed: Session status updated to completed`, { sessionId });
  }
}

// ─── Vertex AI 인증 사전 검증 ──────────────────────────────

/**
 * Vertex AI 인증 토큰을 사전 검증한다.
 * 실패 시 세션을 'auth_failed'로 마킹하고 에러를 throw한다.
 */
export async function validateVertexAuth(params: ValidateVertexAuthParams): Promise<void> {
  const { supabase, sessionId } = params;

  try {
    console.log('[Background] Pre-validating Vertex AI authentication...');
    const { getAccessToken, parseServiceAccountJSON } = await import('../../_shared/vertexAuth.ts');
    const creds = parseServiceAccountJSON(Deno.env.get('GOOGLE_SERVICE_ACCOUNT_JSON') || '');
    await getAccessToken(creds);
    console.log('[Background] Vertex AI authentication validated');
  } catch (authError: any) {
    console.error('[Background] Vertex AI auth pre-validation FAILED', {
      sessionId,
      error: authError?.message,
    });
    await markSessionFailed({
      supabase,
      sessionId,
      stage: 'auth_failed' as FailureStage,
      error: authError,
    });
    throw authError; // 호출자가 백그라운드 작업을 중단하도록
  }
}
