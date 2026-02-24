// 이미지 분석 프로세서 - 모델 Failover 로직
import { generateWithRetry, extractTextFromResponse, parseJsonResponse, type UsageMetadata } from '../../_shared/aiClient.ts';
import { MODEL_SEQUENCE, MODEL_RETRY_POLICY, EXTRACTION_TEMPERATURE } from '../../_shared/models.ts';
import { StageError, summarizeError } from '../../_shared/errors.ts';
import { validateAndSplitProblems, validateExtractedItems, type TaxonomyByDepthKey, type TaxonomyByCode } from './validation.ts';

// 분석 결과 타입
export interface AnalysisResult {
    usedModel: string;
    responseText: string;
    result: {
        items: any[];
        shared_passages?: any[];
    };
    validatedItems: any[];
    usageMetadata?: UsageMetadata;
}

// 분석 파라미터
export interface AnalyzeImagesParams {
    ai: any;
    supabase: any;
    sessionId: string;
    parts: any[];
    imageCount: number;
    taxonomyByDepthKey: TaxonomyByDepthKey;
    taxonomyByCode: TaxonomyByCode;
    preferredModel?: string; // 추가
}

/**
 * 이미지들을 분석하고 문제를 추출합니다.
 * MODEL_SEQUENCE를 따라 순차적으로 모델을 시도하며,
 * 각 모델에서 응답 파싱 및 검증까지 완료해야 성공으로 처리됩니다.
 */
export async function analyzeImagesWithFailover(params: AnalyzeImagesParams): Promise<AnalysisResult> {
    const { ai, supabase, sessionId, parts, imageCount, taxonomyByDepthKey, taxonomyByCode, preferredModel } = params;

    // preferredModel이 있으면 해당 모델만 시도
    // 분석 단계에서는 gemini-2.5-pro(타임아웃 빈발)만 제외
    // gemini-3-flash-preview는 품질이 우수하여 첫 번째로 시도, 실패 시 gemini-2.5-flash fallback
    const analysisModels = (MODEL_SEQUENCE as readonly string[]).filter(
        m => m !== 'gemini-2.5-pro'
    ) as string[];
    if (analysisModels.length === 0) analysisModels.push(...(MODEL_SEQUENCE as readonly string[]));
    const sequence = preferredModel ? [preferredModel] : analysisModels;

    let usedModel: string = sequence[0];
    let responseText: string = '';
    let result: any = null;
    let validatedItems: any[] = [];
    let totalUsageMetadata: UsageMetadata = {};
    const modelAttemptErrors: Array<{ model: string; error: any }> = [];

    for (let i = 0; i < sequence.length; i++) {
        const model = sequence[i];
        const policy = MODEL_RETRY_POLICY[model as keyof typeof MODEL_RETRY_POLICY]; // 타입 단언 추가

        // 세션에 현재 시도 모델 기록 (UI에서 표시)
        try {
            await supabase
                .from('sessions')
                .update({ analysis_model: model })
                .eq('id', sessionId);
        } catch (e) {
            console.error(`[Background] Failed to update analysis_model`, { sessionId, model, error: e });
        }

        try {
            console.log(`[Background] Step 3b: Trying model ${i + 1}/${MODEL_SEQUENCE.length}: ${model}`, {
                sessionId,
                maxRetries: policy?.maxRetries,
                baseDelayMs: policy?.baseDelayMs,
                temperature: EXTRACTION_TEMPERATURE,
            });

            const attempt = await generateWithRetry({
                ai,
                model,
                contents: { parts },
                sessionId,
                maxRetries: policy?.maxRetries ?? 2,
                baseDelayMs: policy?.baseDelayMs ?? 3000,
                temperature: EXTRACTION_TEMPERATURE,
            });

            // 응답 텍스트 추출 (공통 함수 사용)
            const candidateText = await extractTextFromResponse(attempt.response, model);

            // JSON 파싱 (공통 함수 사용)
            let parsed = parseJsonResponse(candidateText, model) as { items?: any[]; shared_passages?: any[] };

            // items 키가 없는 경우 자동 변환 시도
            if (parsed && !Array.isArray(parsed.items)) {
                // pages 키가 있으면 (JSON 복구 결과) → 텍스트 기반이라 분석에 사용 불가
                // 다른 키 이름(problems, questions, results 등)으로 반환된 경우 변환
                const altKeys = ['problems', 'questions', 'results', 'data', 'extracted_items'];
                for (const key of altKeys) {
                    if (Array.isArray((parsed as any)[key])) {
                        console.warn(`[Background] Step 3b: items key missing, using '${key}' instead (model=${model})`);
                        parsed = { ...parsed, items: (parsed as any)[key] };
                        break;
                    }
                }
            }

            if (!parsed || !Array.isArray(parsed.items)) {
                throw new StageError(
                    'extract_parse',
                    `Invalid response format: items is missing (model=${model})`,
                    { model, parsedKeys: parsed ? Object.keys(parsed) : null, jsonStringPreview: candidateText.substring(0, 800) }
                );
            }

            const candidateValidated = validateAndSplitProblems(parsed.items, parsed.shared_passages);

            if (candidateValidated && candidateValidated.length > 0) {
                // 추가 검증: 선택지, 문제 번호 순서/중복, taxonomy 유효성
                validateExtractedItems({
                    items: candidateValidated,
                    taxonomyByDepthKey,
                    taxonomyByCode,
                });
            } else {
                console.warn(`[Background] Step 3b: Model returned 0 items (model=${model}). Accepting empty extraction to avoid hallucination.`, {
                    sessionId,
                    model,
                    responseTextPreview: candidateText.substring(0, 400),
                });
            }

            // 성공
            usedModel = model;
            responseText = candidateText;
            result = parsed;
            validatedItems = candidateValidated;

            console.log(`[Background] Step 3b: Model ${model} succeeded`, {
                sessionId,
                itemCount: validatedItems.length,
                promptTokenCount: attempt.usageMetadata?.promptTokenCount,
                candidatesTokenCount: attempt.usageMetadata?.candidatesTokenCount,
            });

            // 토큰 사용량 저장
            if (attempt.usageMetadata) {
                totalUsageMetadata = attempt.usageMetadata;
            }

            break;
        } catch (err: any) {
            modelAttemptErrors.push({ model, error: err });

            // StageError인 경우만 모델 시도 관련 정보 로깅
            if (err instanceof StageError) {
                console.warn(`[Background] Step 3b: Model ${model} failed at stage '${err.stage}':`, {
                    sessionId,
                    stage: err.stage,
                    message: err.message,
                    details: err.details,
                });
            } else {
                console.warn(`[Background] Step 3b: Model ${model} failed with unexpected error:`, {
                    sessionId,
                    error: summarizeError(err),
                });
            }

            // 마지막 모델이면 종합 에러 발생
            if (i === sequence.length - 1) {
                const errorSummary = modelAttemptErrors.map(e => ({
                    model: e.model,
                    stage: e.error instanceof StageError ? e.error.stage : 'unknown',
                    message: e.error?.message || String(e.error),
                }));

                console.error(`[Background] Step 3b: All models failed`, { sessionId, errorSummary });

                throw new StageError(
                    'extract_all_failed',
                    `All ${sequence.length} models failed to extract problems`,
                    { errorSummary }
                );
            }
        }
    }

    return {
        usedModel,
        responseText,
        result,
        validatedItems,
        usageMetadata: totalUsageMetadata,
    };
}

// 이미지 parts 배열 생성 헬퍼
export interface ImageItem {
    imageBase64: string;
    mimeType: string;
    fileName: string;
}

export function buildImageParts(prompt: string, imageList: ImageItem[], sessionId: string): any[] {
    const parts: any[] = [{ text: prompt }];

    for (let i = 0; i < imageList.length; i++) {
        const img = imageList[i];
        if (!img.imageBase64) {
            console.error(`[Background] Step 3b: Image ${i} (${img.fileName}) has no base64 data!`, { sessionId });
            throw new Error(`Image ${i} (${img.fileName}) has no base64 data`);
        }

        const pageNumber = i + 1;
        const pageCaption = `Page ${pageNumber} of ${imageList.length}. ${i === 0 ? 'Start of problem set.' : 'Continues from previous page.'} ${i === imageList.length - 1 ? 'This is the last page.' : 'Next page follows.'}`;

        parts.push({ text: pageCaption });
        parts.push({ inlineData: { data: img.imageBase64, mimeType: img.mimeType } });

        console.log(`[Background] Step 3b: Added image ${i + 1}/${imageList.length} to parts array with caption`, {
            sessionId,
            fileName: img.fileName,
            mimeType: img.mimeType,
            base64Length: img.imageBase64.length,
            pageCaption,
        });
    }

    return parts;
}

// parts 배열 검증
export function validateParts(parts: any[], expectedImageCount: number, sessionId: string): void {
    if (!parts || !Array.isArray(parts) || parts.length === 0) {
        throw new Error(`Invalid parts array: ${JSON.stringify(parts)}`);
    }

    const inlineDataCount = parts.filter((p: any) => !!p.inlineData).length;
    if (inlineDataCount !== expectedImageCount) {
        console.error(`[Background] Step 3b: Parts array inlineData count mismatch! Expected ${expectedImageCount}, got ${inlineDataCount}`, { sessionId });
        throw new Error(`Parts array inlineData count mismatch: expected ${expectedImageCount}, got ${inlineDataCount}`);
    }
}
