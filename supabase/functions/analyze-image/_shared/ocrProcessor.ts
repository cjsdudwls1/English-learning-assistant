// OCR 처리 로직
import { generateWithRetry, extractTextFromResponse, parseJsonResponse, type UsageMetadata } from '../../_shared/aiClient.ts';
import { MODEL_SEQUENCE, MODEL_RETRY_POLICY } from '../../_shared/models.ts';
import { summarizeError } from '../../_shared/errors.ts';
import { buildOcrPrompt } from './prompts.ts';

// OCR 페이지 타입
export interface OcrPage {
    page: number;
    text: string;
}

// 이미지 아이템 타입
export interface ImageItem {
    imageBase64: string;
    mimeType: string;
    fileName: string;
}

// OCR 처리 파라미터
export interface ProcessOcrParams {
    ai: any;
    imageList: ImageItem[];
    sessionId: string;
}

// OCR 처리 결과
export interface ProcessOcrResult {
    ocrPages: OcrPage[];
    usedModel: string | null;
    usageMetadata?: UsageMetadata;
}

/**
 * 이미지 목록에서 OCR을 수행하여 페이지별 텍스트를 추출합니다.
 * 메모리 절약을 위해 이미지를 1장씩 순차적으로 처리합니다.
 * MODEL_SEQUENCE를 따라 순차적으로 모델을 시도합니다.
 */
export async function processOcr(params: ProcessOcrParams): Promise<ProcessOcrResult> {
    const { ai, imageList, sessionId } = params;

    let usedModel: string | null = null;
    let totalUsageMetadata: UsageMetadata = {};

    const BATCH_SIZE = 3; // 메모리 고려하여 3개씩 병렬 처리
    console.log(`[Background] Step 3a-1: Starting parallel OCR for ${imageList.length} page(s) (batch size: ${BATCH_SIZE})...`, { sessionId });

    // OCR 전용 모델 순서
    const ocrModels = (MODEL_SEQUENCE as readonly string[]).filter(m => m !== 'gemini-3-flash-preview') as string[];
    if (ocrModels.length === 0) ocrModels.push(...(MODEL_SEQUENCE as readonly string[]));

    // 단일 페이지 OCR 처리 함수
    async function processOnePage(pageIdx: number): Promise<OcrPage> {
        const img = imageList[pageIdx];
        const pageNumber = pageIdx + 1;
        let pageOcrText = '';

        console.log(`[Background] Step 3a-1: Processing page ${pageNumber}/${imageList.length} (${img.fileName})...`, { sessionId });

        const singlePagePrompt = buildOcrPrompt(1);
        const singleParts: any[] = [
            { text: singlePagePrompt },
            { text: `Page ${pageNumber} of ${imageList.length}. Single page OCR.` },
            { inlineData: { data: img.imageBase64, mimeType: img.mimeType } },
        ];

        for (let modelIdx = 0; modelIdx < ocrModels.length; modelIdx++) {
            const model = ocrModels[modelIdx];
            const policy = (MODEL_RETRY_POLICY as any)[model];

            try {
                console.log(`[Background] Step 3a-1: Page ${pageNumber} - Trying model ${modelIdx + 1}/${ocrModels.length}: ${model}`, { sessionId });

                const ocrAttempt = await generateWithRetry({
                    ai,
                    model: model,
                    contents: { parts: singleParts },
                    sessionId,
                    maxRetries: policy?.maxRetries ?? 1,
                    baseDelayMs: policy?.baseDelayMs ?? 3000,
                    temperature: 0.0,
                });

                const ocrText = await extractTextFromResponse(ocrAttempt.response, model);
                const parsedOcr = parseJsonResponse(ocrText, model) as { pages?: Array<{ page?: number; text?: string }> };

                if (parsedOcr?.pages && Array.isArray(parsedOcr.pages) && parsedOcr.pages.length > 0) {
                    pageOcrText = parsedOcr.pages.map(p => typeof p?.text === 'string' ? p.text : '').join('\n');
                    usedModel = model;

                    if (ocrAttempt.usageMetadata) {
                        totalUsageMetadata.promptTokenCount = (totalUsageMetadata.promptTokenCount || 0) + (ocrAttempt.usageMetadata.promptTokenCount || 0);
                        totalUsageMetadata.candidatesTokenCount = (totalUsageMetadata.candidatesTokenCount || 0) + (ocrAttempt.usageMetadata.candidatesTokenCount || 0);
                        totalUsageMetadata.totalTokenCount = (totalUsageMetadata.totalTokenCount || 0) + (ocrAttempt.usageMetadata.totalTokenCount || 0);
                    }

                    console.log(`[Background] Step 3a-1: Page ${pageNumber} OCR success with ${model}`, {
                        sessionId,
                        textLength: pageOcrText.length,
                    });
                    break;
                } else {
                    throw new Error(`Invalid OCR response structure from ${model} for page ${pageNumber}`);
                }
            } catch (ocrError) {
                console.warn(`[Background] Step 3a-1: Page ${pageNumber} OCR failed with ${model}`, {
                    sessionId,
                    error: summarizeError(ocrError),
                });
            }
        }

        // Base64 해제
        (imageList[pageIdx] as any).imageBase64 = '';
        console.log(`[Background] Step 3a-1: Page ${pageNumber} - Released base64 data from memory`, { sessionId });

        if (!pageOcrText) {
            console.warn(`[Background] Step 3a-1: Page ${pageNumber} - All models failed for OCR`, { sessionId });
        }

        return { page: pageNumber, text: pageOcrText };
    }

    // 배치별 병렬 처리
    const ocrPages: OcrPage[] = [];
    for (let batchStart = 0; batchStart < imageList.length; batchStart += BATCH_SIZE) {
        const batchEnd = Math.min(batchStart + BATCH_SIZE, imageList.length);
        const batchIndices = Array.from({ length: batchEnd - batchStart }, (_, i) => batchStart + i);

        console.log(`[Background] Step 3a-1: Processing batch ${Math.floor(batchStart / BATCH_SIZE) + 1} (pages ${batchStart + 1}-${batchEnd})...`, { sessionId });

        const batchResults = await Promise.all(batchIndices.map(idx => processOnePage(idx)));
        ocrPages.push(...batchResults);
    }

    // 페이지 번호 순으로 정렬
    ocrPages.sort((a, b) => a.page - b.page);

    console.log(`[Background] Step 3a-1: Parallel OCR completed. ${ocrPages.filter(p => p.text.length > 0).length}/${imageList.length} pages succeeded`, { sessionId });

    return { ocrPages, usedModel, usageMetadata: totalUsageMetadata };
}

