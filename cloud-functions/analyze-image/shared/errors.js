/**
 * 에러 유틸리티 모듈
 * - StageError: 파이프라인 단계별 에러
 * - 에러 요약/파싱 헬퍼
 * - 세션 실패 기록
 */

export class StageError extends Error {
  constructor(stage, message, details) {
    super(message);
    this.name = 'StageError';
    this.stage = stage;
    this.details = details;
  }
}

const MAX_STRINGIFY_LENGTH = 1800;

export function safeStringify(value, maxLen = MAX_STRINGIFY_LENGTH) {
  let serialized = '';
  try {
    serialized = JSON.stringify(value);
  } catch {
    try { serialized = String(value); } catch { serialized = '[unstringifiable]'; }
  }
  return serialized.length > maxLen
    ? serialized.slice(0, maxLen) + '...'
    : serialized;
}

export function summarizeError(err) {
  const error = err;
  const message = error?.message ? String(error.message) : String(err ?? 'Unknown error');
  const code = error?.status ?? error?.error?.code ?? error?.code ?? null;
  const status = error?.error?.status ?? error?.statusText ?? null;
  return { message, code, status, name: error?.name ?? null };
}

export function parseModelError(apiError) {
  const error = apiError;
  const errorObj = error?.error;
  const errorCode = error?.status || errorObj?.code || 0;
  const errorMessage = error?.message || errorObj?.message || String(apiError);
  const errorStatus = errorObj?.status || '';
  const lowerMessage = String(errorMessage).toLowerCase();

  return {
    errorCode,
    errorStatus,
    errorMessage,
    isRateLimit: errorCode === 429 || lowerMessage.includes('rate limit') || lowerMessage.includes('quota'),
    isServerOverload: errorCode === 503 || lowerMessage.includes('overloaded') || lowerMessage.includes('unavailable'),
    isTimeout: lowerMessage.includes('timeout') || errorCode === 504,
  };
}

export async function markSessionFailed(supabase, sessionId, stage, error, extra) {
  const summary = summarizeError(error);
  const failureMessage = safeStringify({ stage, ...summary, extra });

  try {
    await supabase.from('sessions').update({
      status: 'failed',
      failure_stage: stage,
      failure_message: failureMessage,
    }).eq('id', sessionId);
  } catch (updateError) {
    console.error('[markSessionFailed] 실패 기록 쓰기 실패:', { sessionId, stage });
    try {
      await supabase.from('sessions').update({ status: 'failed' }).eq('id', sessionId);
    } catch { /* 최종 폴백 - 무시 */ }
  }
}
