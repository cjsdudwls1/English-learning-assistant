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

  const formatStructure = (obj: any, indent = 0): string => {
    let result = '';
    const spaces = '  '.repeat(indent);
    for (const [key, value] of Object.entries(obj)) {
      result += spaces + key + '\n';
      if (typeof value === 'object' && !Array.isArray(value)) {
        result += formatStructure(value, indent + 1);
      } else if (Array.isArray(value)) {
        value.forEach((item: string) => {
          result += spaces + '  ' + item + '\n';
        });
      }
    }
    return result;
  };

  return {
    structure: formatStructure(structure),
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



