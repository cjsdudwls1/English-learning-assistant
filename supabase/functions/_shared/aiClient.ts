// AI 모델 호출 관련 유틸리티
import { StageError, parseModelError, summarizeError } from './errors.ts';

// 모델 응답 타입
export interface ModelResponse {
    text?: string | (() => Promise<string>);
    response?: {
        text?: string | (() => Promise<string>);
    };
    candidates?: Array<{
        finishReason?: string;
        content?: {
            parts?: Array<{ text?: string }>;
        };
    }>;
}

// 생성 설정 타입
export interface GenerationConfig {
    responseMimeType: string;
    temperature: number;
}

// AI 클라이언트 인터페이스
export interface AIClient {
    models: {
        generateContent: (params: {
            model: string;
            contents: unknown;
            generationConfig: GenerationConfig;
            safetySettings?: Array<{ category: string; threshold: string }>;
        }) => Promise<ModelResponse>;
    };
}

// 지수 백오프 지연 계산
export function computeBackoffDelayMs(base: number, attempt: number): number {
    // exponential backoff + jitter (0.85~1.15)
    const raw = base * Math.pow(2, Math.max(0, attempt - 1));
    const jitter = 0.85 + Math.random() * 0.30;
    return Math.round(raw * jitter);
}

// 재시도 파라미터
export interface GenerateWithRetryParams {
    ai: AIClient;
    model: string;
    contents: unknown;
    sessionId: string;
    maxRetries: number;
    baseDelayMs: number;
    temperature: number;
}

// 재시도 결과
export interface GenerateWithRetryResult {
    response: ModelResponse;
    attemptCount: number;
}

// 재시도 로직이 포함된 모델 생성 함수
export async function generateWithRetry(params: GenerateWithRetryParams): Promise<GenerateWithRetryResult> {
    const { ai, model, contents, sessionId, maxRetries, baseDelayMs, temperature } = params;
    let attempt = 0;
    let lastParsed: ReturnType<typeof parseModelError> | null = null;
    let lastErr: unknown = null;

    while (attempt < maxRetries) {
        try {
            console.log(`[Background] Model call attempt ${attempt + 1}/${maxRetries} (model=${model})...`, { sessionId });

            const response = await ai.models.generateContent({
                model,
                contents,
                generationConfig: {
                    responseMimeType: "application/json",
                    temperature,
                },
                // RECITATION 및 기타 안전 필터로 인한 차단 방지
                safetySettings: [
                    { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
                    { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
                    { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
                    { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
                ],
            });
            return { response, attemptCount: attempt + 1 };
        } catch (apiError: unknown) {
            attempt++;
            lastErr = apiError;
            lastParsed = parseModelError(apiError);
            const { errorCode, errorStatus, errorMessage, isRateLimit, isServerOverload, isTimeout } = lastParsed;

            console.error(`[Background] Model error (attempt ${attempt}/${maxRetries}, model=${model}):`, {
                sessionId,
                errorCode,
                errorStatus,
                errorMessage: String(errorMessage).substring(0, 200),
            });

            const retryable = isRateLimit || isServerOverload || isTimeout;
            if (attempt >= maxRetries || !retryable) {
                throw new StageError(
                    'extract_call',
                    `Model call failed after ${attempt} attempts (model=${model})`,
                    {
                        model,
                        attempt,
                        maxRetries,
                        errorCode,
                        errorStatus,
                        errorMessage: String(errorMessage).substring(0, 500),
                    }
                );
            }

            const delay = computeBackoffDelayMs(baseDelayMs, attempt);
            console.warn(`[Background] Retrying in ${Math.round(delay / 1000)}s... (attempt ${attempt}/${maxRetries}, model=${model})`, { sessionId });
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }

    // 여기에 도달하면 안 됨
    throw new StageError(
        'extract_call',
        `Model call failed (no response) (model=${model})`,
        { model, lastParsed, lastError: summarizeError(lastErr) }
    );
}

// 모델 응답에서 텍스트 추출
export async function extractTextFromResponse(response: ModelResponse, model: string): Promise<string> {
    let candidateText = '';

    if (response?.text) {
        candidateText = typeof response.text === 'function'
            ? await response.text()
            : response.text;
    } else if (response?.response?.text) {
        candidateText = typeof response.response.text === 'function'
            ? await response.response.text()
            : response.response.text;
    } else if (response?.candidates?.[0]?.content?.parts?.[0]?.text) {
        candidateText = response.candidates[0].content.parts[0].text;
    } else {
        const finishReason = response?.candidates?.[0]?.finishReason ?? null;
        throw new StageError(
            'extract_call',
            `Model returned no content (model=${model})`,
            {
                model,
                finishReason,
                hasCandidates: !!response?.candidates,
                candidatesLength: response?.candidates?.length,
                firstCandidate: response?.candidates?.[0]
                    ? {
                        finishReason: response.candidates[0].finishReason,
                        hasContent: !!response.candidates[0].content,
                        hasParts: !!response.candidates[0].content?.parts,
                    }
                    : null,
            }
        );
    }

    if (!candidateText || typeof candidateText !== 'string') {
        throw new StageError(
            'extract_call',
            `Invalid response text (model=${model})`,
            { model, responseTextType: typeof candidateText, responseTextLength: candidateText?.length }
        );
    }

    return candidateText;
}

// JSON 파싱 (마크다운 코드블록 제거 포함)
export function parseJsonResponse(text: string, model: string): unknown {
    const jsonString = text.replace(/```json/g, '').replace(/```/g, '').trim();
    try {
        return JSON.parse(jsonString);
    } catch (parseError: unknown) {
        const error = parseError as Error;
        throw new StageError(
            'extract_parse',
            `JSON parse failed (model=${model}): ${error.message}`,
            { model, jsonStringPreview: jsonString.substring(0, 800) }
        );
    }
}
