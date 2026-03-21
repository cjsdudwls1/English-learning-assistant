/**
 * 분류체계(Taxonomy) 모듈
 * - Supabase에서 taxonomy 로드 (Pass C 프롬프트용)
 * - taxonomy 테이블에서 depth1~4 양방향 Lookup Map 구성 (Labels 보강용)
 *
 * 원본: taxonomyLoader.ts (Edge Function b6fd71be)
 */

// ─── 유틸리티 함수 ──────────────────────────────────────────

/**
 * null 또는 빈 문자열을 null로 정규화
 * 원본: validation.ts#cleanOrNull
 */
export function cleanOrNull(v) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s ? s : null;
}

/**
 * depth1~4를 키로 변환 (구분자: ␟, Unit Separator)
 * 원본: validation.ts#makeDepthKey
 */
export function makeDepthKey(d1, d2, d3, d4) {
  return `${d1}␟${d2}␟${d3}␟${d4}`;
}

// ─── taxonomy 로드 (Pass C 프롬프트용) ──────────────────────

/**
 * taxonomy 테이블에서 프롬프트용 분류 구조를 로드한다.
 * Pass C 분류 프롬프트에 taxonomy 구조를 전달하는 용도로 사용된다.
 *
 * 반환 형식: [{ label_ko: "depth1 > depth2 > depth3 > depth4", label_en: "..." }, ...]
 * 프롬프트에서 classificationData.map(n => n.label_ko || n.label_en) 형태로 사용됨.
 */
export async function loadTaxonomyData(supabase) {
  const { data, error } = await supabase
    .from('taxonomy')
    .select('code, depth1, depth2, depth3, depth4, depth1_en, depth2_en, depth3_en, depth4_en')
    .order('code', { ascending: true });

  if (error || !data) {
    console.error('[taxonomy] taxonomy 로드 실패:', error);
    return [];
  }

  // 프롬프트 호환 형식으로 변환: "depth1 > depth2 > depth3 > depth4"
  return data.map(row => ({
    code: row.code,
    label_ko: [row.depth1, row.depth2, row.depth3, row.depth4].filter(Boolean).join(' > '),
    label_en: [row.depth1_en, row.depth2_en, row.depth3_en, row.depth4_en].filter(Boolean).join(' > '),
  }));
}

// ─── taxonomy Lookup Map 구성 (Labels 보강용) ───────────────

/**
 * taxonomy 테이블에서 전체 행을 조회하여 두 가지 lookup Map을 구성한다.
 *
 * 1. taxonomyByDepthKey: depth1+depth2+depth3+depth4 → { code, cefr, difficulty }
 * 2. taxonomyByCode: code → { depth1~4, code, cefr, difficulty }
 *
 * 이 Map들은 AI 모델 응답의 classification을 서버 측에서 정규화/보강할 때 사용된다.
 * DB 쿼리를 1회만 수행하고 Map으로 재사용하여 성능을 최적화한다.
 *
 * 원본: taxonomyLoader.ts#buildTaxonomyLookup
 *
 * @param {object} supabase - Supabase 클라이언트
 * @param {'ko'|'en'} userLanguage - 사용자 언어
 * @param {string} sessionId - 세션 ID (로그용)
 * @returns {{ taxonomyByDepthKey: Map, taxonomyByCode: Map }}
 */
export async function buildTaxonomyLookupMaps(supabase, userLanguage, sessionId) {
  const depth1Col = userLanguage === 'en' ? 'depth1_en' : 'depth1';
  const depth2Col = userLanguage === 'en' ? 'depth2_en' : 'depth2';
  const depth3Col = userLanguage === 'en' ? 'depth3_en' : 'depth3';
  const depth4Col = userLanguage === 'en' ? 'depth4_en' : 'depth4';

  const { data: taxonomyRows, error: taxonomyRowsError } = await supabase
    .from('taxonomy')
    .select(`code, cefr, difficulty, ${depth1Col}, ${depth2Col}, ${depth3Col}, ${depth4Col}`);

  if (taxonomyRowsError) {
    console.error(`[taxonomy] taxonomy lookup rows 로드 실패`, {
      sessionId,
      error: taxonomyRowsError,
    });
  }

  const taxonomyByDepthKey = new Map();
  const taxonomyByCode = new Map();

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

  console.log(`[taxonomy] Lookup Map 구성 완료: depthKey=${taxonomyByDepthKey.size}, code=${taxonomyByCode.size}`, { sessionId });

  return { taxonomyByDepthKey, taxonomyByCode };
}
