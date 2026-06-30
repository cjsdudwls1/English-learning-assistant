// 사용자 BYOK API 키 관리 — 저장/삭제/목록/활성화
//
// 보안 원칙:
//  - 평문 키는 암호화(cryptoKeys.ts) 후에만 DB 저장. 응답으로 평문/암호문 절대 반환 안 함(hint만).
//  - 본인 식별은 Authorization JWT로만(body의 userId 신뢰 안 함).
//  - 저장 시 1토큰 호출로 키 유효성 1회 검증 → 잘못된 키를 저장해 "Claude 쓰는 줄 알았는데 조용히
//    Gemini로 폴백되는" 착각(confident-wrong 유형)을 방지.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createServiceSupabaseClient } from "../_shared/supabaseClient.ts";
import { handleOptions, jsonResponse, errorResponse } from "../_shared/http.ts";
import { encryptApiKey, makeKeyHint } from "../_shared/cryptoKeys.ts";
import { buildUserKeyClient, isSupportedModel, type UserKeyProvider } from "../_shared/providerClients.ts";

function isValidProvider(p: unknown): p is UserKeyProvider {
  return p === 'anthropic' || p === 'openai';
}

// 키 유효성 1회 검증 (최소 토큰). 인증 실패면 ok:false.
// model을 넘기면 "그 키로 그 모델에 실제 접근 가능한지"까지 검증 → 권한 없는 모델 저장 차단.
async function validateKey(provider: UserKeyProvider, apiKey: string, model?: string | null): Promise<{ ok: boolean; error?: string }> {
  try {
    const client = buildUserKeyClient(provider, apiKey, model ?? undefined);
    await client.models.generateContent({
      model: '',
      contents: 'ping',
      config: { temperature: 0, maxOutputTokens: 1 },
    });
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg.substring(0, 200) };
  }
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return handleOptions();
  if (req.method !== 'POST') return errorResponse('Method not allowed', 405);

  try {
    const supabase = createServiceSupabaseClient();

    // 1) JWT로 본인 식별
    const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
    if (!token) return errorResponse('Unauthorized: 토큰이 없습니다', 401);
    const { data: userData, error: authError } = await supabase.auth.getUser(token);
    if (authError || !userData?.user) return errorResponse('Unauthorized: 유효하지 않은 토큰', 401);
    const userId = userData.user.id;

    const body = await req.json().catch(() => ({}));
    const action = body?.action as string;

    // 2) 목록 (hint만 반환, 암호문 제외)
    if (action === 'list') {
      const { data, error } = await supabase
        .from('user_api_keys')
        .select('provider, key_hint, is_active, updated_at, model')
        .eq('user_id', userId);
      if (error) return errorResponse('목록 조회 실패', 500, error.message);
      return jsonResponse({ keys: data ?? [] });
    }

    // 3) 삭제
    if (action === 'delete') {
      const provider = body?.provider;
      if (!isValidProvider(provider)) return errorResponse('provider가 올바르지 않습니다', 400);
      const { error } = await supabase
        .from('user_api_keys')
        .delete()
        .eq('user_id', userId)
        .eq('provider', provider);
      if (error) return errorResponse('삭제 실패', 500, error.message);
      return jsonResponse({ ok: true });
    }

    // 4) 활성 provider 전환 (저장된 키들 중 하나를 활성화, 나머지 비활성)
    if (action === 'activate') {
      const provider = body?.provider;
      if (provider !== null && !isValidProvider(provider)) {
        return errorResponse('provider가 올바르지 않습니다 (null=시스템 Gemini)', 400);
      }
      // 전부 비활성화 후 대상만 활성화 (provider=null이면 전부 비활성 → 시스템 Gemini 사용)
      await supabase.from('user_api_keys').update({ is_active: false }).eq('user_id', userId);
      if (provider) {
        const { error } = await supabase
          .from('user_api_keys')
          .update({ is_active: true })
          .eq('user_id', userId)
          .eq('provider', provider);
        if (error) return errorResponse('활성화 실패', 500, error.message);
      }
      return jsonResponse({ ok: true, active: provider ?? null });
    }

    // 5) 저장 (검증 → 암호화 → upsert → 활성 1개 보장)
    if (action === 'save') {
      const provider = body?.provider;
      const apiKey = (body?.apiKey ?? '').toString().trim();
      const model = body?.model != null && String(body.model).trim() !== '' ? String(body.model).trim() : null;
      if (!isValidProvider(provider)) return errorResponse('provider가 올바르지 않습니다', 400);
      if (apiKey.length < 8) return errorResponse('API 키가 너무 짧습니다', 400);
      // 화이트리스트 게이트: 미지원/오타 모델 저장 차단 (vision 미지원 모델로 이미지 분석이 조용히 깨지는 것 방지)
      if (!isSupportedModel(provider, model)) {
        return errorResponse('지원하지 않는 모델입니다', 400, `${provider}: ${model}`);
      }

      // 유효성 1회 검증 (선택 모델로 → 그 키가 그 모델에 접근 가능한지까지 확인)
      const v = await validateKey(provider, apiKey, model);
      if (!v.ok) {
        return errorResponse('API 키 검증 실패: 키가 올바른지(또는 선택한 모델 접근 권한이 있는지) 확인하세요', 400, v.error);
      }

      const encrypted = await encryptApiKey(apiKey);
      const keyHint = makeKeyHint(apiKey);

      // 다른 provider는 비활성화 (활성 1개 보장)
      await supabase.from('user_api_keys').update({ is_active: false }).eq('user_id', userId);

      const { error } = await supabase
        .from('user_api_keys')
        .upsert(
          { user_id: userId, provider, encrypted_key: encrypted, key_hint: keyHint, model, is_active: true, updated_at: new Date().toISOString() },
          { onConflict: 'user_id,provider' },
        );
      if (error) return errorResponse('저장 실패', 500, error.message);

      return jsonResponse({ ok: true, provider, key_hint: keyHint, model, is_active: true });
    }

    // 6) 모델만 변경 (키 재입력 없이 활성 키의 model 교체). 평문 키 없으므로 model 권한 재검증은 생략.
    if (action === 'set-model') {
      const provider = body?.provider;
      const model = body?.model != null && String(body.model).trim() !== '' ? String(body.model).trim() : null;
      if (!isValidProvider(provider)) return errorResponse('provider가 올바르지 않습니다', 400);
      if (!isSupportedModel(provider, model)) {
        return errorResponse('지원하지 않는 모델입니다', 400, `${provider}: ${model}`);
      }
      // 해당 provider 키가 존재해야 함
      const { data: existing, error: selErr } = await supabase
        .from('user_api_keys')
        .select('provider')
        .eq('user_id', userId)
        .eq('provider', provider)
        .limit(1);
      if (selErr) return errorResponse('조회 실패', 500, selErr.message);
      if (!existing || existing.length === 0) return errorResponse('먼저 해당 provider의 키를 저장하세요', 400);

      const { error } = await supabase
        .from('user_api_keys')
        .update({ model, updated_at: new Date().toISOString() })
        .eq('user_id', userId)
        .eq('provider', provider);
      if (error) return errorResponse('모델 변경 실패', 500, error.message);
      return jsonResponse({ ok: true, provider, model });
    }

    return errorResponse(`알 수 없는 action: ${action}`, 400);
  } catch (e) {
    return errorResponse('서버 오류', 500, e instanceof Error ? e.message : String(e));
  }
});
