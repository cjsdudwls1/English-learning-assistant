// AI 모델 호출 관련 유틸리티
import { StageError, parseModelError, summarizeError } from './errors.ts';

// 토큰 사용량 메타데이터 타입
export interface UsageMetadata {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
}

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
    usageMetadata?: UsageMetadata;
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
    usageMetadata?: UsageMetadata;
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

            const response = await Promise.race([
                ai.models.generateContent({
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
                }),
                new Promise<never>((_, reject) => {
                    // thinking 모델은 추론 시간이 더 걸리므로 90초, 일반 모델은 60초
                    const timeoutMs = model.includes('gemini-3') ? 90000 : 60000;
                    setTimeout(() => reject(new Error(`API call timeout after ${timeoutMs / 1000}s`)), timeoutMs);
                }),
            ]) as ModelResponse;

            // 토큰 사용량 추출 및 로깅
            const usageMetadata = response.usageMetadata;
            if (usageMetadata) {
                console.log(`[Background] Token usage (model=${model}):`, {
                    sessionId,
                    promptTokenCount: usageMetadata.promptTokenCount,
                    candidatesTokenCount: usageMetadata.candidatesTokenCount,
                    totalTokenCount: usageMetadata.totalTokenCount,
                });
            }

            return { response, attemptCount: attempt + 1, usageMetadata };
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

// JSON 파싱 (마크다운 코드블록 제거 포함 + 복구 로직)
export function parseJsonResponse(text: string, model: string): unknown {
    const jsonString = text.replace(/```json/g, '').replace(/```/g, '').trim();

    // 1차: 그대로 파싱 시도
    try {
        return JSON.parse(jsonString);
    } catch (_firstError) {
        // 2차: 제어문자 제거 후 재시도
        try {
            const cleaned = jsonString
                .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '') // 제어문자 제거
                .replace(/\t/g, '    '); // 탭을 공백으로
            return JSON.parse(cleaned);
        } catch (_secondError) {
            // 3차: OCR 응답 구조에서 text 필드를 정규식으로 추출
            try {
                // "text": "..." 패턴 추출 (OCR 결과의 pages 배열에서)
                const textMatches = jsonString.match(/"text"\s*:\s*"((?:[^"\\]|\\.)*)"/g);
                if (textMatches && textMatches.length > 0) {
                    const pages = textMatches.map((match, idx) => {
                        // "text": "내용" 에서 내용만 추출
                        const content = match.replace(/^"text"\s*:\s*"/, '').replace(/"$/, '');
                        // 이스케이프된 문자 복원
                        const decoded = content
                            .replace(/\\n/g, '\n')
                            .replace(/\\t/g, '\t')
                            .replace(/\\"/g, '"')
                            .replace(/\\\\/g, '\\');
                        return { page: idx + 1, text: decoded };
                    });
                    console.warn(`[parseJsonResponse] JSON parse failed, recovered ${pages.length} text block(s) via regex (model=${model})`);
                    return { pages };
                }
            } catch (_regexError) {
                // regex도 실패
            }

            // 4차: 전체 텍스트를 단일 페이지로 반환 (최후의 수단)
            // JSON이 아닌 순수 텍스트일 수 있음
            if (jsonString.length > 50) {
                console.warn(`[parseJsonResponse] All JSON parse attempts failed, using raw text as fallback (model=${model})`);
                return { pages: [{ page: 1, text: jsonString }] };
            }

            // 진짜 파싱 불가능
            const error = _secondError as Error;
            throw new StageError(
                'extract_parse',
                `JSON parse failed (model=${model}): ${error.message}`,
                { model, jsonStringPreview: jsonString.substring(0, 800) }
            );
        }
    }
}
