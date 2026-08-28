import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { authLock } from './authLock';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string || 'https://temp.supabase.co';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string || 'temp_key_for_build';

if (!import.meta.env.VITE_SUPABASE_URL || !import.meta.env.VITE_SUPABASE_ANON_KEY) {
  console.warn('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY - using temporary values');
}

// 싱글톤 패턴: HMR로 인한 다중 인스턴스 방지
let supabaseInstance: SupabaseClient | null = null;

function getSupabaseClient(): SupabaseClient {
  if (!supabaseInstance) {
    supabaseInstance = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        storageKey: 'edu-english-learning-auth',
        detectSessionInUrl: true,
        // lockAcquireTimeout으로 상한만 바꾸는 건 불가능하다 — supabase-js가 auth 옵션을
        // 화이트리스트로 구조분해해(dist/index.mjs _initSupabaseAuthClient) 조용히 버린다.
        // lock은 그 목록에 있어 실제로 전달되는 유일한 경로다. 이유는 authLock.ts 참조.
        lock: authLock,
      }
    });
  }
  return supabaseInstance;
}

export const supabase = getSupabaseClient();
