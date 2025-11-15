import { supabase } from '../supabaseClient';
import type { Taxonomy } from '../../types';

export async function fetchTaxonomyByCode(code: string): Promise<Taxonomy | null> {
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

  return data as Taxonomy;
}

async function convertEnglishToKorean(
  enDepth1: string,
  enDepth2: string,
  enDepth3: string,
  enDepth4: string
): Promise<{ depth1: string; depth2: string; depth3: string; depth4: string }> {
  const { data: taxonomyData } = await supabase
    .from('taxonomy')
    .select('depth1, depth2, depth3, depth4, depth1_en, depth2_en, depth3_en, depth4_en');

  const enToKo1 = new Map<string, string>();
  const enToKo2 = new Map<string, string>();
  const enToKo3 = new Map<string, string>();
  const enToKo4 = new Map<string, string>();

  for (const row of taxonomyData || []) {
    if (row.depth1 && row.depth1_en) {
      enToKo1.set(row.depth1_en, row.depth1);
    }
    if (row.depth2 && row.depth2_en) {
      enToKo2.set(row.depth2_en, row.depth2);
    }
    if (row.depth3 && row.depth3_en) {
      enToKo3.set(row.depth3_en, row.depth3);
    }
    if (row.depth4 && row.depth4_en) {
      enToKo4.set(row.depth4_en, row.depth4);
    }
  }

  return {
    depth1: enToKo1.get(enDepth1) || enDepth1,
    depth2: enToKo2.get(enDepth2) || enDepth2,
    depth3: enToKo3.get(enDepth3) || enDepth3,
    depth4: enToKo4.get(enDepth4) || enDepth4,
  };
}

export async function findTaxonomyByDepth(
  depth1: string,
  depth2: string,
  depth3: string,
  depth4: string,
  language: 'ko' | 'en' = 'ko'
): Promise<Taxonomy | null> {
  let koDepth1 = depth1;
  let koDepth2 = depth2;
  let koDepth3 = depth3;
  let koDepth4 = depth4;

  if (language === 'en') {
    const converted = await convertEnglishToKorean(depth1, depth2, depth3, depth4);
    koDepth1 = converted.depth1;
    koDepth2 = converted.depth2;
    koDepth3 = converted.depth3;
    koDepth4 = converted.depth4;
  }

  let query = supabase
    .from('taxonomy')
    .select('*');

  if (koDepth1) query = query.eq('depth1', koDepth1);
  if (koDepth2) query = query.eq('depth2', koDepth2);
  if (koDepth3) query = query.eq('depth3', koDepth3);
  if (koDepth4) query = query.eq('depth4', koDepth4);

  const { data, error } = await query.single();

  if (error) {
    if (error.code === 'PGRST116') {
      if (language === 'en') {
        let queryEn = supabase.from('taxonomy').select('*');
        if (depth1) queryEn = queryEn.eq('depth1_en', depth1);
        if (depth2) queryEn = queryEn.eq('depth2_en', depth2);
        if (depth3) queryEn = queryEn.eq('depth3_en', depth3);
        if (depth4) queryEn = queryEn.eq('depth4_en', depth4);
        const { data: dataEn, error: errorEn } = await queryEn.single();
        if (errorEn) {
          if (errorEn.code === 'PGRST116') {
            return null;
          }
          throw errorEn;
        }
        return dataEn as Taxonomy;
      }
      return null;
    }
    throw error;
  }

  return data as Taxonomy;
}

export async function fetchAllTaxonomy(): Promise<Taxonomy[]> {
  const { data, error } = await supabase
    .from('taxonomy')
    .select('*')
    .order('code');

  if (error) throw error;

  return (data || []) as Taxonomy[];
}


