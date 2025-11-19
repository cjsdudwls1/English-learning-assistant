import { useState, useCallback, useMemo } from 'react';
import type { StatsNode } from '../services/stats';

interface UseStatsNodesReturn {
  selectedNodes: Set<string>;
  handleNodeSelect: (node: StatsNode, selected: boolean) => void;
  getNodeKey: (node: StatsNode) => string;
  getLeafNodes: (nodes: StatsNode[]) => StatsNode[];
  getLowAccuracyCategories: StatsNode[];
  classifications: Array<{ depth1: string; depth2: string; depth3: string; depth4: string }>;
}

export function useStatsNodes(hierarchicalData: StatsNode[]): UseStatsNodesReturn {
  const [selectedNodes, setSelectedNodes] = useState<Set<string>>(new Set());

  // 노드 키 생성 함수
  const getNodeKey = useCallback((node: StatsNode): string => {
    return `${node.depth1 || ''}_${node.depth2 || ''}_${node.depth3 || ''}_${node.depth4 || ''}`;
  }, []);

  // 최하위 depth 노드만 필터링하는 함수
  const getLeafNodes = useCallback((nodes: StatsNode[]): StatsNode[] => {
    const leafNodes: StatsNode[] = [];
    const traverse = (ns: StatsNode[]) => {
      for (const node of ns) {
        if (!node.children || node.children.length === 0) {
          leafNodes.push(node);
        } else {
          traverse(node.children);
        }
      }
    };
    traverse(nodes);
    return leafNodes;
  }, []);

  // 정답률 낮은 유형 찾기 (카테고리 선택 없을 때 사용)
  const getLowAccuracyCategories = useMemo(() => {
    const allLeafNodes = getLeafNodes(hierarchicalData);
    const nodesWithAccuracy = allLeafNodes
      .map(node => {
        const total = node.total_count || 0;
        const correct = node.correct_count || 0;
        const accuracy = total > 0 ? correct / total : 0;
        return { ...node, accuracy };
      })
      .filter(node => node.total_count > 0)
      .sort((a, b) => a.accuracy - b.accuracy);
    
    return nodesWithAccuracy.slice(0, 5);
  }, [hierarchicalData, getLeafNodes]);

  // 분류 계산 (선택된 노드 또는 정답률 낮은 카테고리)
  const classifications = useMemo(() => {
    if (selectedNodes.size > 0) {
      const allLeafNodes = getLeafNodes(hierarchicalData);
      const selectedLeafNodes = allLeafNodes.filter(node => {
        const key = getNodeKey(node);
        return selectedNodes.has(key);
      });
      return selectedLeafNodes.map(node => ({
        depth1: node.depth1 || '',
        depth2: node.depth2 || '',
        depth3: node.depth3 || '',
        depth4: node.depth4 || '',
      }));
    } else {
      return getLowAccuracyCategories.map(node => ({
        depth1: node.depth1 || '',
        depth2: node.depth2 || '',
        depth3: node.depth3 || '',
        depth4: node.depth4 || '',
      }));
    }
  }, [selectedNodes, hierarchicalData, getLowAccuracyCategories, getLeafNodes, getNodeKey]);

  // 노드 선택 핸들러
  const handleNodeSelect = useCallback((node: StatsNode, selected: boolean) => {
    setSelectedNodes(prev => {
      const next = new Set(prev);
      const key = getNodeKey(node);
      if (selected) {
        next.add(key);
      } else {
        next.delete(key);
      }
      return next;
    });
  }, [getNodeKey]);

  return {
    selectedNodes,
    handleNodeSelect,
    getNodeKey,
    getLeafNodes,
    getLowAccuracyCategories,
    classifications,
  };
}

