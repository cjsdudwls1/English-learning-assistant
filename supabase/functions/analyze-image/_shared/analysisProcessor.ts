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
    // 없으면 MODEL_SEQUENCE 전체를 순서대로 시도 (gemini-3-pro → 3-flash → 2.5-pro → 2.5-flash)
    const sequence = preferredModel ? [preferredModel] : [...MODEL_SEQUENCE] as string[];

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

// ─── Pass B: 필기 마크 감지 ───

export interface HandwritingMark {
    problem_number: string;
    step1_observation?: string | null;
    user_answer: string | null;
    user_marked_correctness: string | null;
    mark_type?: string | null;
    bbox_norm?: number[] | null;
    confidence?: number;
    ambiguous?: boolean;
    evidence?: string;
}

export interface DetectHandwritingParams {
    ai: any;
    sessionId: string;
    prompt: string;
    imageParts: any[];
}

/**
 * Pass B: 이미지에서 필기 마크(사용자 답변, O/X 표시)만 감지합니다.
 * MODEL_SEQUENCE를 따라 failover: marks=0이면 다음 모델로 재시도
 * 실패해도 빈 배열을 반환하여 전체 파이프라인에 영향을 주지 않습니다.
 */
export async function detectHandwritingMarks(params: DetectHandwritingParams): Promise<{
    marks: HandwritingMark[];
    usageMetadata?: UsageMetadata;
}> {
    const { ai, sessionId, prompt, imageParts } = params;

    // MODEL_SEQUENCE를 따라 failover: marks=0이면 다음 모델로 재시도
    const HANDWRITING_MODELS = [...MODEL_SEQUENCE] as string[];

    let allMarks: HandwritingMark[] = [];
    let lastUsageMetadata: UsageMetadata | undefined;

    for (const model of HANDWRITING_MODELS) {
        try {
            console.log(`[Background] Pass B: Detecting handwriting marks with ${model}...`, { sessionId });

            const parts = [{ text: prompt }, ...imageParts];

            const attempt = await generateWithRetry({
                ai,
                model,
                contents: { parts },
                sessionId,
                maxRetries: 1,
                baseDelayMs: 2000,
                temperature: 0.1, // 0.0에서 약간 올려 마크 보고 적극성 향상
                maxOutputTokens: 4096, // 응답 truncation 방지
            });

            const responseText = await extractTextFromResponse(attempt.response, model);
            lastUsageMetadata = attempt.usageMetadata;

            // 디버깅 로그: raw response 프리뷰
            console.log(`[Pass B] Raw response from ${model} (${responseText.length} chars):`, {
                sessionId,
                preview: responseText.substring(0, 500),
            });

            // Pass B 전용 JSON 파싱: parseJsonResponse의 폴백이 { pages: [...] }를 반환하는 문제 방지
            let marks: HandwritingMark[] = [];
            try {
                const cleaned = responseText.replace(/```json/g, '').replace(/```/g, '').trim();
                const directParsed = JSON.parse(cleaned);
                if (Array.isArray(directParsed.marks)) {
                    marks = directParsed.marks;
                } else if (Array.isArray(directParsed)) {
                    // 모델이 배열만 반환한 경우
                    marks = directParsed;
                }
            } catch {
                // 직접 파싱 실패 시 기존 parseJsonResponse 폴백
                const parsed = parseJsonResponse(responseText, model) as { marks?: HandwritingMark[] };
                if (parsed && Array.isArray(parsed.marks)) {
                    marks = parsed.marks;
                }
            }

            if (marks.length === 0) {
                // 디버깅: marks가 0개일 때 전체 응답 로그
                console.warn(`[Pass B] ${model} returned 0 marks. Full response for debugging:`, {
                    sessionId,
                    fullResponse: responseText.substring(0, 2000),
                });
            } else {
                console.log(`[Pass B] ${model} detected ${marks.length} mark(s):`, {
                    sessionId,
                    marks: marks.map(m => `Q${m.problem_number}: answer=${m.user_answer}, conf=${m.confidence}, bbox=${m.bbox_norm ? 'yes' : 'NO'}`),
                });
            }

            // marks가 있으면 성공, 이 모델로 확정
            if (marks.length > 0) {
                allMarks = marks;
                break;
            }

            // marks가 0개이고 다음 모델이 있으면 재시도
            console.warn(`[Pass B] ${model} returned 0 marks, trying next model...`, { sessionId });

        } catch (err: any) {
            console.warn(`[Pass B] ${model} FAILED (non-critical):`, {
                sessionId,
                error: err?.message || String(err),
            });
            // 다음 모델로 시도
        }
    }

    return { marks: allMarks, usageMetadata: lastUsageMetadata };
}

// ─── Pass C: 분류/메타데이터 생성 (텍스트 기반, 이미지 불필요) ───

export interface ClassificationResult {
    problem_number: string;
    correct_answer?: string | null;
    classification: {
        depth1?: string;
        depth2?: string;
        depth3?: string;
        depth4?: string;
    };
    metadata: {
        difficulty?: string;
        word_difficulty?: number;
        problem_type?: string;
    };
}

export interface ClassifyItemsParams {
    ai: any;
    sessionId: string;
    prompt: string;
    imageParts?: any[]; // 그래프/도표 문제가 있을 때 이미지도 전달
}

/**
 * Pass C: 텍스트만으로 문제를 분류하고 메타데이터를 생성합니다.
 * 이미지를 사용하지 않으므로 정답 추론에 의한 user_answer 오염이 원천 차단됩니다.
 * 실패해도 빈 배열을 반환하여 전체 파이프라인에 영향을 주지 않습니다.
 */
export async function classifyItems(params: ClassifyItemsParams): Promise<{
    classifications: ClassificationResult[];
    usageMetadata?: UsageMetadata;
}> {
    const { ai, sessionId, prompt, imageParts } = params;

    // MODEL_SEQUENCE를 따라 failover
    const CLASSIFICATION_MODELS = [...MODEL_SEQUENCE] as string[];

    for (const classificationModel of CLASSIFICATION_MODELS) {
      try {
        const hasImage = imageParts && imageParts.length > 0;
        console.log(`[Background] Pass C: Classifying items with ${classificationModel}${hasImage ? ' (with image for visual questions)' : ''}...`, { sessionId });

        const parts: any[] = [{ text: prompt }];
        if (hasImage) {
            parts.push(...imageParts);
        }

        const attempt = await generateWithRetry({
            ai,
            model: classificationModel,
            contents: { parts },
            sessionId,
            maxRetries: 1,
            baseDelayMs: 2000,
            temperature: 0.0,
        });

        const responseText = await extractTextFromResponse(attempt.response, classificationModel);
        const parsed = parseJsonResponse(responseText, classificationModel) as { classifications?: ClassificationResult[] };

        if (!parsed || !Array.isArray(parsed.classifications)) {
            console.warn(`[Background] Pass C: Invalid response format from ${classificationModel}, trying next model...`, {
                sessionId,
                parsedKeys: parsed ? Object.keys(parsed) : null,
            });
            continue; // 다음 모델 시도
        }

        console.log(`[Background] Pass C: Classified ${parsed.classifications.length} item(s) with ${classificationModel}`, { sessionId });

        return { classifications: parsed.classifications, usageMetadata: attempt.usageMetadata };
      } catch (err: any) {
        console.warn(`[Background] Pass C: ${classificationModel} FAILED, trying next model...`, {
            sessionId,
            error: err?.message || String(err),
        });
        // 다음 모델로 시도
      }
    }

    // 모든 모델 실패
    console.warn(`[Background] Pass C: All models failed (non-critical)`, { sessionId });
    return { classifications: [] };
}

