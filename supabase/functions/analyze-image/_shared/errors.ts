export type FailureStage =
    | 'request'
    | 'extract_call'
    | 'extract_parse'
    | 'extract_empty'
    | 'extract_validate'
    | 'insert_problems'
    | 'insert_labels'
    | 'unknown';

export class StageError extends Error {
    stage: FailureStage;
    details: any;
    constructor(stage: FailureStage, message: string, details?: any) {
        super(message);
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

export function summarizeError(err: any) {
    const message = err?.message ? String(err.message) : String(err ?? 'Unknown error');
    const code = err?.status ?? err?.error?.code ?? err?.code ?? null;
    const status = err?.error?.status ?? err?.statusText ?? null;
    const name = err?.name ?? null;
    const stack = err?.stack ?? null;
    return { message, code, status, name, stack };
}

export function parseModelError(apiError: any) {
    const errorCode = apiError?.status || apiError?.error?.code || 0;
    const errorMessage = apiError?.message || apiError?.error?.message || String(apiError);
    const errorStatus = apiError?.error?.status || '';
    const lower = String(errorMessage).toLowerCase();
    const isRateLimit = errorCode === 429 || lower.includes('rate limit') || lower.includes('quota');
    const isServerOverload = errorCode === 503 || lower.includes('overloaded') || lower.includes('unavailable') || errorStatus === 'UNAVAILABLE';
    const isTimeout = lower.includes('timeout') || errorCode === 504;
    return { errorCode, errorStatus, errorMessage, isRateLimit, isServerOverload, isTimeout };
}

export async function markSessionFailed(params: {
    supabase: any;
    sessionId: string;
    stage: FailureStage;
    error: any;
    extra?: any;
}) {
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
