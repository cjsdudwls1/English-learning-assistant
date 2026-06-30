/**
 * BYOK provider 어댑터 — Anthropic(Claude) / OpenAI(ChatGPT)를 AIClient 인터페이스로 감싼다.
 *
 * 목적: 기존 generateWithRetry / extractTextFromResponse / parseJsonResponse 파이프라인을
 *       provider 교체만으로 그대로 재사용. 호출부는 Gemini와 동일하게 사용한다.
 *
 * 변환 규칙:
 *  - Gemini contents (string | [{role, parts:[{text}|{inlineData}]}]) → provider 메시지
 *  - config.responseMimeType==='application/json' 또는 responseJsonSchema 존재 → JSON 강제
 *  - 응답 → ModelResponse { candidates:[{content:{parts:[{text}]}}], usageMetadata }
 *
 * 보안: apiKey는 인증 헤더에만 사용하고 절대 로깅/반환하지 않는다.
 * 의존성: fetch만 사용(SDK 불필요) → Deno(Edge)·Node18+(GCF) 공용 로직과 동일 구조.
 */
import type { AIClient, ModelResponse } from './aiClient.ts';

export type UserKeyProvider = 'anthropic' | 'openai';

// provider별 기본 모델 (호출부가 Gemini 모델명을 넘겨도 이 값으로 치환)
const DEFAULT_MODELS: Record<UserKeyProvider, string> = {
  anthropic: 'claude-haiku-4-5-20251001',
  openai: 'gpt-4o',
};

const DEFAULT_MAX_TOKENS = 8192;
const HARD_TIMEOUT_MS = 110000; // generateWithRetry의 race(60~120s) 백업용 하드 캡

interface NeutralImage { mimeType: string; data: string; }
interface NeutralPart { kind: 'text' | 'image'; text?: string; image?: NeutralImage; }
interface NeutralMessage { role: 'user' | 'assistant'; parts: NeutralPart[]; }

// ── Gemini contents 정규화 ──────────────────────────────────────────────

function partToNeutral(p: unknown): NeutralPart | null {
  if (typeof p === 'string') return { kind: 'text', text: p };
  if (p && typeof p === 'object') {
    const o = p as Record<string, unknown>;
    if (o.text != null) return { kind: 'text', text: String(o.text) };
    const inline = (o.inlineData ?? o.inline_data) as Record<string, unknown> | undefined;
    if (inline && inline.data) {
      return {
        kind: 'image',
        image: {
          mimeType: String(inline.mimeType ?? inline.mime_type ?? 'image/jpeg'),
          data: String(inline.data),
        },
      };
    }
  }
  return null;
}

function extractSystemText(sys: unknown): string {
  if (!sys) return '';
  if (typeof sys === 'string') return sys;
  if (typeof sys === 'object') {
    const o = sys as Record<string, unknown>;
    if (o.text != null) return String(o.text);
    if (Array.isArray(o.parts)) {
      return o.parts.map((pp) => partToNeutral(pp)).filter((x): x is NeutralPart => !!x && x.kind === 'text').map((x) => x.text).join('\n');
    }
  }
  return '';
}

function normalizeContents(contents: unknown, config?: Record<string, unknown>): { system: string; messages: NeutralMessage[] } {
  const systemParts: string[] = [];
  const sysInstr = config?.systemInstruction;
  const sysText = extractSystemText(sysInstr);
  if (sysText) systemParts.push(sysText);

  const messages: NeutralMessage[] = [];

  const pushOne = (c: unknown) => {
    if (typeof c === 'string') {
      messages.push({ role: 'user', parts: [{ kind: 'text', text: c }] });
      return;
    }
    if (c && typeof c === 'object') {
      const o = c as Record<string, unknown>;
      if (Array.isArray(o.parts) || o.role) {
        const role: 'user' | 'assistant' = o.role === 'model' || o.role === 'assistant' ? 'assistant' : 'user';
        const parts = (Array.isArray(o.parts) ? o.parts : [])
          .map(partToNeutral)
          .filter((x): x is NeutralPart => !!x);
        if (parts.length) messages.push({ role, parts });
        return;
      }
      const single = partToNeutral(o);
      if (single) messages.push({ role: 'user', parts: [single] });
    }
  };

  if (Array.isArray(contents)) contents.forEach(pushOne);
  else pushOne(contents);

  // provider는 비어있지 않은 user 메시지를 요구 → 안전장치
  if (messages.length === 0) messages.push({ role: 'user', parts: [{ kind: 'text', text: '' }] });

  return { system: systemParts.join('\n\n'), messages };
}

function wantsJson(config?: Record<string, unknown>): boolean {
  if (!config) return false;
  return config.responseMimeType === 'application/json' || config.responseJsonSchema != null;
}

function resolveModel(requested: string | undefined, provider: UserKeyProvider): string {
  const r = (requested ?? '').toLowerCase();
  if (provider === 'anthropic' && r.startsWith('claude')) return requested as string;
  if (provider === 'openai' && (r.startsWith('gpt') || r.startsWith('o1') || r.startsWith('o3') || r.startsWith('o4'))) return requested as string;
  return DEFAULT_MODELS[provider];
}

// fetch 에러를 parseModelError가 인식하도록 status를 부착해 throw
function throwHttpError(provider: string, status: number, bodyText: string): never {
  const err = new Error(`${provider} API ${status}: ${bodyText.substring(0, 300)}`) as Error & { status?: number };
  err.status = status;
  throw err;
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), HARD_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

// ── Anthropic 어댑터 ────────────────────────────────────────────────────

function buildAnthropicClient(apiKey: string): AIClient {
  return {
    models: {
      generateContent: async (params): Promise<ModelResponse> => {
        const { contents, config } = params;
        const model = resolveModel(params.model, 'anthropic');
        const { system, messages } = normalizeContents(contents, config);
        const jsonMode = wantsJson(config);

        const anthMessages = messages.map((m) => ({
          role: m.role,
          content: m.parts.map((p) =>
            p.kind === 'image'
              ? { type: 'image', source: { type: 'base64', media_type: p.image!.mimeType, data: p.image!.data } }
              : { type: 'text', text: p.text ?? '' }
          ),
        }));

        let systemPrompt = system;
        if (jsonMode) {
          systemPrompt = `${system}\n\n반드시 유효한 JSON만 출력하라. 마크다운 코드펜스나 설명 문장을 덧붙이지 말 것.`.trim();
        }

        const body: Record<string, unknown> = {
          model,
          max_tokens: (config?.maxOutputTokens as number) || DEFAULT_MAX_TOKENS,
          temperature: (config?.temperature as number) ?? 0,
          messages: anthMessages,
        };
        if (systemPrompt) body.system = systemPrompt;

        const res = await fetchWithTimeout('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json',
          },
          body: JSON.stringify(body),
        });

        if (!res.ok) throwHttpError('anthropic', res.status, await res.text().catch(() => ''));

        const data = await res.json();
        const text = Array.isArray(data?.content)
          ? data.content.filter((b: { type?: string }) => b?.type === 'text').map((b: { text?: string }) => b.text ?? '').join('')
          : '';

        return {
          candidates: [{ finishReason: data?.stop_reason ?? 'STOP', content: { parts: [{ text }] } }],
          usageMetadata: {
            promptTokenCount: data?.usage?.input_tokens,
            candidatesTokenCount: data?.usage?.output_tokens,
            totalTokenCount: (data?.usage?.input_tokens ?? 0) + (data?.usage?.output_tokens ?? 0),
          },
        };
      },
    },
  };
}

// ── OpenAI 어댑터 ───────────────────────────────────────────────────────

function buildOpenAIClient(apiKey: string): AIClient {
  return {
    models: {
      generateContent: async (params): Promise<ModelResponse> => {
        const { contents, config } = params;
        const model = resolveModel(params.model, 'openai');
        const { system, messages } = normalizeContents(contents, config);
        const jsonMode = wantsJson(config);

        const oaMessages: Array<Record<string, unknown>> = [];
        let systemPrompt = system;
        // json_object 모드는 메시지에 'json' 토큰이 반드시 포함되어야 함 → system에 주입
        if (jsonMode) {
          systemPrompt = `${system}\n\nRespond with valid JSON only.`.trim();
        }
        if (systemPrompt) oaMessages.push({ role: 'system', content: systemPrompt });

        for (const m of messages) {
          // 텍스트 단일 메시지는 string content, 이미지 포함 시 멀티파트
          const hasImage = m.parts.some((p) => p.kind === 'image');
          if (!hasImage) {
            oaMessages.push({ role: m.role, content: m.parts.map((p) => p.text ?? '').join('') });
          } else {
            oaMessages.push({
              role: m.role,
              content: m.parts.map((p) =>
                p.kind === 'image'
                  ? { type: 'image_url', image_url: { url: `data:${p.image!.mimeType};base64,${p.image!.data}` } }
                  : { type: 'text', text: p.text ?? '' }
              ),
            });
          }
        }

        const body: Record<string, unknown> = {
          model,
          temperature: (config?.temperature as number) ?? 0,
          max_tokens: (config?.maxOutputTokens as number) || DEFAULT_MAX_TOKENS,
          messages: oaMessages,
        };
        if (jsonMode) body.response_format = { type: 'json_object' };

        const res = await fetchWithTimeout('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify(body),
        });

        if (!res.ok) throwHttpError('openai', res.status, await res.text().catch(() => ''));

        const data = await res.json();
        const text = data?.choices?.[0]?.message?.content ?? '';

        return {
          candidates: [{ finishReason: data?.choices?.[0]?.finish_reason ?? 'STOP', content: { parts: [{ text }] } }],
          usageMetadata: {
            promptTokenCount: data?.usage?.prompt_tokens,
            candidatesTokenCount: data?.usage?.completion_tokens,
            totalTokenCount: data?.usage?.total_tokens,
          },
        };
      },
    },
  };
}

/** provider별 BYOK 클라이언트 생성 */
export function buildUserKeyClient(provider: UserKeyProvider, apiKey: string): AIClient {
  if (provider === 'anthropic') return buildAnthropicClient(apiKey);
  if (provider === 'openai') return buildOpenAIClient(apiKey);
  throw new Error(`지원하지 않는 provider: ${provider}`);
}
