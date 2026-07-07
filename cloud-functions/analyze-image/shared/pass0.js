/**
 * Pass 0: 바운딩 박스 좌표 추출 — full_bbox/answer_area_bbox(0~1000 정규화)
 */

import { generateWithRetry, extractTextFromResponse, parseJsonResponse } from './aiClient.js';
import { LIGHTWEIGHT_MODEL_SEQUENCE } from './config.js';
import { buildBoundingBoxPrompt } from './prompts.js';
import { runWithModelFallback } from './modelFallback.js';

/**
 * Pass 0: 바운딩 박스 좌표 추출
 * @returns {{ bboxes: Array, usageMetadata: object|null }}
 */
export async function executePass0({ ai, sessionId, imageBase64, mimeType }) {
  const prompt = buildBoundingBoxPrompt();
  const parts = [
    { text: prompt },
    { inlineData: { data: imageBase64, mimeType } },
  ];

  const result = await runWithModelFallback({
    models: LIGHTWEIGHT_MODEL_SEQUENCE,
    callFn: async (model) => {
      const { response, usageMetadata } = await generateWithRetry({
        ai, model,
        contents: [{ role: 'user', parts }],
        sessionId, maxRetries: 2, baseDelayMs: 2000, temperature: 0.0,
      });
      const text = extractTextFromResponse(response, model);
      const parsed = parseJsonResponse(text, model);
      const bboxes = parsed.problems || [];
      if (bboxes.length === 0) {
        console.warn(`[passes] Pass 0 모델 ${model}이 bbox 0개 반환, 다음 모델로 폴백`);
        throw new Error('bbox 0개');
      }
      return { bboxes, usageMetadata };
    },
  });

  return result ?? { bboxes: [], usageMetadata: null };
}
