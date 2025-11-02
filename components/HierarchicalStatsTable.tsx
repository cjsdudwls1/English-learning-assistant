import React, { useState } from 'react';
import type { StatsNode } from '../services/stats';

interface HierarchicalStatsTableProps {
  data: StatsNode[];
  onImageClick?: (sessionIds: string[]) => void;
  onNumberClick?: (node: StatsNode, isCorrect: boolean) => void;
  selectedNodes?: Set<string>;
  onNodeSelect?: (node: StatsNode, selected: boolean) => void;
}

interface StatsRowProps {
  node: StatsNode;
  level: number;
  onImageClick?: (sessionIds: string[]) => void;
  onNumberClick?: (node: StatsNode, isCorrect: boolean) => void;
  selectedNodes?: Set<string>;
  onNodeSelect?: (node: StatsNode, selected: boolean) => void;
}

const StatsRow: React.FC<StatsRowProps> = ({ node, level, onImageClick, onNumberClick, selectedNodes, onNodeSelect }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const hasChildren = node.children && node.children.length > 0;
  const indent = level * 20;

  // 노드 키 생성 (고유 식별자)
  const getNodeKey = (n: StatsNode): string => {
    return `${n.depth1 || ''}_${n.depth2 || ''}_${n.depth3 || ''}_${n.depth4 || ''}`;
  };

  const nodeKey = getNodeKey(node);
  const isSelected = selectedNodes?.has(nodeKey) || false;

  // 하위 노드들을 모두 가져오는 함수
  const getAllDescendants = (n: StatsNode): StatsNode[] => {
    const descendants: StatsNode[] = [];
    if (n.children) {
      for (const child of n.children) {
        descendants.push(child);
        descendants.push(...getAllDescendants(child));
      }
    }
    return descendants;
  };

  const handleToggle = () => {
    if (hasChildren) {
      setIsExpanded(!isExpanded);
    }
  };

  const handleCountClick = (sessionIds: string[]) => {
    if (onImageClick && sessionIds.length > 0) {
      onImageClick(sessionIds);
    }
  };

  const handleCheckboxChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    e.stopPropagation();
    const checked = e.target.checked;
    
    if (onNodeSelect) {
      // 상위 노드 선택 시 하위 모든 노드도 선택
      if (checked) {
        // 자신 선택
        onNodeSelect(node, true);
        // 모든 하위 노드 선택
        const descendants = getAllDescendants(node);
        descendants.forEach(desc => onNodeSelect(desc, true));
      } else {
        // 자신 해제
        onNodeSelect(node, false);
        // 모든 하위 노드 해제
        const descendants = getAllDescendants(node);
        descendants.forEach(desc => onNodeSelect(desc, false));
      }
    }
  };

  return (
    <>
      <tr 
        className={`border-b hover:bg-slate-50 cursor-pointer font-semibold`}
        onClick={handleToggle}
        style={{ paddingLeft: '0px' }}
      >
        <td className="p-2" style={{ paddingLeft: `${indent + 8}px` }}>
          <div className="flex items-center gap-2">
            {/* 체크박스 추가 */}
            {onNodeSelect && (
              <input
                type="checkbox"
                checked={isSelected}
                onChange={handleCheckboxChange}
                onClick={(e) => e.stopPropagation()}
                className="w-4 h-4 cursor-pointer"
              />
            )}
            {hasChildren && (
              <span className="text-slate-500">
                {isExpanded ? '▼' : '▶'}
              </span>
            )}
            <span>
              {node.depth4 || node.depth3 || node.depth2 || node.depth1}
            </span>
          </div>
        </td>
        <td className="p-2">
          <button
            onClick={(e) => {
              e.stopPropagation();
              if (onNumberClick) {
                onNumberClick(node, true);
              } else {
                handleCountClick(node.sessionIds || []);
              }
            }}
            className="text-blue-600 hover:text-blue-800 hover:underline"
            disabled={!node.sessionIds || node.sessionIds.length === 0}
          >
            {node.correct_count}
          </button>
        </td>
        <td className="p-2">
          <button
            onClick={(e) => {
              e.stopPropagation();
              if (onNumberClick) {
                onNumberClick(node, false);
              } else {
                handleCountClick(node.sessionIds || []);
              }
            }}
            className="text-red-600 hover:text-red-800 hover:underline"
            disabled={!node.sessionIds || node.sessionIds.length === 0}
          >
            {node.incorrect_count}
          </button>
        </td>
        <td className="p-2">
          {node.total_count > 0 ? (
            <span className="text-slate-600">
              {((node.correct_count / node.total_count) * 100).toFixed(1)}%
            </span>
          ) : (
            <span className="text-slate-400">-</span>
          )}
        </td>
      </tr>
      {isExpanded && hasChildren && node.children?.map((child, index) => (
        <StatsRow
          key={`${child.depth1}-${child.depth2}-${child.depth3}-${child.depth4}-${index}`}
          node={child}
          level={level + 1}
          onImageClick={onImageClick}
          onNumberClick={onNumberClick}
          selectedNodes={selectedNodes}
          onNodeSelect={onNodeSelect}
        />
      ))}
    </>
  );
};

export const HierarchicalStatsTable: React.FC<HierarchicalStatsTableProps> = ({ 
  data, 
  onImageClick,
  onNumberClick,
  selectedNodes,
  onNodeSelect
}) => {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left border-collapse">
        <thead>
          <tr className="bg-slate-100">
            <th className="p-2">카테고리</th>
            <th className="p-2">정답</th>
            <th className="p-2">오답</th>
            <th className="p-2">정답률</th>
          </tr>
        </thead>
        <tbody>
          {data.map((node, index) => (
            <StatsRow
              key={`${node.depth1}-${index}`}
              node={node}
              level={0}
              onImageClick={onImageClick}
              onNumberClick={onNumberClick}
              selectedNodes={selectedNodes}
              onNodeSelect={onNodeSelect}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
};
