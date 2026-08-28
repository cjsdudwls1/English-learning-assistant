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
  THINKING_BUDGET,
} from './config.js';

function computeBackoffDelayMs(baseDelay, attempt) {
  const rawDelay = baseDelay * Math.pow(2, Math.max(0, attempt - 1));
  const jitter = 0.85 + Math.random() * 0.30;
  return Math.round(rawDelay * jitter);
}

/** 이 모델 한 번의 호출에 기본으로 주는 **시도당** 상한. 에이전트 런타임이 남은
 *  벽시계로 이 값을 더 조일 때 기준으로 쓴다(느슨하게 푸는 데는 쓰지 않는다). */
export function resolveTimeoutMs(model, hasTools) {
  if (hasTools) return API_TIMEOUT_MS.withTools;
  if (model.includes('gemini-3')) return API_TIMEOUT_MS.gemini3;
  return API_TIMEOUT_MS.default;
}

/** 샘플링 파라미터(temperature/top_p/top_k)와 숫자형 thinkingBudget이 통하지 않는 모델.
 *
 *  공식 문서(ai.google.dev/gemini-api/docs/latest-model)는 "Strip temperature, top_p, top_k
 *  from generation configs"라고 명시하고, 이후 세대에서는 400을 반환한다고 예고한다.
 *  thinking도 숫자 budget → 문자열 thinkingLevel("low"/"medium"/"high")로 대체됐다.
 *
 *  Vertex 실측(2026-08-16, REST 직접 호출, 같은 프롬프트 반복):
 *   · 400은 아직 안 난다 — temperature·thinkingBudget:0 모두 HTTP 200. "거부"는 미래형이다.
 *   · 대신 **정말로 무시된다**:
 *       3.5-flash  T=0.0 → Lion×6 (완전 결정적) / T=2.0 → 흔들림  ⇒ 파라미터가 먹는다
 *       3.6-flash  T=0.0 → Elephant·Lion·Tiger 혼재            ⇒ 먹지 않는다
 *
 *  그래서 이 게이팅의 값어치는 400 예방이 아니라 **코드가 거짓말하지 않게 하는 것**이다.
 *  temperature: 0.0을 계속 넘기면 "이 경로는 결정적"이라는 착각이 코드에 남는데,
 *  3.6에서는 같은 입력이 실행마다 다른 답을 낼 수 있다. 결정성이 필요하면 seed를 쓴다
 *  (아래 generateWithRetry의 seed/thinkingLevel 주석 참조).
 *
 *  ⚠️ 새 모델을 시퀀스에 추가할 때 이 목록도 함께 갱신할 것. 판단 기준은 "3.6 이후 세대인가". */
const NO_SAMPLING_PARAMS = [
  /^gemini-3\.5-flash-lite/,
  /^gemini-3\.6-/,
];

function acceptsSamplingParams(model) {
  return !NO_SAMPLING_PARAMS.some((re) => re.test(model));
}

const SAFETY_SETTINGS = [
  { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
  { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
  { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
  { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
];

// NOTE: `maxRetries` is the MAX TOTAL ATTEMPT COUNT (not extra retries).
// e.g. maxRetries=1 → 1 attempt, 0 retries on failure.
//      maxRetries=2 → up to 2 attempts (1 retry on retryable failure).
/**
 * @param {number}  [seed]          난수 시드. 3.6 이후 세대에서 temperature를 대신해 재현성을 얻는
 *                                  유일한 수단이다. 공식 GenerationConfig 레퍼런스도 "seed를 설정하면
 *                                  출력이 mostly deterministic"이라고만 말한다 — 보장이 아니다.
 * @param {'low'|'medium'|'high'} [thinkingLevel]
 *                                  thinking 강도. 숫자 thinkingBudget의 후속 파라미터.
 *                                  지정하면 모든 모델에 그대로 전달한다(3.5-flash·3.1-flash-lite·
 *                                  3.5-flash-lite 모두 200 확인). thinkingBudget보다 우선한다.
 *
 * 재현성 실측(2026-08-16, gemini-3.6-flash, 같은 프롬프트 반복):
 *   seed만 (thinking 미지정)   → 흔들림
 *   thinkingLevel:low만        → 흔들림
 *   seed + thinkingLevel:low   → 6/6 동일
 *   seed + thinkingLevel:high  → 10/10 동일
 *   seed + thinkingLevel:medium→ 10회 중 앞 5·뒤 5로 갈림
 * 둘을 **함께** 고정해야 잡힌다. 다만 medium이 갈린 모양이 무작위가 아니라 앞뒤 블록이라
 * 서버측 라우팅 변화가 의심된다 — 즉 high의 10/10도 "그 시점에 안정적이었다"이지
 * 재현 보장이 아니다. 정확도를 실측할 때 1회 결과로 판단하면 안 되는 이유.
 */
export async function generateWithRetry({
  ai, model, contents, sessionId,
  maxRetries, baseDelayMs, temperature,
  maxOutputTokens, tools, responseJsonSchema,
  thinkingBudget, thinkingLevel, seed, timeoutMs: timeoutMsOverride,
}) {
  let attempt = 0;

  while (attempt < maxRetries) {
    try {
      console.log(`[aiClient] 모델 호출 attempt ${attempt + 1}/${maxRetries} (model=${model})`, { sessionId });

      const legacyParamsOk = acceptsSamplingParams(model);

      const config = { ...(maxOutputTokens ? { maxOutputTokens } : {}) };
      // 샘플링 파라미터는 받아주는 세대에만 보낸다(위 NO_SAMPLING_PARAMS 주석 참조).
      // 안 보내도 손해가 없다 — temperature 0.0은 결정적 출력을 노린 값이고
      // 새 세대는 그게 기본 동작이다.
      if (legacyParamsOk) config.temperature = temperature;
      // seed는 세대 무관하게 그대로 보낸다 — 구세대에서도 재현성을 해치지 않는다.
      if (seed !== undefined) config.seed = seed;
      if (!tools) config.responseMimeType = 'application/json';
      if (responseJsonSchema) config.responseJsonSchema = responseJsonSchema;
      // thinking 예산. 호출자가 thinkingBudget을 넘기면 전역 THINKING_BUDGET을 덮는다:
      //   미지정(undefined) → 전역값 적용(현행 보존)
      //   null             → thinkingConfig 자체를 안 보냄 = 모델 기본 thinking
      //   숫자             → 그 값 사용
      // null이 필요한 이유: 전역 THINKING_BUDGET=0은 지연을 줄이려는 스위치인데,
      // 정확도가 생명인 경로(splitPipeline)까지 thinking을 꺼버린다. 그 경로만 되살린다.
      //
      // 새 세대는 숫자 budget 대신 문자열 thinkingLevel을 쓴다. thinkingLevel이 지정되면
      // 그쪽이 이기고, 숫자 budget은 구세대에서만 의미를 갖는다.
      const effectiveBudget = thinkingBudget !== undefined ? thinkingBudget : THINKING_BUDGET;
      if (thinkingLevel) {
        config.thinkingConfig = { thinkingLevel };
      } else if (legacyParamsOk && effectiveBudget !== undefined && effectiveBudget !== null && !Number.isNaN(effectiveBudget)) {
        config.thinkingConfig = { thinkingBudget: effectiveBudget };
      }

      const timeoutMs = timeoutMsOverride || resolveTimeoutMs(model, !!tools);

      let timeoutHandle;
      const timeoutPromise = new Promise((_, reject) => {
        timeoutHandle = setTimeout(
          () => reject(new Error(`API call timeout after ${timeoutMs / 1000}s`)),
          timeoutMs
        );
      });
      let response;
      try {
        response = await Promise.race([
          ai.models.generateContent({
            model, contents, config,
            safetySettings: SAFETY_SETTINGS,
            ...(tools ? { tools } : {}),
          }),
          timeoutPromise,
        ]);
      } finally {
        clearTimeout(timeoutHandle);
      }

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

  let lastResult = null;
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
      lastResult = { model, parsed, usageMetadata };

      // 빈 결과(items/problems 0개)는 동시 호출 부하 하의 간헐적 빈 응답일 수 있다
      // (모델이 thinking에 토큰을 소진하고 출력이 비는 현상 관찰됨) → 다음 모델로 failover.
      // 실제 빈/blank 페이지라면 모든 모델이 빈 결과를 내고, 루프 종료 후 마지막 결과를 반환한다.
      const itemCount = (parsed?.items?.length ?? 0) + (parsed?.problems?.length ?? 0);
      if (itemCount === 0) {
        console.warn(`[aiClient] 모델 ${model} 빈 결과(0 items), 다음 모델로 failover`, { sessionId });
        continue;
      }
      return { model, parsed, usageMetadata };
    } catch (modelError) {
      console.warn(`[aiClient] 모델 ${model} 실패, 다음 모델 시도...`, { sessionId, error: modelError?.message });
      continue;
    }
  }

  // 모든 모델이 빈 결과를 반환한 경우(예: 실제 빈 페이지)에는 마지막 파싱 결과라도 반환
  if (lastResult) {
    console.warn(`[aiClient] 모든 모델이 빈 결과 반환, 마지막 결과 사용`, { sessionId });
    return lastResult;
  }

  throw new StageError('all_models_failed', '모든 모델 호출 실패');
}
