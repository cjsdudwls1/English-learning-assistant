// 사용자 BYOK API 키 관리 서비스 — manage-api-keys Edge Function 호출 래퍼
//
// 보안: 평문 키는 이 모듈을 거쳐 Edge Function으로만 전송되며, localStorage 등에 절대 저장하지 않는다.
//       서버는 암호화 후 저장하고, 조회 시에는 끝 4자리 hint만 돌려준다.
import { supabase } from './supabaseClient';

export type ApiKeyProvider = 'anthropic' | 'openai';

export interface ApiKeyInfo {
  provider: ApiKeyProvider;
  key_hint: string | null;
  is_active: boolean;
  updated_at?: string;
  model?: string | null;
}

async function callManageApiKeys(body: Record<string, unknown>): Promise<any> {
  const functionUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/manage-api-keys`;
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error('로그인이 필요합니다');

  const res = await fetch(functionUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${session.access_token}`,
    },
    body: JSON.stringify(body),
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `요청 실패 (${res.status})`);
  return json;
}

/** 저장된 키 목록(hint만). 평문 키는 절대 반환되지 않음. */
export async function listApiKeys(): Promise<ApiKeyInfo[]> {
  const r = await callManageApiKeys({ action: 'list' });
  return (r.keys ?? []) as ApiKeyInfo[];
}

/** 키 저장(서버가 1회 유효성 검증 후 암호화 저장). 저장된 provider가 활성화됨.
 *  model: 사용자가 고른 모델(미지정 시 서버 기본 모델 사용). 서버 화이트리스트로 검증됨. */
export async function saveApiKey(provider: ApiKeyProvider, apiKey: string, model?: string | null): Promise<ApiKeyInfo> {
  const r = await callManageApiKeys({ action: 'save', provider, apiKey, model: model ?? null });
  return { provider: r.provider, key_hint: r.key_hint, is_active: r.is_active, model: r.model ?? null };
}

/** 키 삭제 */
export async function deleteApiKey(provider: ApiKeyProvider): Promise<void> {
  await callManageApiKeys({ action: 'delete', provider });
}

/** 키 재입력 없이 모델만 변경(이미 저장된 provider 대상). 서버 화이트리스트로 검증됨. */
export async function setApiKeyModel(provider: ApiKeyProvider, model: string): Promise<void> {
  await callManageApiKeys({ action: 'set-model', provider, model });
}

/** 활성 provider 전환. null이면 시스템 Gemini 사용. */
export async function activateProvider(provider: ApiKeyProvider | null): Promise<void> {
  await callManageApiKeys({ action: 'activate', provider });
}
