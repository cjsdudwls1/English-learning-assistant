import { supabase } from './supabaseClient';

export interface TypeStatsRow {
  depth1: string | null;
  depth2: string | null;
  depth3: string | null;
  depth4: string | null;
  correct_count: number;
  incorrect_count: number;
  total_count: number;
}

export async function fetchStatsByType(): Promise<TypeStatsRow[]> {
  const { data, error } = await supabase.from('vw_stats_by_type').select('*');
  if (error) throw error;
  return (data ?? []) as unknown as TypeStatsRow[];
}


