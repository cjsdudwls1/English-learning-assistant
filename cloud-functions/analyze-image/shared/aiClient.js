/**
 * AI 클라이언트 모듈
 * - Gemini API 재시도 로직 (지수 백오프)
 * - 응답 텍스트 추출 및 JSON 파싱
 * - 모델 Failover (시퀀스 순회)
 */

import { StageError, parseModelError } from './errors.js';
import {
  MODEL_SEQUENCE,
  MODEL_RETRY_POLICY,
  EXTRACTION_TEMPERATURE,
  API_TIMEOUT_MS,
} from './config.js';

function computeBackoffDelayMs(baseDelay, attempt) {
  const rawDelay = baseDelay * Math.pow(2, Math.max(0, attempt - 1));
  const jitter = 0.85 + Math.random() * 0.30;
  return Math.round(rawDelay * jitter);
}

function resolveTimeoutMs(model, hasTools) {
  if (hasTools) return API_TIMEOUT_MS.withTools;
  if (model.includes('gemini-3')) return API_TIMEOUT_MS.gemini3;
  return API_TIMEOUT_MS.default;
}

const SAFETY_SETTINGS = [
  { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
  { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
  { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
  { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
];

export async function generateWithRetry({
  ai, model, contents, sessionId,
  maxRetries, baseDelayMs, temperature,
  maxOutputTokens, tools, responseJsonSchema,
}) {
  let attempt = 0;

  while (attempt < maxRetries) {
    try {
      console.log(`[aiClient] 모델 호출 attempt ${attempt + 1}/${maxRetries} (model=${model})`, { sessionId });

      const config = { temperature, ...(maxOutputTokens ? { maxOutputTokens } : {}) };
      if (!tools) config.responseMimeType = 'application/json';
      if (responseJsonSchema) config.responseJsonSchema = responseJsonSchema;

      const timeoutMs = resolveTimeoutMs(model, !!tools);

      const response = await Promise.race([
        ai.models.generateContent({
          model, contents, config,
          safetySettings: SAFETY_SETTINGS,
          ...(tools ? { tools } : {}),
        }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error(`API call timeout after ${timeoutMs / 1000}s`)), timeoutMs)
        ),
      ]);

      const usageMetadata = response.usageMetadata;
      if (usageMetadata) {
        console.log(`[aiClient] 토큰 사용량 (model=${model}):`, {
          sessionId,
          promptTokenCount: usageMetadata.promptTokenCount,
          candidatesTokenCount: usageMetadata.candidatesTokenCount,
          totalTokenCount: usageMetadata.totalTokenCount,
        });
      }

      return { response, attemptCount: attempt + 1, usageMetadata };
    } catch (apiError) {
      attempt++;
      const parsed = parseModelError(apiError);
      console.error(`[aiClient] 모델 에러 (attempt ${attempt}/${maxRetries}, model=${model}):`, {
        sessionId,
        errorCode: parsed.errorCode,
        errorMessage: String(parsed.errorMessage).substring(0, 200),
      });

      const isRetryable = parsed.isRateLimit || parsed.isServerOverload || parsed.isTimeout;
      if (attempt >= maxRetries || !isRetryable) {
        throw new StageError('model_call', `모델 호출 실패 (${attempt}회 시도, model=${model})`, {
          model, attempt, maxRetries,
          errorCode: parsed.errorCode,
          errorMessage: String(parsed.errorMessage).substring(0, 500),
        });
      }

      const delayMs = computeBackoffDelayMs(baseDelayMs, attempt);
      console.warn(`[aiClient] ${Math.round(delayMs / 1000)}초 후 재시도...`, { sessionId });
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }

  throw new StageError('model_call', `모델 호출 실패 (응답 없음, model=${model})`, { model });
}

export function extractTextFromResponse(response, model) {
  let text = '';

  if (response?.text) {
    text = typeof response.text === 'function' ? response.text() : response.text;
  } else if (response?.response?.text) {
    text = typeof response.response.text === 'function' ? response.response.text() : response.response.text;
  } else if (response?.candidates?.[0]?.content?.parts?.[0]?.text) {
    text = response.candidates[0].content.parts[0].text;
  } else {
    throw new StageError('response_parse', `모델 응답에 내용 없음 (model=${model})`);
  }

  if (!text || typeof text !== 'string') {
    throw new StageError('response_parse', `유효하지 않은 응답 텍스트 (model=${model})`);
  }

  return text;
}

export function parseJsonResponse(text, model) {
  const jsonString = text.replace(/```json/g, '').replace(/```/g, '').trim();

  try {
    return JSON.parse(jsonString);
  } catch {
    try {
      const cleaned = jsonString.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '').replace(/\t/g, '    ');
      return JSON.parse(cleaned);
    } catch {
      const MIN_FALLBACK_LENGTH = 50;
      if (jsonString.length > MIN_FALLBACK_LENGTH) {
        console.warn(`[aiClient] JSON 파싱 실패, 원문 텍스트 폴백 (model=${model})`);
        return { pages: [{ page: 1, text: jsonString }] };
      }
      throw new StageError('json_parse', `JSON 파싱 실패 (model=${model})`);
    }
  }
}

/**
 * 모델 시퀀스를 순회하며 Failover 호출
 * @returns {{ model: string, parsed: object, usageMetadata: object }}
 */
export async function callModelWithFailover({ ai, sessionId, parts, preferredModel }) {
  const sequence = preferredModel
    ? [preferredModel, ...MODEL_SEQUENCE.filter(modelName => modelName !== preferredModel)]
    : [...MODEL_SEQUENCE];

  for (const model of sequence) {
    const policy = MODEL_RETRY_POLICY[model] || { maxRetries: 1, baseDelayMs: 3000 };
    try {
      const { response, usageMetadata } = await generateWithRetry({
        ai, model,
        contents: [{ role: 'user', parts }],
        sessionId,
        maxRetries: policy.maxRetries,
        baseDelayMs: policy.baseDelayMs,
        temperature: EXTRACTION_TEMPERATURE,
      });
      const text = extractTextFromResponse(response, model);
      const parsed = parseJsonResponse(text, model);
      return { model, parsed, usageMetadata };
    } catch (modelError) {
      console.warn(`[aiClient] 모델 ${model} 실패, 다음 모델 시도...`, { sessionId, error: modelError?.message });
      continue;
    }
  }

  throw new StageError('all_models_failed', '모든 모델 호출 실패');
}
