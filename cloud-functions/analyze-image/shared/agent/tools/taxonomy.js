/**
 * 에이전트 도구 공용 — 분류 경로(nodePath) 규약
 *
 * 컨설턴트와 플래너는 **같은 노드를 같은 이름으로** 불러야 한다. 컨설턴트가 "문법 > 시제"를
 * 약점으로 지목했는데 플래너가 그 경로로 문제를 못 찾으면, 사용자에겐 두 기능이 서로 다른
 * 데이터를 보는 것으로 보인다. 그래서 경로 파싱·별칭 접기·매칭을 여기 한 곳에 둔다.
 *
 * 원래는 consultantTools.js 안에 있던 코드다. 플래너가 생기면서 복사 대신 옮겼다 —
 * 복사하면 한쪽만 고쳐지는 날이 반드시 온다.
 */

export const PATH_SEP = '>';
export const ID_CHUNK = 500;

export const norm = (v) => String(v ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

export function splitPath(nodePath) {
  return String(nodePath ?? '')
    .split(PATH_SEP)
    .map((s) => s.trim())
    .filter(Boolean);
}

export const pct = (correct, total) => (total > 0 ? Math.round((correct / total) * 100) : null);

/** 한 런 안에서 도구가 여러 번 불리므로 조회 결과를 ctx.cache에 메모이즈한다. */
export async function memo(ctx, key, factory) {
  if (!ctx.cache) return factory();
  if (!ctx.cache.has(key)) ctx.cache.set(key, factory());
  return ctx.cache.get(key);
}

/** 조회 결과를 배열로 펴되 에러는 반드시 던진다 — 빈 배열로 삼키면 "표본 없음"과 구분이 안 된다. */
export async function rows(query) {
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

const TAXONOMY_COLUMNS = 'depth1, depth2, depth3, depth4, depth1_en, depth2_en, depth3_en, depth4_en';

/** taxonomy 전량. 한 런에서 별칭표·경로검증·라벨변형이 모두 쓰므로 한 번만 읽는다. */
export async function taxonomyRows(ctx) {
  return memo(ctx, 'taxonomyRows', async () => {
    const { data, error } = await ctx.db.from('taxonomy').select(TAXONOMY_COLUMNS);
    if (error || !data) return [];
    return data;
  });
}

/**
 * taxonomy의 ko/en 라벨을 하나의 정규형(ko 소문자)으로 접는 별칭표.
 * labels.classification에는 ko 또는 en 라벨이 그대로 들어 있고(코드가 아님),
 * 프론트는 화면 언어에 맞춰 번역해 보여준다. 서버가 같은 접기를 하지 않으면
 * 영어 UI 사용자의 nodePath가 한국어 라벨과 매칭되지 않아 "0건"이 나온다.
 */
export async function aliasMap(ctx) {
  return memo(ctx, 'taxonomyAlias', async () => {
    const map = new Map();
    const data = await taxonomyRows(ctx);
    for (const row of data) {
      for (const level of [1, 2, 3, 4]) {
        const ko = row[`depth${level}`];
        const en = row[`depth${level}_en`];
        if (!ko) continue;
        const canonical = norm(ko);
        map.set(canonical, canonical);
        if (en) map.set(norm(en), canonical);
      }
    }
    return map;
  });
}

export const canon = (alias, value) => {
  const n = norm(value);
  return alias.get(n) ?? n;
};

export function depthsOf(classification) {
  const c = classification || {};
  return [c.depth1, c.depth2, c.depth3, c.depth4];
}

/**
 * 프론트(useConsulting.buildScope)는 depth1이 없는 행을 '미분류'/'Unclassified'라는
 * **가상 카테고리**로 묶어 input에 넣는다. 그 이름이 그대로 nodePath로 되돌아오는데
 * taxonomy에는 그런 노드가 없다 — 예전엔 전부 0건이었고, 모델은 근거 없이
 * "미분류에서 정답률 0%"를 보고서 첫 문단에 썼다(실측 런 d2951b3a).
 * 프론트의 판정(useConsulting.runFallback)과 같은 규약으로 여기서도 되돌려 준다.
 */
export const UNCLASSIFIED = new Set(['미분류', 'unclassified']);
export const isUnclassifiedPath = (segments) =>
  segments.length === 1 && UNCLASSIFIED.has(norm(segments[0]));

/** 라벨/생성문제 행이 nodePath 하위인가. 빈 경로는 전체 일치. */
export function matchesPath(alias, classification, segments) {
  if (segments.length === 0) return true;
  const depths = depthsOf(classification);
  // 별칭표를 태우기 전에 가른다 — 정규형이 아니라 "depth1이 없다"가 매칭 조건이다.
  if (isUnclassifiedPath(segments)) return !depths[0] || UNCLASSIFIED.has(norm(depths[0]));
  if (segments.length > depths.length) return false;
  for (let i = 0; i < segments.length; i += 1) {
    if (!depths[i]) return false;
    if (canon(alias, depths[i]) !== canon(alias, segments[i])) return false;
  }
  return true;
}

/** nodePath 문자열 → generated_problems/labels에 저장되는 classification 객체 */
export function pathToClassification(segments) {
  const [depth1, depth2, depth3, depth4] = segments;
  const out = {};
  if (depth1) out.depth1 = depth1;
  if (depth2) out.depth2 = depth2;
  if (depth3) out.depth3 = depth3;
  if (depth4) out.depth4 = depth4;
  return out;
}

/** taxonomy 한 행이 경로와 맞는가. ko/en 어느 쪽 라벨로 와도 같게 판정한다. */
function rowMatchesSegments(alias, row, segments) {
  for (let i = 0; i < segments.length; i += 1) {
    const ko = row[`depth${i + 1}`];
    const en = row[`depth${i + 1}_en`];
    if (!ko) return false;
    const target = canon(alias, segments[i]);
    if (canon(alias, ko) !== target && !(en && canon(alias, en) === target)) return false;
  }
  return true;
}

/**
 * taxonomy에 **실재하는** 경로인가.
 *
 * 왜 필요한가: 플래너의 생성 도구는 돈을 쓴다. 모델이 "문법 > 가정법 도치"처럼 그럴듯하지만
 * 없는 노드를 지어내면, 그 분류가 그대로 generated_problems에 박힌 문제 묶음이 만들어지고
 * 아무 화면에서도 다시 안 잡힌다. 조회 도구는 0건이면 그만이지만 생성 도구는 그렇지 않아서,
 * **생성 전에만** 이 검사를 강제한다.
 */
export async function isKnownNode(ctx, segments) {
  if (segments.length === 0) return false;
  const [alias, data] = await Promise.all([aliasMap(ctx), taxonomyRows(ctx)]);
  return data.some((row) => rowMatchesSegments(alias, row, segments));
}

/**
 * 경로 각 단계의 **원문 라벨 변형**(ko/en)을 모은다.
 * PostgREST 필터(`classification->>depth1.eq.X`)는 정규화를 못 하므로, 별칭 접기를 SQL로
 * 넘길 수 없다. 그래서 후보를 원문으로 나열해 or 필터에 넣고, 깊은 단계는 JS에서 접어 맞춘다.
 */
export async function labelVariants(ctx, segments) {
  const [alias, data] = await Promise.all([aliasMap(ctx), taxonomyRows(ctx)]);
  return segments.map((segment, i) => {
    const target = canon(alias, segment);
    const out = new Set([segment]);
    for (const row of data) {
      const ko = row[`depth${i + 1}`];
      const en = row[`depth${i + 1}_en`];
      if (ko && canon(alias, ko) === target) {
        out.add(ko);
        if (en) out.add(en);
      }
    }
    return [...out];
  });
}
