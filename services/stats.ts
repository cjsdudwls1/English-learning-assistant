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

export interface StatsNode {
  depth1: string;
  depth2?: string;
  depth3?: string;
  depth4?: string;
  correct_count: number;
  incorrect_count: number;
  total_count: number;
  children?: StatsNode[];
  sessionIds?: string[]; // 해당 카테고리의 세션 ID들
}

export async function fetchStatsByType(startDate?: Date, endDate?: Date): Promise<TypeStatsRow[]> {
  const userId = await getCurrentUserId();
  
  let query = supabase
    .from('labels')
    .select(`
      classification,
      is_correct,
      problems!inner (
        session_id,
        sessions!inner (
          user_id,
          created_at
        )
      )
    `)
    .eq('problems.sessions.user_id', userId);

  // 기간 필터링
  if (startDate) {
    query = query.gte('problems.sessions.created_at', startDate.toISOString());
  }
  if (endDate) {
    const endDateTime = new Date(endDate);
    endDateTime.setHours(23, 59, 59, 999);
    query = query.lte('problems.sessions.created_at', endDateTime.toISOString());
  }

  const { data, error } = await query;

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

// 계층 구조 통계 집계 (모든 depth 레벨)
export async function fetchHierarchicalStats(startDate?: Date, endDate?: Date): Promise<StatsNode[]> {
  const userId = await getCurrentUserId();
  
  let query = supabase
    .from('labels')
    .select(`
      classification,
      is_correct,
      problems!inner (
        session_id,
        sessions!inner (
          user_id,
          created_at
        )
      )
    `)
    .eq('problems.sessions.user_id', userId);

  // 기간 필터링
  if (startDate) {
    query = query.gte('problems.sessions.created_at', startDate.toISOString());
  }
  if (endDate) {
    const endDateTime = new Date(endDate);
    endDateTime.setHours(23, 59, 59, 999);
    query = query.lte('problems.sessions.created_at', endDateTime.toISOString());
  }

  const { data, error } = await query;

  if (error) throw error;

  // 모든 depth 레벨별로 집계 (1-depth, 1-2-depth, 1-2-3-depth, 1-2-3-4-depth)
  const statsMap = new Map<string, StatsNode>();
  
  for (const row of data || []) {
    const classification = row.classification || {};
    const depth1 = classification['1Depth'] || '';
    const depth2 = classification['2Depth'] || '';
    const depth3 = classification['3Depth'] || '';
    const depth4 = classification['4Depth'] || '';
    
    // 1-depth 집계
    if (depth1) {
      const key1 = depth1;
      if (!statsMap.has(key1)) {
        statsMap.set(key1, {
          depth1,
          correct_count: 0,
          incorrect_count: 0,
          total_count: 0,
          children: [],
          sessionIds: []
        });
      }
      const stats1 = statsMap.get(key1)!;
      stats1.total_count++;
      if (row.is_correct) stats1.correct_count++; else stats1.incorrect_count++;
      if (row.problems?.session_id && !stats1.sessionIds?.includes(row.problems.session_id)) {
        stats1.sessionIds?.push(row.problems.session_id);
      }
    }
    
    // 1-2-depth 집계
    if (depth1 && depth2) {
      const key2 = `${depth1}_${depth2}`;
      if (!statsMap.has(key2)) {
        statsMap.set(key2, {
          depth1,
          depth2,
          correct_count: 0,
          incorrect_count: 0,
          total_count: 0,
          children: [],
          sessionIds: []
        });
      }
      const stats2 = statsMap.get(key2)!;
      stats2.total_count++;
      if (row.is_correct) stats2.correct_count++; else stats2.incorrect_count++;
      if (row.problems?.session_id && !stats2.sessionIds?.includes(row.problems.session_id)) {
        stats2.sessionIds?.push(row.problems.session_id);
      }
    }
    
    // 1-2-3-depth 집계
    if (depth1 && depth2 && depth3) {
      const key3 = `${depth1}_${depth2}_${depth3}`;
      if (!statsMap.has(key3)) {
        statsMap.set(key3, {
          depth1,
          depth2,
          depth3,
          correct_count: 0,
          incorrect_count: 0,
          total_count: 0,
          children: [],
          sessionIds: []
        });
      }
      const stats3 = statsMap.get(key3)!;
      stats3.total_count++;
      if (row.is_correct) stats3.correct_count++; else stats3.incorrect_count++;
      if (row.problems?.session_id && !stats3.sessionIds?.includes(row.problems.session_id)) {
        stats3.sessionIds?.push(row.problems.session_id);
      }
    }
    
    // 1-2-3-4-depth 집계
    if (depth1 && depth2 && depth3 && depth4) {
      const key4 = `${depth1}_${depth2}_${depth3}_${depth4}`;
      if (!statsMap.has(key4)) {
        statsMap.set(key4, {
          depth1,
          depth2,
          depth3,
          depth4,
          correct_count: 0,
          incorrect_count: 0,
          total_count: 0,
          children: [],
          sessionIds: []
        });
      }
      const stats4 = statsMap.get(key4)!;
      stats4.total_count++;
      if (row.is_correct) stats4.correct_count++; else stats4.incorrect_count++;
      if (row.problems?.session_id && !stats4.sessionIds?.includes(row.problems.session_id)) {
        stats4.sessionIds?.push(row.problems.session_id);
      }
    }
  }
  
  // 계층 구조로 변환
  const rootNodes: StatsNode[] = [];
  const nodeMap = new Map<string, StatsNode>();
  
  // 모든 노드를 맵에 저장
  for (const [key, node] of statsMap) {
    nodeMap.set(key, node);
  }
  
  // 계층 구조 구성
  for (const [key, node] of statsMap) {
    if (key.includes('_')) {
      // 하위 노드인 경우
      const parts = key.split('_');
      if (parts.length === 2) {
        // 1-2-depth -> 1-depth의 자식
        const parentKey = parts[0];
        const parent = nodeMap.get(parentKey);
        if (parent) {
          if (!parent.children) parent.children = [];
          parent.children.push(node);
        }
      } else if (parts.length === 3) {
        // 1-2-3-depth -> 1-2-depth의 자식
        const parentKey = parts.slice(0, 2).join('_');
        const parent = nodeMap.get(parentKey);
        if (parent) {
          if (!parent.children) parent.children = [];
          parent.children.push(node);
        }
      } else if (parts.length === 4) {
        // 1-2-3-4-depth -> 1-2-3-depth의 자식
        const parentKey = parts.slice(0, 3).join('_');
        const parent = nodeMap.get(parentKey);
        if (parent) {
          if (!parent.children) parent.children = [];
          parent.children.push(node);
        }
      }
    } else {
      // 1-depth 루트 노드
      rootNodes.push(node);
    }
  }
  
  return rootNodes;
}


