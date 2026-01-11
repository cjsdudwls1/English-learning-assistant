import { supabase } from '../supabaseClient';

export async function getCurrentUserId(): Promise<string> {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    throw new Error('로그인이 필요합니다.');
  }
  return data.user.id;
}


