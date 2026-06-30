/**
 * 사용자 BYOK 키 조회 (Node.js/GCF) — userId로 활성 키를 DB에서 읽어 복호화한다.
 *
 * Edge의 supabase/functions/_shared/userApiKeys.ts와 동일 로직(JS 포트).
 *  - user_api_keys: PK(user_id, provider), is_active=true 행이 "현재 사용할 provider".
 *  - anthropic/openai만 BYOK 대상(gemini 등은 시스템 키 → null 반환 → 호출부가 Gemini 폴백).
 *  - 복호화 실패/미설정 시 null 반환(조용한 폴백). 평문 키는 반환값으로만 잠깐 존재, 절대 로깅 안 함.
 */
import { decryptApiKey } from './cryptoKeysNode.js';

/**
 * userId의 활성 BYOK 키를 조회·복호화하여 반환. 없거나 실패하면 null.
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string|null|undefined} userId
 * @returns {Promise<{provider:'anthropic'|'openai', apiKey:string, model:string|null}|null>}
 */
export async function getActiveUserKey(supabase, userId) {
  if (!userId) return null;

  try {
    const { data, error } = await supabase
      .from('user_api_keys')
      .select('provider, encrypted_key, model')
      .eq('user_id', userId)
      .eq('is_active', true)
      .limit(1);

    if (error) {
      console.error('[userApiKeys] 조회 실패', { userId, error: String(error.message ?? error).substring(0, 200) });
      return null;
    }

    if (!Array.isArray(data) || data.length === 0) return null;

    const row = data[0];
    if (row.provider !== 'anthropic' && row.provider !== 'openai') {
      return null; // gemini 등 → 시스템 키 사용
    }

    const apiKey = decryptApiKey(row.encrypted_key);
    if (!apiKey) return null;

    return { provider: row.provider, apiKey, model: row.model ?? null };
  } catch (e) {
    // 복호화 실패(시크릿 불일치 등) → 조용히 시스템 키로 폴백
    console.error('[userApiKeys] 복호화/조회 예외 → 시스템 키로 폴백', {
      userId,
      message: e instanceof Error ? e.message : String(e),
    });
    return null;
  }
}
