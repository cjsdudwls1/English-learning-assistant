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

export async function fetchStatsByType(startDate?: Date, endDate?: Date, language: 'ko' | 'en' = 'ko'): Promise<TypeStatsRow[]> {
  const userId = await getCurrentUserId();
  
  let query = supabase
    .from('labels')
    .select(`
      classification,
      is_correct,
      user_mark,
      problems!inner (
        session_id,
        sessions!inner (
          user_id,
          created_at
        )
      )
    `)
    .eq('problems.sessions.user_id', userId)
    .not('user_mark', 'is', null); // user_mark가 null이 아닌 경우만 통계에 포함

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
  
  // taxonomy에서 유효한 값 목록 로드
  const { data: taxonomyData, error: taxonomyError } = await supabase
    .from('taxonomy')
    .select('depth1, depth2, depth3, depth4, depth1_en, depth2_en, depth3_en, depth4_en');
  
  if (taxonomyError) throw taxonomyError;
  
  // 유효한 값 Set 생성
  const validDepth1 = new Set<string>();
  const validDepth2 = new Set<string>();
  const validDepth3 = new Set<string>();
  const validDepth4 = new Set<string>();
  const depth1Map = new Map<string, string>();
  const depth2Map = new Map<string, string>();
  const depth3Map = new Map<string, string>();
  const depth4Map = new Map<string, string>();
  
  // depth3 -> depth4 매핑 생성 (depth4가 null인 경우 자동 보완용)
  const depth3ToDepth4Map = new Map<string, string>();
  for (const row of taxonomyData || []) {
    if (row.depth1) validDepth1.add(row.depth1);
    if (row.depth2) validDepth2.add(row.depth2);
    if (row.depth3) validDepth3.add(row.depth3);
    if (row.depth4) validDepth4.add(row.depth4);
    if (row.depth1 && row.depth1_en) depth1Map.set(row.depth1, row.depth1_en);
    if (row.depth2 && row.depth2_en) depth2Map.set(row.depth2, row.depth2_en);
    if (row.depth3 && row.depth3_en) depth3Map.set(row.depth3, row.depth3_en);
    if (row.depth4 && row.depth4_en) depth4Map.set(row.depth4, row.depth4_en);
    
    // depth3에 대응하는 depth4가 하나만 있는 경우 매핑 저장
    if (row.depth3 && row.depth4) {
      // 이미 매핑이 있고 다른 값이면 null로 설정 (여러 개면 사용 불가)
      if (depth3ToDepth4Map.has(row.depth3)) {
        const existing = depth3ToDepth4Map.get(row.depth3);
        if (existing !== row.depth4) {
          depth3ToDepth4Map.set(row.depth3, ''); // 여러 개면 빈 문자열로 표시
        }
      } else {
        depth3ToDepth4Map.set(row.depth3, row.depth4);
      }
    }
  }
  
  const translateDepth = (koValue: string, map: Map<string, string>): string => {
    if (!koValue) return koValue;
    if (language === 'en') {
      return map.get(koValue) || koValue;
    }
    return koValue;
  };
  
  for (const row of data || []) {
    const classification = row.classification || {};
    // 유효성 검증: taxonomy에 있는 값만 사용
    const rawDepth1 = classification['1Depth'] || '';
    const rawDepth2 = classification['2Depth'] || '';
    const rawDepth3 = classification['3Depth'] || '';
    let rawDepth4 = classification['4Depth'] || '';
    
    // depth4가 없지만 depth3가 있고, 해당 depth3에 유일한 depth4가 있는 경우 자동 보완
    if (!rawDepth4 && rawDepth3) {
      const autoDepth4 = depth3ToDepth4Map.get(rawDepth3);
      if (autoDepth4 && autoDepth4 !== '') {
        rawDepth4 = autoDepth4;
      }
    }
    
    const koDepth1 = validDepth1.has(rawDepth1) ? rawDepth1 : '';
    const koDepth2 = validDepth2.has(rawDepth2) ? rawDepth2 : '';
    const koDepth3 = validDepth3.has(rawDepth3) ? rawDepth3 : '';
    const koDepth4 = validDepth4.has(rawDepth4) ? rawDepth4 : '';
    
    const depth1 = koDepth1 ? translateDepth(koDepth1, depth1Map) : null;
    const depth2 = koDepth2 ? translateDepth(koDepth2, depth2Map) : null;
    const depth3 = koDepth3 ? translateDepth(koDepth3, depth3Map) : null;
    const depth4 = koDepth4 ? translateDepth(koDepth4, depth4Map) : null;
    
    const key = `${(depth1 || '')}_${(depth2 || '')}_${(depth3 || '')}_${(depth4 || '')}`;
    
    if (!statsMap.has(key)) {
      statsMap.set(key, {
        depth1,
        depth2,
        depth3,
        depth4,
        correct_count: 0,
        incorrect_count: 0,
        total_count: 0,
      });
    }
    
    const stats = statsMap.get(key)!;
    // user_mark가 null이 아닌 경우만 통계에 포함 (이미 쿼리에서 필터링했지만 이중 검증)
    if (row.user_mark !== null && row.user_mark !== undefined) {
      stats.total_count++;
      if (row.is_correct) {
        stats.correct_count++;
      } else {
        stats.incorrect_count++;
      }
    }
  }
  
  return Array.from(statsMap.values());
}

// 계층 구조 통계 집계 (모든 depth 레벨)
export async function fetchHierarchicalStats(startDate?: Date, endDate?: Date, language: 'ko' | 'en' = 'ko'): Promise<StatsNode[]> {
  const userId = await getCurrentUserId();
  
  // taxonomy에서 유효한 값 목록 및 언어별 매핑 로드
  const { data: taxonomyData, error: taxonomyError } = await supabase
    .from('taxonomy')
    .select('depth1, depth2, depth3, depth4, depth1_en, depth2_en, depth3_en, depth4_en');
  
  if (taxonomyError) throw taxonomyError;
  
  // 유효한 값 Set 생성 (한국어 값으로 검증)
  const validDepth1 = new Set<string>();
  const validDepth2 = new Set<string>();
  const validDepth3 = new Set<string>();
  const validDepth4 = new Set<string>();
  
  // 한국어 -> 영어 매핑 맵 생성
  const depth1Map = new Map<string, string>();
  const depth2Map = new Map<string, string>();
  const depth3Map = new Map<string, string>();
  const depth4Map = new Map<string, string>();
  
  // depth3 -> depth4 매핑 생성 (depth4가 null인 경우 자동 보완용)
  const depth3ToDepth4Map = new Map<string, string>();
  for (const row of taxonomyData || []) {
    if (row.depth1) {
      validDepth1.add(row.depth1);
      if (row.depth1_en) {
        depth1Map.set(row.depth1, row.depth1_en);
      }
    }
    if (row.depth2) {
      validDepth2.add(row.depth2);
      if (row.depth2_en) {
        depth2Map.set(row.depth2, row.depth2_en);
      }
    }
    if (row.depth3) {
      validDepth3.add(row.depth3);
      if (row.depth3_en) {
        depth3Map.set(row.depth3, row.depth3_en);
      }
    }
    if (row.depth4) {
      validDepth4.add(row.depth4);
      if (row.depth4_en) {
        depth4Map.set(row.depth4, row.depth4_en);
      }
    }
    
    // depth3에 대응하는 depth4가 하나만 있는 경우 매핑 저장
    if (row.depth3 && row.depth4) {
      // 이미 매핑이 있고 다른 값이면 null로 설정 (여러 개면 사용 불가)
      if (depth3ToDepth4Map.has(row.depth3)) {
        const existing = depth3ToDepth4Map.get(row.depth3);
        if (existing !== row.depth4) {
          depth3ToDepth4Map.set(row.depth3, ''); // 여러 개면 빈 문자열로 표시
        }
      } else {
        depth3ToDepth4Map.set(row.depth3, row.depth4);
      }
    }
  }
  
  // 한국어 값을 언어에 맞게 변환하는 함수
  const translateDepth = (koValue: string, map: Map<string, string>): string => {
    if (language === 'en' && koValue && map.has(koValue)) {
      return map.get(koValue) || koValue;
    }
    return koValue;
  };
  
  let query = supabase
    .from('labels')
    .select(`
      classification,
      is_correct,
      user_mark,
      problems!inner (
        session_id,
        sessions!inner (
          user_id,
          created_at
        )
      )
    `)
    .eq('problems.sessions.user_id', userId)
    .not('user_mark', 'is', null); // user_mark가 null이 아닌 경우만 통계에 포함

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
    // 유효성 검증: taxonomy에 있는 값만 사용
    const rawDepth1 = classification['1Depth'] || '';
    const rawDepth2 = classification['2Depth'] || '';
    const rawDepth3 = classification['3Depth'] || '';
    let rawDepth4 = classification['4Depth'] || '';
    
    // depth4가 없지만 depth3가 있고, 해당 depth3에 유일한 depth4가 있는 경우 자동 보완
    if (!rawDepth4 && rawDepth3) {
      const autoDepth4 = depth3ToDepth4Map.get(rawDepth3);
      if (autoDepth4 && autoDepth4 !== '') {
        rawDepth4 = autoDepth4;
      }
    }
    
    const koDepth1 = validDepth1.has(rawDepth1) ? rawDepth1 : '';
    const koDepth2 = validDepth2.has(rawDepth2) ? rawDepth2 : '';
    const koDepth3 = validDepth3.has(rawDepth3) ? rawDepth3 : '';
    const koDepth4 = validDepth4.has(rawDepth4) ? rawDepth4 : '';
    
    // 언어에 맞게 변환
    const depth1 = translateDepth(koDepth1, depth1Map);
    const depth2 = translateDepth(koDepth2, depth2Map);
    const depth3 = translateDepth(koDepth3, depth3Map);
    const depth4 = translateDepth(koDepth4, depth4Map);
    
    // 키는 한국어 값으로 사용 (중복 방지)
    const key1 = koDepth1;
    const key2 = koDepth1 && koDepth2 ? `${koDepth1}_${koDepth2}` : '';
    const key3 = koDepth1 && koDepth2 && koDepth3 ? `${koDepth1}_${koDepth2}_${koDepth3}` : '';
    const key4 = koDepth1 && koDepth2 && koDepth3 && koDepth4 ? `${koDepth1}_${koDepth2}_${koDepth3}_${koDepth4}` : '';
    
    // 1-depth 집계
    if (depth1) {
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
      // user_mark가 null이 아닌 경우만 통계에 포함
      if (row.user_mark !== null && row.user_mark !== undefined) {
        stats1.total_count++;
        if (row.is_correct) stats1.correct_count++; else stats1.incorrect_count++;
        if (row.problems?.session_id && !stats1.sessionIds?.includes(row.problems.session_id)) {
          stats1.sessionIds?.push(row.problems.session_id);
        }
      }
    }
    
    // 1-2-depth 집계
    if (depth1 && depth2 && key2) {
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
      // user_mark가 null이 아닌 경우만 통계에 포함
      if (row.user_mark !== null && row.user_mark !== undefined) {
        stats2.total_count++;
        if (row.is_correct) stats2.correct_count++; else stats2.incorrect_count++;
        if (row.problems?.session_id && !stats2.sessionIds?.includes(row.problems.session_id)) {
          stats2.sessionIds?.push(row.problems.session_id);
        }
      }
    }
    
    // 1-2-3-depth 집계
    if (depth1 && depth2 && depth3 && key3) {
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
      // user_mark가 null이 아닌 경우만 통계에 포함
      if (row.user_mark !== null && row.user_mark !== undefined) {
        stats3.total_count++;
        if (row.is_correct) stats3.correct_count++; else stats3.incorrect_count++;
        if (row.problems?.session_id && !stats3.sessionIds?.includes(row.problems.session_id)) {
          stats3.sessionIds?.push(row.problems.session_id);
        }
      }
    }
    
    // 1-2-3-4-depth 집계
    if (depth1 && depth2 && depth3 && depth4 && key4) {
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
      // user_mark가 null이 아닌 경우만 통계에 포함
      if (row.user_mark !== null && row.user_mark !== undefined) {
        stats4.total_count++;
        if (row.is_correct) stats4.correct_count++; else stats4.incorrect_count++;
        if (row.problems?.session_id && !stats4.sessionIds?.includes(row.problems.session_id)) {
          stats4.sessionIds?.push(row.problems.session_id);
        }
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


