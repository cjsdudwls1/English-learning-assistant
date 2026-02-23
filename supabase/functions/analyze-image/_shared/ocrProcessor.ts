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
 * MODEL_SEQUENCE를 따라 순차적으로 모델을 시도합니다.
 */
export async function processOcr(params: ProcessOcrParams): Promise<ProcessOcrResult> {
    const { ai, imageList, sessionId } = params;

    let ocrPages: OcrPage[] = [];
    let usedModel: string | null = null;
    let totalUsageMetadata: UsageMetadata = {};

    // OCR 프롬프트 및 이미지 파트 준비
    const ocrPrompt = buildOcrPrompt(imageList.length);
    const ocrParts: any[] = [{ text: ocrPrompt }];

    for (let i = 0; i < imageList.length; i++) {
        const img = imageList[i];
        const pageNumber = i + 1;
        const pageCaption = `Page ${pageNumber} of ${imageList.length}. ${i === 0 ? 'Start of problem set.' : 'Continues from previous page.'} ${i === imageList.length - 1 ? 'This is the last page.' : 'Next page follows.'}`;
        ocrParts.push({ text: pageCaption });
        ocrParts.push({ inlineData: { data: img.imageBase64, mimeType: img.mimeType } });
    }

    console.log(`[Background] Step 3a-1: Starting OCR attempt cycle with ${MODEL_SEQUENCE.length} models...`, { sessionId });

    for (let i = 0; i < MODEL_SEQUENCE.length; i++) {
        const model = MODEL_SEQUENCE[i];
        const policy = MODEL_RETRY_POLICY[model];

        try {
            console.log(`[Background] Step 3a-1: Trying OCR with model ${i + 1}/${MODEL_SEQUENCE.length}: ${model}`, { sessionId });

            const ocrAttempt = await generateWithRetry({
                ai,
                model: model,
                contents: { parts: ocrParts },
                sessionId,
                maxRetries: policy?.maxRetries ?? 1,
                baseDelayMs: policy?.baseDelayMs ?? 3000,
                temperature: 0.0,
            });

            // 텍스트 추출 (공통 함수 사용)
            const ocrText = await extractTextFromResponse(ocrAttempt.response, model);

            // JSON 파싱 (공통 함수 사용)
            const parsedOcr = parseJsonResponse(ocrText, model) as { pages?: Array<{ page?: number; text?: string }> };

            if (parsedOcr?.pages && Array.isArray(parsedOcr.pages)) {
                ocrPages = parsedOcr.pages
                    .map((p, idx) => ({
                        page: Number(p?.page) || idx + 1,
                        text: typeof p?.text === 'string' ? p.text : '',
                    }))
                    .sort((a, b) => a.page - b.page);

                usedModel = model;
                // 토큰 사용량 저장
                if (ocrAttempt.usageMetadata) {
                    totalUsageMetadata = ocrAttempt.usageMetadata;
                }
                console.log(`[Background] Step 3a-1: OCR success with ${model}`, {
                    sessionId,
                    pageCount: ocrPages.length,
                    promptTokenCount: ocrAttempt.usageMetadata?.promptTokenCount,
                    candidatesTokenCount: ocrAttempt.usageMetadata?.candidatesTokenCount,
                });
                break; // OCR 성공 시 루프 종료
            } else {
                throw new Error(`Invalid OCR response structure from ${model}`);
            }
        } catch (ocrError) {
            console.warn(`[Background] Step 3a-1: OCR attempt failed with ${model}`, {
                sessionId,
                error: summarizeError(ocrError)
            });
            // 마지막 모델까지 실패하면 ocrPages는 빈 배열로 남음
        }
    }

    return { ocrPages, usedModel, usageMetadata: totalUsageMetadata };
}
