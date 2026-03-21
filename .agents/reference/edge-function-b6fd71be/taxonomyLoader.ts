// taxonomyLoader.ts — Taxonomy Lookup Map 구성 모듈
// taxonomy DB에서 조회하여 depth key → code/cefr/difficulty 매핑 생성

import { cleanOrNull, makeDepthKey, type TaxonomyByDepthKey, type TaxonomyByCode } from './validation.ts';

// ─── 타입 정의 ─────────────────────────────────────────────

export interface TaxonomyLookupParams {
  supabase: any;
  userLanguage: 'ko' | 'en';
  sessionId: string;
}

export interface TaxonomyLookupResult {
  taxonomyByDepthKey: TaxonomyByDepthKey;
  taxonomyByCode: TaxonomyByCode;
}

// ─── 메인 함수: Taxonomy Lookup Map 구성 ───────────────────

/**
 * taxonomy 테이블에서 전체 행을 조회하여 두 가지 lookup Map을 구성한다.
 *
 * 1. taxonomyByDepthKey: depth1+depth2+depth3+depth4 → { code, cefr, difficulty }
 * 2. taxonomyByCode: code → { depth1, depth2, depth3, depth4, code, cefr, difficulty }
 *
 * 이 Map들은 AI 모델 응답의 classification을 서버 측에서 정규화/보강할 때 사용된다.
 * DB 쿼리를 1회만 수행하고 Map으로 재사용하여 성능을 최적화한다.
 */
export async function buildTaxonomyLookup(params: TaxonomyLookupParams): Promise<TaxonomyLookupResult> {
  const { supabase, userLanguage, sessionId } = params;

  const depth1Col = userLanguage === 'en' ? 'depth1_en' : 'depth1';
  const depth2Col = userLanguage === 'en' ? 'depth2_en' : 'depth2';
  const depth3Col = userLanguage === 'en' ? 'depth3_en' : 'depth3';
  const depth4Col = userLanguage === 'en' ? 'depth4_en' : 'depth4';

  const { data: taxonomyRows, error: taxonomyRowsError } = await supabase
    .from('taxonomy')
    .select(`code, cefr, difficulty, ${depth1Col}, ${depth2Col}, ${depth3Col}, ${depth4Col}`);

  if (taxonomyRowsError) {
    console.error(`[Background] Step 3a: Failed to load taxonomy lookup rows`, {
      sessionId,
      error: taxonomyRowsError,
    });
  }

  const taxonomyByDepthKey: TaxonomyByDepthKey = new Map();
  const taxonomyByCode: TaxonomyByCode = new Map();

  for (const row of taxonomyRows || []) {
    const code = cleanOrNull(row.code);
    const d1 = cleanOrNull(row[depth1Col]);
    const d2 = cleanOrNull(row[depth2Col]);
    const d3 = cleanOrNull(row[depth3Col]);
    const d4 = cleanOrNull(row[depth4Col]);
    const cefr = cleanOrNull(row.cefr);
    const difficulty = row.difficulty ?? null;

    if (d1 && d2 && d3 && d4) {
      taxonomyByDepthKey.set(makeDepthKey(d1, d2, d3, d4), { code, cefr, difficulty });
    }
    if (code) {
      taxonomyByCode.set(code, { depth1: d1, depth2: d2, depth3: d3, depth4: d4, code, cefr, difficulty });
    }
  }

  return { taxonomyByDepthKey, taxonomyByCode };
}
