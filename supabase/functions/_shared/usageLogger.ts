// AI 토큰 사용량 로깅 유틸리티
import type { UsageMetadata } from './aiClient.ts';

// 로그 저장 파라미터
export interface LogUsageParams {
    supabase: any;
    userId: string;
    functionName: string;
    modelUsed: string;
    usageMetadata?: UsageMetadata;
    sessionId?: string;
    metadata?: Record<string, unknown>;
}

/**
 * AI 토큰 사용량을 ai_usage_logs 테이블에 저장합니다.
 * Edge Function에서 AI 호출 후 이 함수를 호출하여 비용 추적 데이터를 수집합니다.
 */
export async function logAiUsage(params: LogUsageParams): Promise<void> {
    const { supabase, userId, functionName, modelUsed, usageMetadata, sessionId, metadata } = params;

    try {
        const logData = {
            user_id: userId,
            function_name: functionName,
            model_used: modelUsed,
            prompt_token_count: usageMetadata?.promptTokenCount ?? 0,
            candidates_token_count: usageMetadata?.candidatesTokenCount ?? 0,
            total_token_count: usageMetadata?.totalTokenCount ?? 0,
            session_id: sessionId ?? null,
            metadata: metadata ?? {},
        };

        const { error } = await supabase
            .from('ai_usage_logs')
            .insert(logData);

        if (error) {
            // 로깅 실패는 메인 로직에 영향을 주지 않도록 경고만 출력
            console.warn('[Usage Log] Failed to insert ai_usage_logs:', {
                functionName,
                modelUsed,
                error: error.message,
            });
        } else {
            console.log('[Usage Log] Token usage logged:', {
                functionName,
                modelUsed,
                promptTokenCount: logData.prompt_token_count,
                candidatesTokenCount: logData.candidates_token_count,
                totalTokenCount: logData.total_token_count,
            });
        }
    } catch (err) {
        // 예외 발생 시에도 메인 로직 계속 진행
        console.warn('[Usage Log] Exception during logging:', err);
    }
}

/**
 * 여러 AI 호출의 토큰 사용량을 합산합니다.
 */
export function sumUsageMetadata(...metadatas: (UsageMetadata | undefined)[]): UsageMetadata {
    const result: UsageMetadata = {
        promptTokenCount: 0,
        candidatesTokenCount: 0,
        totalTokenCount: 0,
    };

    for (const m of metadatas) {
        if (m) {
            result.promptTokenCount = (result.promptTokenCount ?? 0) + (m.promptTokenCount ?? 0);
            result.candidatesTokenCount = (result.candidatesTokenCount ?? 0) + (m.candidatesTokenCount ?? 0);
            result.totalTokenCount = (result.totalTokenCount ?? 0) + (m.totalTokenCount ?? 0);
        }
    }

    return result;
}
