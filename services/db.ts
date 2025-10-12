import { supabase } from './supabaseClient';

export async function getCurrentUserId(): Promise<string> {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    throw new Error('로그인이 필요합니다.');
  }
  return data.user.id;
}

export async function uploadProblemImage(file: File): Promise<string> {
  const userId = await getCurrentUserId();
  const timestamp = Date.now();
  const safeName = file.name.replace(/[^a-zA-Z0-9_.-]/g, '_');
  
  // 사용자 이메일 가져오기
  const { data: userData } = await supabase.auth.getUser();
  const email = userData.user?.email || userId; // 이메일이 없으면 fallback to userId
  const emailLocal = email.split('@')[0].replace(/[^a-zA-Z0-9_-]/g, '_'); // @ 앞부분 추출 및 sanitize
  const path = `${emailLocal}/${timestamp}_${safeName}`;
  
  const { data, error } = await supabase.storage.from('problem-images').upload(path, file, {
    cacheControl: '3600',
    upsert: false,
  });
  if (error) throw error;
  const { data: urlData } = supabase.storage.from('problem-images').getPublicUrl(data.path);
  return urlData.publicUrl;
}

export async function createSession(imageUrl: string): Promise<string> {
  const userId = await getCurrentUserId();
  const { data, error } = await supabase.from('sessions').insert({ user_id: userId, image_url: imageUrl }).select('id').single();
  if (error) throw error;
  return data.id as string;
}


