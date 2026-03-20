/**
 * 분류체계(Taxonomy) 모듈
 * - Supabase에서 taxonomy_nodes 로드
 * - 깊이/라벨 기반 빠른 검색 맵 생성
 */

export async function loadTaxonomyData(supabase) {
  const { data, error } = await supabase
    .from('taxonomy_nodes')
    .select('id, code, depth, label_ko, label_en, parent_id')
    .order('depth', { ascending: true })
    .order('code', { ascending: true });

  if (error || !data) {
    console.error('[taxonomy] taxonomy_nodes 로드 실패:', error);
    return [];
  }

  return data;
}

/**
 * taxonomy 데이터를 빠른 검색용 Map으로 변환
 * @returns {{ taxonomyByDepthKey: Map, taxonomyByCode: Map }}
 */
export function buildTaxonomyLookup(taxonomyData) {
  const taxonomyByDepthKey = new Map();
  const taxonomyByCode = new Map();

  for (const node of taxonomyData) {
    taxonomyByCode.set(node.code, node);
    const depthLabel = node.label_ko || node.label_en;
    const lookupKey = `${node.depth}:${depthLabel}`;
    taxonomyByDepthKey.set(lookupKey, node);
  }

  return { taxonomyByDepthKey, taxonomyByCode };
}
