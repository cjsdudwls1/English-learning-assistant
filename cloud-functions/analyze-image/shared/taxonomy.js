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

// ─── 부분매칭 fallback (AI 분류 미세오차 구제) ───────────────
// AI가 taxonomy 경로를 미세하게 어긋나게 생성(백틱/공백 오타, depth 누락 축약 등)하면
// depth 완전일치·code 매핑이 모두 실패해 classification이 전부 null(미분류)이 되던 문제를 구제.
// 정확도 우선: "유일 수렴"할 때만 채택하고, 모호하면 기권(null)한다.

/**
 * depth 값 정규화: 백틱 제거 + 공백 축약 + trim + 소문자.
 * DB의 백틱 오타(`-ly 등)나 AI의 공백/대소문자 편차를 흡수한다.
 */
function normDepth(v) {
  return (v == null ? '' : String(v)).replace(/`/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * 완전일치·code 매핑 실패한 depth 배열을 taxonomy 전체 행에 부분매칭으로 구제한다.
 * - 제공된 non-null depth 값들(정규화, 중복제거)이 어떤 taxonomy 행의 depth 값 집합의
 *   부분집합(순서무관)이고, 그런 행이 "유일"할 때만 그 행을 반환.
 * - 복수 후보면 null(기권) → confident-wrong 회피.
 * - 최소 2개 이상의 depth 값이 있어야 시도(1개는 대분류 공유로 모호).
 *
 * 실측 구제 케이스:
 *  - 백틱 오타: depth4 "-ly 등" vs DB "`-ly 등" → 정규화로 일치 (WF.ADJADV)
 *  - depth 축약: [어휘·연결, 콜로케이션/숙어, 관용표현] (depth2 "어휘관습" 누락) → 유일 수렴 (COLL.IDM)
 *
 * @param {Array<string|null>} depths - [depth1, depth2, depth3, depth4]
 * @param {Map} taxonomyByCode - code → { depth1~4, code, cefr, difficulty }
 * @returns {object|null} 매칭 행 또는 null
 */
export function fuzzyMatchTaxonomy(depths, taxonomyByCode) {
  const provided = (depths || []).map(normDepth).filter(Boolean);
  const provSet = [...new Set(provided)];
  if (provSet.length < 2) return null;

  let match = null;
  for (const row of taxonomyByCode.values()) {
    const rowVals = [row.depth1, row.depth2, row.depth3, row.depth4].map(normDepth);
    const allIn = provSet.every(pv => rowVals.includes(pv));
    if (allIn) {
      if (match) return null; // 복수 후보 → 기권
      match = row;
    }
  }
  return match;
}

/**
 * depth1만이라도 정식 taxonomy 대분류로 확정한다(정규화 매칭).
 * fuzzy 유일매칭이 실패해도 최소 대분류 버킷은 부여해 미분류를 탈출시킨다.
 * code/cefr/난이도는 채우지 않으므로(대분류만) 세부 통계 오염이 없다.
 *
 * @returns {string|null} 정식 depth1 표기 또는 null
 */
export function canonicalDepth1(rawDepth1, taxonomyByCode) {
  const target = normDepth(rawDepth1);
  if (!target) return null;
  for (const row of taxonomyByCode.values()) {
    if (normDepth(row.depth1) === target) return row.depth1;
  }
  return null;
}
