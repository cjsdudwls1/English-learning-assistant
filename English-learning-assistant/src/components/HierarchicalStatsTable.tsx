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
  const { language } = useLanguage();
  const hasChildren = node.children && node.children.length > 0;
  // 들여쓰기 폭은 컨테이너의 --indent-scale이 정한다(모바일 0.6 / 데스크톱 1).
  // depth4까지 펼치면 모바일에서 들여쓰기가 분류 열을 다 먹었다.
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
        <td className="p-1.5 sm:p-2 align-top" style={{ paddingLeft: `calc(${indent}px * var(--indent-scale, 1) + 8px)` }}>
          <div className="flex items-center gap-1.5 sm:gap-2 min-w-0">
            {/* 상자는 16px 그대로 두고 label의 p-2/-m-2로 탭 영역만 32px로 넓힌다(레이아웃 폭은 그대로).
                label 자신의 클릭도 tr까지 올라가면 행이 같이 접히므로, input과 똑같이 전파만 끊는다. */}
            {onNodeSelect && (
              <label
                className="inline-flex items-center justify-center p-2 -m-2 shrink-0 cursor-pointer"
                onClick={(e) => e.stopPropagation()}
              >
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={handleCheckboxChange}
                  onClick={(e) => e.stopPropagation()}
                  className="w-4 h-4 shrink-0 cursor-pointer"
                  aria-label={language === 'ko'
                    ? `${node.depth4 || node.depth3 || node.depth2 || node.depth1} 선택`
                    : `Select ${node.depth4 || node.depth3 || node.depth2 || node.depth1}`}
                />
              </label>
            )}
            {hasChildren && (
              <span className="text-slate-500 dark:text-slate-400 shrink-0">
                {isExpanded ? '▼' : '▶'}
              </span>
            )}
            <span className="text-slate-800 dark:text-slate-200 min-w-0 break-words">
              {node.depth4 || node.depth3 || node.depth2 || node.depth1}
            </span>
            {/* 4depth 행에만 '?' 버튼 표시.
                동그라미는 24px 그대로 두고 투명한 ::before로 탭 영역만 40x40으로 넓힌다.
                여기서는 p-2/-m-2를 못 쓴다 — 버튼에 배경(rounded-full bg-*)이 있어 패딩을 주면
                동그라미까지 같이 커진다. ::before는 레이아웃/시각 크기를 전혀 건드리지 않는다.

                상하를 8px로 똑같이 주면 안 된다. 행 높이는 정답/오답 숫자 버튼(min-h-1.75rem=28px)이
                정하고 td는 align-top이라, 24px 동그라미 위로는 셀 패딩 6px뿐이고 아래로는 6px+여백 4px=10px다.
                위로 8px을 주면 2px이 **윗 행** 위로 삐져나가는데, tr 전체가 onClick={handleToggle}이라
                그 2px 띠를 누르면 윗 행이 접히는 대신 이 팝업이 열린다. 그래서 위 6 / 아래 10으로 나눈다 —
                합이 그대로 40px이고 행 높이도 안 건드린다(py를 키우면 화면당 행이 10% 줄어든다).
                좌우 8px은 같은 행 안에서만 번지므로 겨냥한 버튼이 그대로 잡힌다 — 오작동이 아니다.

                sm:에서는 숫자 버튼의 min-h가 풀려 행 내용이 24px(=동그라미와 동일)이 되고 패딩도 8px라
                위아래 여유가 8/8로 대칭이 된다. 그래서 아래 10px을 그대로 두면 이번엔 데스크톱에서
                아랫 행을 2px 침범한다 — sm:에서 8/8로 다시 맞춘다(탭 영역은 여전히 40px). */}
            {node.depth4 && !hasChildren && onQuestionClick && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onQuestionClick(node);
                }}
                className="relative ml-1 sm:ml-2 w-6 h-6 shrink-0 rounded-full bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-300 dark:hover:bg-slate-600 flex items-center justify-center text-sm font-bold transition-colors before:absolute before:content-[''] before:-inset-x-2 before:-top-1.5 before:-bottom-2.5 sm:before:-top-2 sm:before:-bottom-2"
                title={language === 'ko' ? '분류 정보 보기' : 'View Classification Details'}
              >
                ?
              </button>
            )}
          </div>
        </td>
        {/* 정답/오답 숫자 버튼: 글자 크기(32x28)는 그대로 두고 ::before로 탭 영역만 40x40으로 넓힌다.
            좌우 4px·상하 6px 확장이라 셀 패딩(p-1.5=6px) 안에 정확히 들어간다 —
            옆 셀 버튼도, 위아래 행도 침범하지 않는다.
            min-h/min-w는 sm:에서 반드시 푼다. 이 버튼 높이가 곧 행 높이라, 28px을 데스크톱까지
            끌고 가면 표 전체가 행당 4px(약 10%) 두꺼워진다 — 마우스에는 탭 하한이 필요 없다. */}
        <td className="p-1.5 sm:p-2 align-top">
          <button
            onClick={(e) => {
              e.stopPropagation();
              if (onNumberClick) {
                onNumberClick(node, true);
              } else {
                handleCountClick(node.sessionIds || []);
              }
            }}
            className="relative inline-flex items-center justify-center min-w-[2rem] min-h-[1.75rem] sm:min-w-0 sm:min-h-0 px-1 text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 hover:underline transition-colors before:absolute before:content-[''] before:-inset-x-1 before:-inset-y-1.5"
            disabled={!node.sessionIds || node.sessionIds.length === 0}
          >
            {node.correct_count}
          </button>
        </td>
        <td className="p-1.5 sm:p-2 align-top">
          <button
            onClick={(e) => {
              e.stopPropagation();
              if (onNumberClick) {
                onNumberClick(node, false);
              } else {
                handleCountClick(node.sessionIds || []);
              }
            }}
            className="relative inline-flex items-center justify-center min-w-[2rem] min-h-[1.75rem] sm:min-w-0 sm:min-h-0 px-1 text-red-600 dark:text-red-400 hover:text-red-800 dark:hover:text-red-300 hover:underline transition-colors before:absolute before:content-[''] before:-inset-x-1 before:-inset-y-1.5"
            disabled={!node.sessionIds || node.sessionIds.length === 0}
          >
            {node.incorrect_count}
          </button>
        </td>
        <td className="p-1.5 sm:p-2 align-top whitespace-nowrap">
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
    <div className="overflow-x-auto w-full max-w-full [--indent-scale:0.6] sm:[--indent-scale:1]">
      <table className="w-full text-left border-collapse text-sm sm:text-base">
        <thead>
          <tr className="bg-slate-100 dark:bg-slate-800">
            <th className="p-1.5 sm:p-2 text-slate-800 dark:text-slate-200">{t.stats.category}</th>
            <th className="p-1.5 sm:p-2 text-slate-800 dark:text-slate-200">{t.stats.correct}</th>
            <th className="p-1.5 sm:p-2 text-slate-800 dark:text-slate-200">{t.stats.incorrect}</th>
            <th className="p-1.5 sm:p-2 text-slate-800 dark:text-slate-200 whitespace-nowrap">{t.stats.accuracy}</th>
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
