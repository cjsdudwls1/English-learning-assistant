import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { requireEnv } from './env.ts';

export function createServiceSupabaseClient() {
  const supabaseUrl = requireEnv('SUPABASE_URL');
  const supabaseServiceKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
  return createClient(supabaseUrl, supabaseServiceKey);
}


