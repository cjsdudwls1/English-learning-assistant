import { supabase } from './supabaseClient';
import { getCurrentUserId } from './db';

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
  const userId = await getCurrentUserId();
  
  // labels -> problems -> sessions를 조인하여 현재 사용자의 데이터만 조회
  const { data, error } = await supabase
    .from('labels')
    .select(`
      classification,
      is_correct,
      problems!inner (
        session_id,
        sessions!inner (
          user_id
        )
      )
    `)
    .eq('problems.sessions.user_id', userId);

  if (error) throw error;

  // 클라이언트에서 집계
  const statsMap = new Map<string, TypeStatsRow>();
  
  for (const row of data || []) {
    const classification = row.classification || {};
    const key = `${classification['1Depth']||''}_${classification['2Depth']||''}_${classification['3Depth']||''}_${classification['4Depth']||''}`;
    
    if (!statsMap.has(key)) {
      statsMap.set(key, {
        depth1: classification['1Depth'] || null,
        depth2: classification['2Depth'] || null,
        depth3: classification['3Depth'] || null,
        depth4: classification['4Depth'] || null,
        correct_count: 0,
        incorrect_count: 0,
        total_count: 0,
      });
    }
    
    const stats = statsMap.get(key)!;
    stats.total_count++;
    if (row.is_correct) {
      stats.correct_count++;
    } else {
      stats.incorrect_count++;
    }
  }
  
  return Array.from(statsMap.values());
}


