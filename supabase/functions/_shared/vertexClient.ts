// Vertex AI REST API 클라이언트
// @google/genai SDK의 AIClient 인터페이스와 호환되는 래퍼
// Deno(Supabase Edge Functions)에서 Vertex AI를 직접 호출하기 위해 사용

import type { AIClient, ModelResponse, GenerationConfig } from './aiClient.ts';
import { getAccessToken, parseServiceAccountJSON, type ServiceAccountCredentials } from './vertexAuth.ts';

export interface VertexAIConfig {
    projectId: string;
    location: string;
    serviceAccountJSON: string;
}

// contents 형식 정규화: SDK 형식 → REST API 형식
// SDK: { parts: [{ text: "..." }] }  →  REST: [{ role: "user", parts: [{ text: "..." }] }]
function normalizeContents(contents: unknown): unknown {
    if (Array.isArray(contents)) {
        return contents;
    }
    if (contents && typeof contents === 'object' && 'parts' in contents) {
        return [{ role: 'user', ...(contents as Record<string, unknown>) }];
    }
    // 그 외: 그대로 전달
    return contents;
}

// Vertex AI REST API를 AIClient 인터페이스로 래핑
export function createVertexAIClient(config: VertexAIConfig): AIClient {
    const credentials: ServiceAccountCredentials = parseServiceAccountJSON(config.serviceAccountJSON);

    return {
        models: {
            generateContent: async (params: {
                model: string;
                contents: unknown;
                generationConfig: GenerationConfig;
                safetySettings?: Array<{ category: string; threshold: string }>;
            }): Promise<ModelResponse> => {
                const accessToken = await getAccessToken(credentials);

                // Vertex AI REST API 엔드포인트
                const url = `https://${config.location}-aiplatform.googleapis.com/v1/projects/${config.projectId}/locations/${config.location}/publishers/google/models/${params.model}:generateContent`;

                const body: Record<string, unknown> = {
                    contents: normalizeContents(params.contents),
                    generationConfig: params.generationConfig,
                };

                if (params.safetySettings && params.safetySettings.length > 0) {
                    body.safetySettings = params.safetySettings;
                }

                const response = await fetch(url, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${accessToken}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify(body),
                });

                if (!response.ok) {
                    const errorBody = await response.text();
                    // parseModelError()가 처리할 수 있는 형식으로 에러 생성
                    const error: Record<string, unknown> = new Error(`Vertex AI API error: ${response.status}`) as any;
                    error.status = response.status;
                    try {
                        const parsed = JSON.parse(errorBody);
                        error.error = parsed.error || parsed;
                        (error as any).message = parsed.error?.message || errorBody;
                    } catch {
                        (error as any).message = errorBody;
                    }
                    throw error;
                }

                const data = await response.json();
                return data as ModelResponse;
            },
        },
    };
}
