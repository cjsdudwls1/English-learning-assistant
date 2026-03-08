// 실패 원인 기록을 위한 에러 타입 및 유틸리티

export type FailureStage =
    | 'request'
    | 'auth_failed'       // Vertex AI 인증 실패
    | 'ocr_failed'        // OCR 전체 실패 (모든 페이지, 모든 모델)
    | 'extract_call'
    | 'extract_parse'
    | 'extract_empty'
    | 'extract_validate'
    | 'extract_all_failed'
    | 'insert_problems'
    | 'insert_labels'
    | 'unknown';

export class StageError extends Error {
    stage: FailureStage;
    details: unknown;

    constructor(stage: FailureStage, message: string, details?: unknown) {
        super(message);
        this.name = 'StageError';
        this.stage = stage;
        this.details = details;
    }
}

export function safeStringify(value: unknown, maxLen = 1800): string {
    let s = '';
    try {
        s = JSON.stringify(value);
    } catch {
        try {
            s = String(value);
        } catch {
            s = '[unstringifiable]';
        }
    }
    if (s.length > maxLen) return s.slice(0, maxLen) + '...';
    return s;
}

export function summarizeError(err: unknown): {
    message: string;
    code: string | number | null;
    status: string | null;
    name: string | null;
    stack: string | null;
} {
    const error = err as Record<string, unknown> | null;
    const message = error?.message ? String(error.message) : String(err ?? 'Unknown error');
    const errorObj = error?.error as Record<string, unknown> | undefined;
    const code = (error?.status ?? errorObj?.code ?? error?.code ?? null) as string | number | null;
    const status = (errorObj?.status ?? error?.statusText ?? null) as string | null;
    const name = (error?.name ?? null) as string | null;
    const stack = (error?.stack ?? null) as string | null;
    return { message, code, status, name, stack };
}

export interface ParsedModelError {
    errorCode: number;
    errorStatus: string;
    errorMessage: string;
    isRateLimit: boolean;
    isServerOverload: boolean;
    isTimeout: boolean;
}

export function parseModelError(apiError: unknown): ParsedModelError {
    const error = apiError as Record<string, unknown> | null;
    const errorObj = error?.error as Record<string, unknown> | undefined;
    const errorCode = (error?.status || errorObj?.code || 0) as number;
    const errorMessage = (error?.message || errorObj?.message || String(apiError)) as string;
    const errorStatus = (errorObj?.status || '') as string;
    const lower = String(errorMessage).toLowerCase();
    const isRateLimit = errorCode === 429 || lower.includes('rate limit') || lower.includes('quota');
    const isServerOverload = errorCode === 503 || lower.includes('overloaded') || lower.includes('unavailable') || errorStatus === 'UNAVAILABLE';
    const isTimeout = lower.includes('timeout') || errorCode === 504;
    return { errorCode, errorStatus, errorMessage, isRateLimit, isServerOverload, isTimeout };
}

export interface MarkSessionFailedParams {
    supabase: {
        from: (table: string) => {
            update: (data: Record<string, unknown>) => {
                eq: (column: string, value: string) => Promise<unknown>;
            };
        };
    };
    sessionId: string;
    stage: FailureStage;
    error: unknown;
    extra?: unknown;
}

export async function markSessionFailed(params: MarkSessionFailedParams): Promise<void> {
    const { supabase, sessionId, stage, error, extra } = params;
    const summary = summarizeError(error);
    const failureMessage = safeStringify({ stage, ...summary, extra });
    try {
        await supabase
            .from('sessions')
            .update({
                status: 'failed',
                failure_stage: stage,
                failure_message: failureMessage,
            })
            .eq('id', sessionId);
    } catch (e) {
        console.error('[FailureRecord] Failed to write failure_stage/message', {
            sessionId,
            stage,
            originalError: summary,
            updateError: summarizeError(e),
        });
        // 마지막 방어: status만이라도 업데이트
        try {
            await supabase.from('sessions').update({ status: 'failed' }).eq('id', sessionId);
        } catch (e2) {
            console.error('[FailureRecord] Failed to update status=failed', { sessionId, e2: summarizeError(e2) });
        }
    }
}
