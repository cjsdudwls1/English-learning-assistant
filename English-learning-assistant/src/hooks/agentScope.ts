/**
 * 에이전트 입력용 범위·통계 — 컨설턴트와 플래너 공용
 *
 * **서버에서 다시 계산하지 않는 것이 핵심이다.** 화면에 보이는 숫자와 에이전트가 받는 숫자가
 * 갈라지는 순간 둘 다 못 믿게 된다. 그래서 프론트가 이미 그린 값을 그대로 실어 보낸다.
 *
 * 두 에이전트가 **같은 범위 라벨과 같은 집계**를 써야 하는 이유도 같다. 컨설턴트가
 * "독해 > 추론이 약하다"고 쓴 근거와 플래너가 그 노드로 문제를 모으는 근거가 다른 숫자면,
 * 사용자에게는 두 기능이 서로 다른 데이터를 보는 것으로 보인다.
 * (원래 useConsulting 안에 있던 코드다. 플래너가 생기면서 복사 대신 옮겼다.)
 */
import type { StatsNode } from '../services/stats';

export interface CategoryRow { label: string; total: number; correct: number; incorrect: number }
export interface Totals { total: number; correct: number; incorrect: number }

export interface AgentScope {
  scopeLabel: string;
  stats: Totals;
  byCategory: CategoryRow[];
  /** 폴백이 오답을 다시 긁어야 할 때 필요한 노드들(전체 범위면 빈 배열). */
  nodes: StatsNode[];
}

export interface BuildScopeParams {
  language: 'ko' | 'en';
  hierarchicalData: StatsNode[];
  selectedNodes: Set<string>;
  getLeafNodes: (nodes: StatsNode[]) => StatsNode[];
  getNodeKey: (node: StatsNode) => string;
  overallTotals: Totals;
}

/** 선택 노드 과다 시 fetch 호출 상한 */
const MAX_SELECTED_NODES = 12;

export function nodeLabel(node: StatsNode): string {
  return [node.depth1, node.depth2, node.depth3, node.depth4].filter(Boolean).join(' > ');
}

export function buildAgentScope({
  language,
  hierarchicalData,
  selectedNodes,
  getLeafNodes,
  getNodeKey,
  overallTotals,
}: BuildScopeParams): AgentScope {
  const allLeafNodes = getLeafNodes(hierarchicalData);
  const selectedLeafNodes = selectedNodes.size > 0
    ? allLeafNodes.filter((node) => selectedNodes.has(getNodeKey(node)))
    : [];

  if (selectedLeafNodes.length > 0) {
    const nodes = selectedLeafNodes.slice(0, MAX_SELECTED_NODES);
    const scopeLabel = nodes.map(nodeLabel).join(', ')
      + (selectedLeafNodes.length > MAX_SELECTED_NODES ? ' …' : '');
    const byCategory = nodes.map((n) => ({
      label: nodeLabel(n),
      total: n.total_count || 0,
      correct: n.correct_count || 0,
      incorrect: n.incorrect_count || 0,
    }));
    const stats = byCategory.reduce<Totals>(
      (acc, r) => ({ total: acc.total + r.total, correct: acc.correct + r.correct, incorrect: acc.incorrect + r.incorrect }),
      { total: 0, correct: 0, incorrect: 0 }
    );
    return { scopeLabel, stats, byCategory, nodes };
  }

  // 전체 범위: depth1 상위 카테고리 집계를 정답률 오름차순으로 — 에이전트가 팔 지점을 고르는 근거
  const byCategory = hierarchicalData
    .map((n) => ({
      label: n.depth1 || (language === 'ko' ? '미분류' : 'Unclassified'),
      total: n.total_count || 0,
      correct: n.correct_count || 0,
      incorrect: n.incorrect_count || 0,
    }))
    .filter((r) => r.total > 0)
    .sort((a, b) => (a.correct / (a.total || 1)) - (b.correct / (b.total || 1)));

  return {
    scopeLabel: language === 'ko' ? '전체 카테고리' : 'All categories',
    stats: { ...overallTotals },
    byCategory,
    nodes: [],
  };
}
