/**
 * 사용자 BYOK 키 조회 — userId로 활성 키를 DB에서 읽어 복호화한다.
 *
 * - user_api_keys 테이블: PK(user_id, provider), is_active=true 행이 "현재 사용할 provider".
 *   (활성 키는 user당 최대 1개로 manage-api-keys에서 보장)
 * - 복호화 실패/미설정 시 null 반환 → 호출부는 시스템 Gemini로 자동 폴백.
 * - 평문 키는 반환값으로만 잠깐 메모리에 존재하고 절대 로깅하지 않는다.
 */
import { decryptApiKey } from './cryptoKeys.ts';
import type { UserKeyProvider } from './providerClients.ts';

export interface UserKeyRecord {
  provider: UserKeyProvider;
  apiKey: string;
  model?: string | null;
}

// 최소한의 Supabase 클라이언트 형태 (느슨하게 받아 함수 간 결합 최소화)
interface SupabaseLike {
  from: (table: string) => {
    select: (cols: string) => {
      eq: (col: string, val: unknown) => {
        eq: (col: string, val: unknown) => {
          limit: (n: number) => Promise<{ data: unknown; error: unknown }>;
        };
      };
    };
  };
}

/**
 * userId의 활성 BYOK 키를 조회·복호화하여 반환. 없거나 실패하면 null.
 */
export async function getActiveUserKey(
  supabase: SupabaseLike,
  userId: string | null | undefined,
): Promise<UserKeyRecord | null> {
  if (!userId) return null;

  try {
    const { data, error } = await supabase
      .from('user_api_keys')
      .select('provider, encrypted_key, model')
      .eq('user_id', userId)
      .eq('is_active', true)
      .limit(1);

    if (error) {
      console.error('[userApiKeys] 조회 실패', { userId, error: String(error).substring(0, 200) });
      return null;
    }

    const rows = data as Array<{ provider: string; encrypted_key: string; model: string | null }> | null;
    if (!rows || rows.length === 0) return null;

    const row = rows[0];
    if (row.provider !== 'anthropic' && row.provider !== 'openai') {
      // gemini 등은 시스템 키 사용 → BYOK 불필요
      return null;
    }

    const apiKey = await decryptApiKey(row.encrypted_key);
    if (!apiKey) return null;

    return { provider: row.provider, apiKey, model: row.model ?? null };
  } catch (e) {
    // 복호화 실패(시크릿 불일치 등) 시 조용히 폴백
    console.error('[userApiKeys] 복호화/조회 예외 → 시스템 키로 폴백', {
      userId,
      message: e instanceof Error ? e.message : String(e),
    });
    return null;
  }
}
