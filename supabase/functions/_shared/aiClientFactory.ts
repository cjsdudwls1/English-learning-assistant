// AI 클라이언트 팩토리: Vertex AI 우선, GEMINI_API_KEY fallback
// 모든 Edge Function에서 이 팩토리를 사용하여 AI 클라이언트를 생성

import type { AIClient } from './aiClient.ts';
import { createVertexAIClient, type VertexAIConfig } from './vertexClient.ts';

// GoogleGenAI 타입 (런타임에 동적 import할 때 사용)
interface GoogleGenAIConstructor {
    new(opts: { apiKey: string }): AIClient;
}

export interface AIClientResult {
    ai: AIClient;
    provider: 'vertex' | 'gemini';
}

/**
 * AI 클라이언트를 생성한다.
 * 1) Vertex AI 환경 변수가 모두 설정되어 있으면 Vertex AI 사용
 * 2) 그렇지 않으면 GEMINI_API_KEY 사용 (fallback)
 * 3) 둘 다 없으면 에러
 *
 * @param GoogleGenAI - GoogleGenAI 생성자 (ESM import 결과를 전달)
 */
export function createAIClient(GoogleGenAI?: GoogleGenAIConstructor): AIClientResult {
    const vertexProjectId = Deno.env.get('VERTEX_PROJECT_ID');
    const vertexLocation = Deno.env.get('VERTEX_LOCATION');
    const serviceAccountJSON = Deno.env.get('GOOGLE_SERVICE_ACCOUNT_JSON');
    const geminiApiKey = Deno.env.get('GEMINI_API_KEY');

    // Vertex AI 환경 변수가 모두 있으면 Vertex AI 사용
    if (vertexProjectId && vertexLocation && serviceAccountJSON) {
        console.log('[AIClientFactory] Using Vertex AI', { project: vertexProjectId, location: vertexLocation });
        const config: VertexAIConfig = {
            projectId: vertexProjectId,
            location: vertexLocation,
            serviceAccountJSON,
        };
        return {
            ai: createVertexAIClient(config),
            provider: 'vertex',
        };
    }

    // Fallback: GEMINI_API_KEY
    if (geminiApiKey && GoogleGenAI) {
        console.log('[AIClientFactory] Vertex AI not configured, falling back to GEMINI_API_KEY');
        return {
            ai: new GoogleGenAI({ apiKey: geminiApiKey }) as unknown as AIClient,
            provider: 'gemini',
        };
    }

    // 둘 다 없음
    throw new Error(
        'AI client configuration missing. Set either ' +
        '(VERTEX_PROJECT_ID + VERTEX_LOCATION + GOOGLE_SERVICE_ACCOUNT_JSON) or GEMINI_API_KEY'
    );
}
