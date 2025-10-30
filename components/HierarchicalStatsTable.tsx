import React, { useState } from 'react';
import type { StatsNode } from '../services/stats';

interface HierarchicalStatsTableProps {
  data: StatsNode[];
  onImageClick?: (sessionIds: string[]) => void;
  onNumberClick?: (node: StatsNode, isCorrect: boolean) => void;
}

interface StatsRowProps {
  node: StatsNode;
  level: number;
  onImageClick?: (sessionIds: string[]) => void;
  onNumberClick?: (node: StatsNode, isCorrect: boolean) => void;
}

const StatsRow: React.FC<StatsRowProps> = ({ node, level, onImageClick, onNumberClick }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const hasChildren = node.children && node.children.length > 0;
  const indent = level * 20;

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

  return (
    <>
      <tr 
        className={`border-b hover:bg-slate-50 cursor-pointer ${hasChildren ? 'font-semibold' : ''}`}
        onClick={handleToggle}
        style={{ paddingLeft: `${indent}px` }}
      >
        <td className="p-2" style={{ paddingLeft: `${indent + 8}px` }}>
          <div className="flex items-center gap-2">
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
        />
      ))}
    </>
  );
};

export const HierarchicalStatsTable: React.FC<HierarchicalStatsTableProps> = ({ 
  data, 
  onImageClick,
  onNumberClick 
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
            />
          ))}
        </tbody>
      </table>
    </div>
  );
};
