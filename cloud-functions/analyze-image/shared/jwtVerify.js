/**
 * Supabase JWT 검증
 * - Authorization 헤더에서 토큰 추출 후 supabase.auth.getUser()로 검증
 * - 토큰의 user.id를 body.userId와 비교하여 위조 차단
 */

import { createClient } from '@supabase/supabase-js';

/**
 * @param {string|undefined} authHeader - "Bearer xxx" 형태
 * @param {string} supabaseUrl
 * @param {string} supabaseAnonKey - service role 키 아님, anon 키 사용 (RLS 영향 없음)
 * @returns {Promise<{ valid: boolean, userId?: string, error?: string }>}
 */
export async function verifySupabaseJWT(authHeader, supabaseUrl, supabaseAnonKey) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return { valid: false, error: 'Missing or malformed Authorization header' };
  }

  const token = authHeader.slice(7).trim();
  if (!token) {
    return { valid: false, error: 'Empty token' };
  }

  try {
    const authClient = createClient(supabaseUrl, supabaseAnonKey);
    const { data, error } = await authClient.auth.getUser(token);

    if (error || !data?.user?.id) {
      return { valid: false, error: error?.message || 'Invalid token' };
    }

    return { valid: true, userId: data.user.id };
  } catch (e) {
    return { valid: false, error: e?.message || 'JWT verification failed' };
  }
}
