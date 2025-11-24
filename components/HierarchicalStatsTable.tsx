import React, { useState } from 'react';
import type { StatsNode } from '../services/stats';
import { TaxonomyDetailPopup } from './TaxonomyDetailPopup';
import { findTaxonomyByDepth } from '../services/db';
import type { Taxonomy } from '../types';
import { useLanguage } from '../contexts/LanguageContext';
import { getTranslation } from '../utils/translations';

interface HierarchicalStatsTableProps {
  data: StatsNode[];
  onImageClick?: (sessionIds: string[]) => void;
  onNumberClick?: (node: StatsNode, isCorrect: boolean) => void;
  selectedNodes?: Set<string>;
  onNodeSelect?: (node: StatsNode, selected: boolean) => void;
  onQuestionClick?: (node: StatsNode) => void;
}

interface StatsRowProps {
  node: StatsNode;
  level: number;
  onImageClick?: (sessionIds: string[]) => void;
  onNumberClick?: (node: StatsNode, isCorrect: boolean) => void;
  selectedNodes?: Set<string>;
  onNodeSelect?: (node: StatsNode, selected: boolean) => void;
  onQuestionClick?: (node: StatsNode) => void;
}

const StatsRow: React.FC<StatsRowProps> = ({ node, level, onImageClick, onNumberClick, selectedNodes, onNodeSelect, onQuestionClick }) => {
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
        className={`border-b border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-900/50 cursor-pointer font-semibold`}
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
              <span className="text-slate-500 dark:text-slate-400">
                {isExpanded ? '▼' : '▶'}
              </span>
            )}
            <span className="text-slate-800 dark:text-slate-200">
              {node.depth4 || node.depth3 || node.depth2 || node.depth1}
            </span>
            {/* 4depth 행에만 '?' 버튼 표시 */}
            {node.depth4 && !hasChildren && onQuestionClick && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onQuestionClick(node);
                }}
                className="ml-2 w-6 h-6 rounded-full bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-300 dark:hover:bg-slate-600 flex items-center justify-center text-sm font-bold transition-colors"
                title="분류 정보 보기"
              >
                ?
              </button>
            )}
          </div>
        </td>
        <td className="p-2">
          <button
            onClick={(e) => {
              e.stopPropagation();
              console.log('Correct button clicked', { node, onNumberClick: !!onNumberClick });
              if (onNumberClick) {
                console.log('Calling onNumberClick with isCorrect=true');
                onNumberClick(node, true);
              } else {
                console.log('Calling handleCountClick');
                handleCountClick(node.sessionIds || []);
              }
            }}
            className="text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 hover:underline transition-colors"
            disabled={!node.sessionIds || node.sessionIds.length === 0}
          >
            {node.correct_count}
          </button>
        </td>
        <td className="p-2">
          <button
            onClick={(e) => {
              e.stopPropagation();
              console.log('Incorrect button clicked', { node, onNumberClick: !!onNumberClick });
              if (onNumberClick) {
                console.log('Calling onNumberClick with isCorrect=false');
                onNumberClick(node, false);
              } else {
                console.log('Calling handleCountClick');
                handleCountClick(node.sessionIds || []);
              }
            }}
            className="text-red-600 dark:text-red-400 hover:text-red-800 dark:hover:text-red-300 hover:underline transition-colors"
            disabled={!node.sessionIds || node.sessionIds.length === 0}
          >
            {node.incorrect_count}
          </button>
        </td>
        <td className="p-2">
          {node.total_count > 0 ? (
            <span className="text-slate-600 dark:text-slate-400">
              {((node.correct_count / node.total_count) * 100).toFixed(1)}%
            </span>
          ) : (
            <span className="text-slate-400 dark:text-slate-500">-</span>
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
          onQuestionClick={onQuestionClick}
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
  onNodeSelect,
  onQuestionClick
}) => {
  const { language } = useLanguage();
  const t = getTranslation(language);
  
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left border-collapse">
        <thead>
          <tr className="bg-slate-100 dark:bg-slate-800">
            <th className="p-2 text-slate-800 dark:text-slate-200">{t.stats.category}</th>
            <th className="p-2 text-slate-800 dark:text-slate-200">{t.stats.correct}</th>
            <th className="p-2 text-slate-800 dark:text-slate-200">{t.stats.incorrect}</th>
            <th className="p-2 text-slate-800 dark:text-slate-200">{t.stats.accuracy}</th>
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
              onQuestionClick={onQuestionClick}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
};
