import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

interface TaxonomyStructure {
  structure: string;
  allValues: {
    depth1: string[];
    depth2: string[];
    depth3: string[];
    depth4: string[];
  };
}

export async function loadTaxonomyData(
  supabase: SupabaseClient,
  language: 'ko' | 'en' = 'ko'
): Promise<TaxonomyStructure> {
  const depth1Col = language === 'en' ? 'depth1_en' : 'depth1';
  const depth2Col = language === 'en' ? 'depth2_en' : 'depth2';
  const depth3Col = language === 'en' ? 'depth3_en' : 'depth3';
  const depth4Col = language === 'en' ? 'depth4_en' : 'depth4';

  const { data, error } = await supabase
    .from('taxonomy')
    // 프롬프트 기준표 생성 목적: depth1~4만 로딩
    .select(`${depth1Col}, ${depth2Col}, ${depth3Col}, ${depth4Col}`)
    .order(`${depth1Col}, ${depth2Col}, ${depth3Col}, ${depth4Col}`);

  if (error) {
    throw error;
  }

  const structure: Record<string, any> = {};
  const allValues = {
    depth1: new Set<string>(),
    depth2: new Set<string>(),
    depth3: new Set<string>(),
    depth4: new Set<string>(),
  };

  for (const row of data || []) {
    const d1 = row[depth1Col] || '';
    const d2 = row[depth2Col] || '';
    const d3 = row[depth3Col] || '';
    const d4 = row[depth4Col] || '';

    if (d1) allValues.depth1.add(d1);
    if (d2) allValues.depth2.add(d2);
    if (d3) allValues.depth3.add(d3);
    if (d4) allValues.depth4.add(d4);

    if (!structure[d1]) structure[d1] = {};
    if (!structure[d1][d2]) structure[d1][d2] = {};
    if (!structure[d1][d2][d3]) structure[d1][d2][d3] = [];
    if (d4 && !structure[d1][d2][d3].includes(d4)) {
      structure[d1][d2][d3].push(d4);
    }
  }

  // 플랫 목록 형태로 변경 (들여쓰기 트리 대신, ~3,600자로 축소)
  const lines: string[] = [];
  for (const [d1, d2Map] of Object.entries(structure)) {
    for (const [d2, d3Map] of Object.entries(d2Map as any)) {
      for (const [d3, d4Arr] of Object.entries(d3Map as any)) {
        for (const d4 of (d4Arr as string[])) {
          lines.push(`${d1} > ${d2} > ${d3} > ${d4}`);
        }
      }
    }
  }

  return {
    structure: lines.join('\n'),
    allValues: {
      depth1: Array.from(allValues.depth1).sort(),
      depth2: Array.from(allValues.depth2).sort(),
      depth3: Array.from(allValues.depth3).sort(),
      depth4: Array.from(allValues.depth4).sort(),
    },
  };
}

export async function findTaxonomyByDepth(
  supabase: SupabaseClient,
  depth1: string,
  depth2: string,
  depth3: string,
  depth4: string,
  language: 'ko' | 'en' = 'ko'
) {
  const depth1Col = language === 'en' ? 'depth1_en' : 'depth1';
  const depth2Col = language === 'en' ? 'depth2_en' : 'depth2';
  const depth3Col = language === 'en' ? 'depth3_en' : 'depth3';
  const depth4Col = language === 'en' ? 'depth4_en' : 'depth4';

  let query = supabase
    .from('taxonomy')
    .select('code, cefr, difficulty')
    .eq(depth1Col, depth1)
    .eq(depth2Col, depth2)
    .eq(depth3Col, depth3)
    .eq(depth4Col, depth4)
    .single();

  const { data, error } = await query;

  if (error || !data) {
    return { code: null, cefr: null, difficulty: null };
  }

  return {
    code: data.code || null,
    cefr: data.cefr || null,
    difficulty: data.difficulty || null,
  };
}

export async function fetchTaxonomyByCode(supabase: SupabaseClient, code: string) {
  const { data, error } = await supabase
    .from('taxonomy')
    .select('*')
    .eq('code', code)
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      return null;
    }
    throw error;
  }

  return data;
}



