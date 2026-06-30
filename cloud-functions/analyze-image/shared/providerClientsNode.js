/**
 * BYOK provider 어댑터 (Node.js/GCF) — Anthropic(Claude) / OpenAI(ChatGPT)를
 * GCF의 ai.models.generateContent 인터페이스로 감싼다.
 *
 * Edge의 supabase/functions/_shared/providerClients.ts와 동일 로직(JS 포트).
 * 반환 형태 { candidates:[{content:{parts:[{text}]}}], usageMetadata }는
 * aiClient.js의 extractTextFromResponse가 그대로 파싱한다.
 *
 * ⚠️ 정확도 주의: analyze-image 파이프라인은 Gemini 전용으로 튜닝됨(crop/bbox·모델시퀀스·
 *   thinkingBudget·consensus). 이 어댑터로 이미지 분석 시 thinkingConfig/safetySettings/tools는
 *   무시되고 단순 경로로 동작 → 정확도가 낮아질 수 있다. opt-in(사용자 키 등록) 전제.
 *
 * 보안: apiKey는 인증 헤더에만 사용하고 절대 로깅/반환하지 않는다. 의존성은 전역 fetch만 사용.
 */

const DEFAULT_MODELS = {
  anthropic: 'claude-haiku-4-5-20251001',
  openai: 'gpt-4o',
};

const DEFAULT_MAX_TOKENS = 8192;
const HARD_TIMEOUT_MS = 110000;

// ── Gemini contents 정규화 ──────────────────────────────────────────────

function partToNeutral(p) {
  if (typeof p === 'string') return { kind: 'text', text: p };
  if (p && typeof p === 'object') {
    if (p.text != null) return { kind: 'text', text: String(p.text) };
    const inline = p.inlineData ?? p.inline_data;
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

function extractSystemText(sys) {
  if (!sys) return '';
  if (typeof sys === 'string') return sys;
  if (typeof sys === 'object') {
    if (sys.text != null) return String(sys.text);
    if (Array.isArray(sys.parts)) {
      return sys.parts.map(partToNeutral).filter((x) => x && x.kind === 'text').map((x) => x.text).join('\n');
    }
  }
  return '';
}

function normalizeContents(contents, config) {
  const systemParts = [];
  const sysText = extractSystemText(config?.systemInstruction);
  if (sysText) systemParts.push(sysText);

  const messages = [];

  const pushOne = (c) => {
    if (typeof c === 'string') {
      messages.push({ role: 'user', parts: [{ kind: 'text', text: c }] });
      return;
    }
    if (c && typeof c === 'object') {
      if (Array.isArray(c.parts) || c.role) {
        const role = c.role === 'model' || c.role === 'assistant' ? 'assistant' : 'user';
        const parts = (Array.isArray(c.parts) ? c.parts : [])
          .map(partToNeutral)
          .filter((x) => !!x);
        if (parts.length) messages.push({ role, parts });
        return;
      }
      const single = partToNeutral(c);
      if (single) messages.push({ role: 'user', parts: [single] });
    }
  };

  if (Array.isArray(contents)) contents.forEach(pushOne);
  else pushOne(contents);

  if (messages.length === 0) messages.push({ role: 'user', parts: [{ kind: 'text', text: '' }] });

  return { system: systemParts.join('\n\n'), messages };
}

function wantsJson(config) {
  if (!config) return false;
  return config.responseMimeType === 'application/json' || config.responseJsonSchema != null;
}

function resolveModel(requested, preferred, provider) {
  // 사용자가 저장 시 고른 preferred 모델을 최우선. 없거나 provider와 안 맞으면 호출부 requested,
  // 둘 다 provider 불일치(예: 호출부가 넘긴 Gemini 모델명)면 DEFAULT_MODELS로 폴백.
  for (const cand of [preferred, requested]) {
    const r = (cand ?? '').toLowerCase();
    if (provider === 'anthropic' && r.startsWith('claude')) return cand;
    if (provider === 'openai' && (r.startsWith('gpt') || r.startsWith('o1') || r.startsWith('o3') || r.startsWith('o4'))) return cand;
  }
  return DEFAULT_MODELS[provider];
}

function throwHttpError(provider, status, bodyText) {
  const err = new Error(`${provider} API ${status}: ${String(bodyText).substring(0, 300)}`);
  err.status = status;
  throw err;
}

async function fetchWithTimeout(url, init) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), HARD_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

// ── Anthropic 어댑터 ────────────────────────────────────────────────────

function buildAnthropicClient(apiKey, preferredModel) {
  return {
    models: {
      generateContent: async (params) => {
        const { contents, config } = params;
        const model = resolveModel(params.model, preferredModel, 'anthropic');
        const { system, messages } = normalizeContents(contents, config);
        const jsonMode = wantsJson(config);

        const anthMessages = messages.map((m) => ({
          role: m.role,
          content: m.parts.map((p) =>
            p.kind === 'image'
              ? { type: 'image', source: { type: 'base64', media_type: p.image.mimeType, data: p.image.data } }
              : { type: 'text', text: p.text ?? '' }
          ),
        }));

        let systemPrompt = system;
        if (jsonMode) {
          systemPrompt = `${system}\n\n반드시 유효한 JSON만 출력하라. 마크다운 코드펜스나 설명 문장을 덧붙이지 말 것.`.trim();
        }

        const body = {
          model,
          max_tokens: (config?.maxOutputTokens) || DEFAULT_MAX_TOKENS,
          temperature: (config?.temperature) ?? 0,
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
          ? data.content.filter((b) => b?.type === 'text').map((b) => b.text ?? '').join('')
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

function buildOpenAIClient(apiKey, preferredModel) {
  return {
    models: {
      generateContent: async (params) => {
        const { contents, config } = params;
        const model = resolveModel(params.model, preferredModel, 'openai');
        const { system, messages } = normalizeContents(contents, config);
        const jsonMode = wantsJson(config);

        const oaMessages = [];
        let systemPrompt = system;
        if (jsonMode) {
          systemPrompt = `${system}\n\nRespond with valid JSON only.`.trim();
        }
        if (systemPrompt) oaMessages.push({ role: 'system', content: systemPrompt });

        for (const m of messages) {
          const hasImage = m.parts.some((p) => p.kind === 'image');
          if (!hasImage) {
            oaMessages.push({ role: m.role, content: m.parts.map((p) => p.text ?? '').join('') });
          } else {
            oaMessages.push({
              role: m.role,
              content: m.parts.map((p) =>
                p.kind === 'image'
                  ? { type: 'image_url', image_url: { url: `data:${p.image.mimeType};base64,${p.image.data}` } }
                  : { type: 'text', text: p.text ?? '' }
              ),
            });
          }
        }

        const body = {
          model,
          temperature: (config?.temperature) ?? 0,
          max_tokens: (config?.maxOutputTokens) || DEFAULT_MAX_TOKENS,
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
export function buildUserKeyClient(provider, apiKey, preferredModel) {
  if (provider === 'anthropic') return buildAnthropicClient(apiKey, preferredModel);
  if (provider === 'openai') return buildOpenAIClient(apiKey, preferredModel);
  throw new Error(`지원하지 않는 provider: ${provider}`);
}
