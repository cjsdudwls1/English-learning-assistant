import { supabase } from '../supabaseClient';
import { getCurrentUserId } from './auth';

export async function uploadProblemImage(file: File): Promise<string> {
  const userId = await getCurrentUserId();
  const timestamp = Date.now();
  const safeName = file.name.replace(/[^a-zA-Z0-9_.-]/g, '_');

  const { data: userData } = await supabase.auth.getUser();
  const email = userData.user?.email || userId;
  const emailLocal = email.split('@')[0].replace(/[^a-zA-Z0-9_-]/g, '_');
  const path = `${emailLocal}/${timestamp}_${safeName}`;

  const { data, error } = await supabase.storage.from('problem-images').upload(path, file, {
    cacheControl: '3600',
    upsert: false,
  });

  if (error) throw error;

  const { data: urlData } = supabase.storage.from('problem-images').getPublicUrl(data.path);
  return urlData.publicUrl;
}


