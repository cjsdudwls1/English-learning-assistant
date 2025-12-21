import { supabase } from '../services/supabaseClient';

export interface TaxonomyMaps {
  validDepth1: Set<string>;
  validDepth2: Set<string>;
  validDepth3: Set<string>;
  validDepth4: Set<string>;
  validDepth1En: Set<string>;
  validDepth2En: Set<string>;
  validDepth3En: Set<string>;
  validDepth4En: Set<string>;
  depth1Map: Map<string, string>;
  depth2Map: Map<string, string>;
  depth3Map: Map<string, string>;
  depth4Map: Map<string, string>;
  depth1EnToKoMap: Map<string, string>;
  depth2EnToKoMap: Map<string, string>;
  depth3EnToKoMap: Map<string, string>;
  depth4EnToKoMap: Map<string, string>;
  depth3ToDepth4Map: Map<string, string>;
}

export interface TranslatedDepths {
  koDepth1: string;
  koDepth2: string;
  koDepth3: string;
  koDepth4: string;
  depth1: string;
  depth2: string;
  depth3: string;
  depth4: string;
}

/**
 * taxonomy 데이터를 로드하고 매핑 맵을 생성
 */
export async function buildTaxonomyMaps(): Promise<TaxonomyMaps> {
  const { data: taxonomyData, error: taxonomyError } = await supabase
    .from('taxonomy')
    .select('depth1, depth2, depth3, depth4, depth1_en, depth2_en, depth3_en, depth4_en');
  
  if (taxonomyError) throw taxonomyError;
  
  // 유효한 값 Set 생성
  const validDepth1 = new Set<string>();
  const validDepth2 = new Set<string>();
  const validDepth3 = new Set<string>();
  const validDepth4 = new Set<string>();
  const validDepth1En = new Set<string>();
  const validDepth2En = new Set<string>();
  const validDepth3En = new Set<string>();
  const validDepth4En = new Set<string>();
  const depth1Map = new Map<string, string>();
  const depth2Map = new Map<string, string>();
  const depth3Map = new Map<string, string>();
  const depth4Map = new Map<string, string>();
  const depth1EnToKoMap = new Map<string, string>();
  const depth2EnToKoMap = new Map<string, string>();
  const depth3EnToKoMap = new Map<string, string>();
  const depth4EnToKoMap = new Map<string, string>();
  
  // depth3 -> depth4 매핑 생성 (depth4가 null인 경우 자동 보완용)
  const depth3ToDepth4Map = new Map<string, string>();
  
  for (const row of taxonomyData || []) {
    if (row.depth1) {
      validDepth1.add(row.depth1);
      if (row.depth1_en) {
        depth1Map.set(row.depth1, row.depth1_en);
        validDepth1En.add(row.depth1_en);
        depth1EnToKoMap.set(row.depth1_en, row.depth1);
      }
    }
    if (row.depth2) {
      validDepth2.add(row.depth2);
      if (row.depth2_en) {
        depth2Map.set(row.depth2, row.depth2_en);
        validDepth2En.add(row.depth2_en);
        depth2EnToKoMap.set(row.depth2_en, row.depth2);
      }
    }
    if (row.depth3) {
      validDepth3.add(row.depth3);
      if (row.depth3_en) {
        depth3Map.set(row.depth3, row.depth3_en);
        validDepth3En.add(row.depth3_en);
        depth3EnToKoMap.set(row.depth3_en, row.depth3);
      }
    }
    if (row.depth4) {
      validDepth4.add(row.depth4);
      if (row.depth4_en) {
        depth4Map.set(row.depth4, row.depth4_en);
        validDepth4En.add(row.depth4_en);
        depth4EnToKoMap.set(row.depth4_en, row.depth4);
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
  
  return {
    validDepth1,
    validDepth2,
    validDepth3,
    validDepth4,
    validDepth1En,
    validDepth2En,
    validDepth3En,
    validDepth4En,
    depth1Map,
    depth2Map,
    depth3Map,
    depth4Map,
    depth1EnToKoMap,
    depth2EnToKoMap,
    depth3EnToKoMap,
    depth4EnToKoMap,
    depth3ToDepth4Map,
  };
}

/**
 * 한국어 값을 언어에 맞게 변환
 */
export function translateDepth(koValue: string, map: Map<string, string>, language: 'ko' | 'en'): string {
  if (!koValue) return koValue;
  if (language === 'en') {
    return map.get(koValue) || koValue;
  }
  return koValue;
}

/**
 * 분류 데이터를 검증하고 언어에 맞게 변환 (depth4 자동 보완 포함)
 */
export function validateAndTranslateDepths(
  classification: Record<string, any>,
  maps: TaxonomyMaps,
  language: 'ko' | 'en'
): TranslatedDepths {
  const rawDepth1 = classification.depth1 || '';
  const rawDepth2 = classification.depth2 || '';
  const rawDepth3 = classification.depth3 || '';
  let rawDepth4 = classification.depth4 || '';

  // 입력이 ko인지 en인지 감지 (혼재 저장 방지/호환)
  const inputIsKo = !!rawDepth1 && maps.validDepth1.has(rawDepth1);
  const inputIsEn = !!rawDepth1 && maps.validDepth1En.has(rawDepth1);

  // ko 기준으로 정규화
  const toKo = (v: string, enToKo: Map<string, string>) => {
    if (!v) return '';
    if (inputIsEn && !inputIsKo) return enToKo.get(v) || '';
    return v;
  };

  const rawKoDepth1 = toKo(rawDepth1, maps.depth1EnToKoMap);
  const rawKoDepth2 = toKo(rawDepth2, maps.depth2EnToKoMap);
  const rawKoDepth3 = toKo(rawDepth3, maps.depth3EnToKoMap);
  let rawKoDepth4 = toKo(rawDepth4, maps.depth4EnToKoMap);
  
  // depth4가 없지만 depth3가 있고, 해당 depth3에 유일한 depth4가 있는 경우 자동 보완
  if (!rawKoDepth4 && rawKoDepth3) {
    const autoDepth4 = maps.depth3ToDepth4Map.get(rawKoDepth3);
    if (autoDepth4 && autoDepth4 !== '') {
      rawKoDepth4 = autoDepth4;
    }
  }
  
  const koDepth1 = maps.validDepth1.has(rawKoDepth1) ? rawKoDepth1 : '';
  const koDepth2 = maps.validDepth2.has(rawKoDepth2) ? rawKoDepth2 : '';
  const koDepth3 = maps.validDepth3.has(rawKoDepth3) ? rawKoDepth3 : '';
  const koDepth4 = maps.validDepth4.has(rawKoDepth4) ? rawKoDepth4 : '';
  
  const depth1 = koDepth1 ? translateDepth(koDepth1, maps.depth1Map, language) : '';
  const depth2 = koDepth2 ? translateDepth(koDepth2, maps.depth2Map, language) : '';
  const depth3 = koDepth3 ? translateDepth(koDepth3, maps.depth3Map, language) : '';
  const depth4 = koDepth4 ? translateDepth(koDepth4, maps.depth4Map, language) : '';
  
  return {
    koDepth1,
    koDepth2,
    koDepth3,
    koDepth4,
    depth1,
    depth2,
    depth3,
    depth4,
  };
}

