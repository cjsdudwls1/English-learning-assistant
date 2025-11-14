import React, { useMemo, useState, useCallback } from 'react';
import {
  Chart as ChartJS,
  ArcElement,
  Tooltip,
  Legend,
  BarElement,
  CategoryScale,
  LinearScale,
  Title,
} from 'chart.js';
import { Bar, Doughnut, getElementAtEvent } from 'react-chartjs-2';
import type { TypeStatsRow } from '../services/stats';

ChartJS.register(ArcElement, Tooltip, Legend, BarElement, CategoryScale, LinearScale, Title);

type Theme = 'light' | 'dark';

// 드릴다운 상태 타입
type DrillDownState = 
  | { type: 'overview' }
  | { type: 'filtered', filter: 'correct' | 'incorrect' }
  | { type: 'category', filter: 'correct' | 'incorrect', category: string }
  | { type: 'depth', filter: 'correct' | 'incorrect', category: string, depth: number };

interface StatsOverviewChartsProps {
  rows: TypeStatsRow[];
  totals: { correct: number; incorrect: number; total: number };
  labels: {
    overview: string;
    correctVsIncorrect: string;
    categoryDistribution: string;
    noData: string;
    correct: string;
    incorrect: string;
    total: string;
    unclassified: string;
  };
  theme: Theme;
  maxCategories?: number;
}

const CHART_COLORS = {
  light: {
    text: 'rgba(30, 41, 59, 0.85)', // slate-800
    grid: 'rgba(148, 163, 184, 0.2)', // slate-400 at 20%
    correct: 'rgba(34, 197, 94, 0.7)', // green-500
    correctHover: 'rgba(34, 197, 94, 0.9)',
    incorrect: 'rgba(248, 113, 113, 0.7)', // red-400
    incorrectHover: 'rgba(248, 113, 113, 0.9)',
    background: 'rgba(255, 255, 255, 1)',
  },
  dark: {
    text: 'rgba(226, 232, 240, 0.9)', // slate-200
    grid: 'rgba(148, 163, 184, 0.25)',
    correct: 'rgba(74, 222, 128, 0.7)', // green-400
    correctHover: 'rgba(74, 222, 128, 0.9)',
    incorrect: 'rgba(248, 113, 113, 0.7)',
    incorrectHover: 'rgba(248, 113, 113, 0.9)',
    background: 'rgba(15, 23, 42, 0.4)', // slate-900/40
  },
} as const;

// 카테고리별 색상 팔레트 (더 많은 카테고리를 위해)
const CATEGORY_COLORS = [
  'rgba(59, 130, 246, 0.7)',   // blue
  'rgba(139, 92, 246, 0.7)',   // violet
  'rgba(236, 72, 153, 0.7)',   // pink
  'rgba(251, 146, 60, 0.7)',  // orange
  'rgba(34, 197, 94, 0.7)',    // green
  'rgba(234, 179, 8, 0.7)',    // yellow
  'rgba(168, 85, 247, 0.7)',   // purple
  'rgba(14, 165, 233, 0.7)',   // sky
  'rgba(20, 184, 166, 0.7)',   // teal
  'rgba(245, 101, 101, 0.7)',  // red
];

export const StatsOverviewCharts: React.FC<StatsOverviewChartsProps> = ({
  rows,
  totals,
  labels,
  theme,
  maxCategories = 8,
}) => {
  const palette = CHART_COLORS[theme];
  const [drillDownState, setDrillDownState] = useState<DrillDownState>({ type: 'overview' });
  const [doughnutChartRef, setDoughnutChartRef] = useState<any>(null);
  const [barChartRef, setBarChartRef] = useState<any>(null);

  // 뒤로가기 핸들러
  const handleBack = useCallback(() => {
    if (drillDownState.type === 'depth') {
      setDrillDownState({ type: 'category', filter: drillDownState.filter, category: drillDownState.category });
    } else if (drillDownState.type === 'category') {
      setDrillDownState({ type: 'filtered', filter: drillDownState.filter });
    } else if (drillDownState.type === 'filtered') {
      setDrillDownState({ type: 'overview' });
    }
  }, [drillDownState]);

  // 도넛차트 클릭 핸들러
  const handleDoughnutClick = useCallback((event: any, chartData: any) => {
    if (!doughnutChartRef) return;
    
    const elements = getElementAtEvent(doughnutChartRef, event);
    if (elements.length === 0) return;

    const element = elements[0];
    const index = element.index;

    if (drillDownState.type === 'overview') {
      // 전체 뷰에서 정답/오답 클릭
      const filter = index === 0 ? 'correct' : 'incorrect';
      setDrillDownState({ type: 'filtered', filter });
    } else if (drillDownState.type === 'filtered') {
      // 필터링된 뷰에서 카테고리 클릭
      const category = chartData?.labels?.[index] as string;
      if (category) {
        setDrillDownState({ 
          type: 'category', 
          filter: drillDownState.filter, 
          category 
        });
      }
    } else if (drillDownState.type === 'category') {
      // 카테고리 뷰에서 depth2 클릭 시 depth3로 드릴다운
      const depthLabel = chartData?.labels?.[index] as string;
      if (depthLabel) {
        setDrillDownState({
          type: 'depth',
          filter: drillDownState.filter,
          category: drillDownState.category,
          depth: 2
        });
      }
    }
  }, [doughnutChartRef, drillDownState]);

  // 막대그래프 클릭 핸들러
  const handleBarClick = useCallback((event: any, chartData: any) => {
    if (!barChartRef) return;
    
    const elements = getElementAtEvent(barChartRef, event);
    if (elements.length === 0) return;

    const element = elements[0];
    const index = element.index;

    if (drillDownState.type === 'filtered') {
      // 필터링된 뷰에서 카테고리 클릭 시 해당 카테고리의 depth별 정보 표시
      const category = chartData?.labels?.[index] as string;
      if (category) {
        setDrillDownState({
          type: 'category',
          filter: drillDownState.filter,
          category
        });
      }
    } else if (drillDownState.type === 'category') {
      // 카테고리 뷰에서 depth2 클릭 시 depth3로 드릴다운
      const depthLabel = chartData?.labels?.[index] as string;
      if (depthLabel) {
        setDrillDownState({
          type: 'depth',
          filter: drillDownState.filter,
          category: drillDownState.category,
          depth: 2
        });
      }
    }
  }, [barChartRef, drillDownState]);

  // 필터링된 rows 계산
  const filteredRows = useMemo(() => {
    if (drillDownState.type === 'overview') {
      return rows;
    }
    
    const filter = drillDownState.filter;
    return rows.filter(row => {
      if (filter === 'correct') {
        return (row.correct_count || 0) > 0;
      } else {
        return (row.incorrect_count || 0) > 0;
      }
    });
  }, [rows, drillDownState]);

  // 도넛차트 데이터 계산
  const doughnutData = useMemo(() => {
    if (drillDownState.type === 'overview') {
      // 전체 뷰: 정답/오답 비율
      if (totals.total === 0) return null;
      
      return {
        labels: [labels.correct, labels.incorrect],
        datasets: [{
          data: [totals.correct, totals.incorrect],
          backgroundColor: [palette.correct, palette.incorrect],
          hoverBackgroundColor: [palette.correctHover, palette.incorrectHover],
          borderWidth: 0,
        }],
      };
    } else if (drillDownState.type === 'filtered') {
      // 필터링된 뷰: 카테고리별 구성 비율
      const categoryMap = new Map<string, number>();
      
      filteredRows.forEach(row => {
        const key = row.depth1 || labels.unclassified;
        const count = drillDownState.filter === 'correct' 
          ? (row.correct_count || 0)
          : (row.incorrect_count || 0);
        
        if (count > 0) {
          categoryMap.set(key, (categoryMap.get(key) || 0) + count);
        }
      });

      if (categoryMap.size === 0) return null;

      const sorted = Array.from(categoryMap.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, maxCategories);

      const categoryLabels = sorted.map(([name]) => name);
      const categoryData = sorted.map(([, count]) => count);
      const total = categoryData.reduce((sum, val) => sum + val, 0);

      return {
        labels: categoryLabels,
        datasets: [{
          data: categoryData,
          backgroundColor: categoryLabels.map((_, idx) => 
            CATEGORY_COLORS[idx % CATEGORY_COLORS.length]
          ),
          hoverBackgroundColor: categoryLabels.map((_, idx) => 
            CATEGORY_COLORS[idx % CATEGORY_COLORS.length].replace('0.7', '0.9')
          ),
          borderWidth: 0,
        }],
        total,
      };
    } else if (drillDownState.type === 'category') {
      // 카테고리 뷰: depth2별 구성 비율
      const depthMap = new Map<string, number>();
      
      filteredRows
        .filter(row => row.depth1 === drillDownState.category)
        .forEach(row => {
          const key = row.depth2 || labels.unclassified;
          const count = drillDownState.filter === 'correct' 
            ? (row.correct_count || 0)
            : (row.incorrect_count || 0);
          
          if (count > 0) {
            depthMap.set(key, (depthMap.get(key) || 0) + count);
          }
        });

      if (depthMap.size === 0) return null;

      const sorted = Array.from(depthMap.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, maxCategories);

      const depthLabels = sorted.map(([name]) => name);
      const depthData = sorted.map(([, count]) => count);
      const total = depthData.reduce((sum, val) => sum + val, 0);

      return {
        labels: depthLabels,
        datasets: [{
          data: depthData,
          backgroundColor: depthLabels.map((_, idx) => 
            CATEGORY_COLORS[idx % CATEGORY_COLORS.length]
          ),
          hoverBackgroundColor: depthLabels.map((_, idx) => 
            CATEGORY_COLORS[idx % CATEGORY_COLORS.length].replace('0.7', '0.9')
          ),
          borderWidth: 0,
        }],
        total,
      };
    } else {
      // depth 뷰: depth3별 구성 비율
      const depthMap = new Map<string, number>();
      
      filteredRows
        .filter(row => 
          row.depth1 === drillDownState.category && 
          row.depth2 && 
          drillDownState.depth === 2
        )
        .forEach(row => {
          const key = row.depth3 || labels.unclassified;
          const count = drillDownState.filter === 'correct' 
            ? (row.correct_count || 0)
            : (row.incorrect_count || 0);
          
          if (count > 0) {
            depthMap.set(key, (depthMap.get(key) || 0) + count);
          }
        });

      if (depthMap.size === 0) return null;

      const sorted = Array.from(depthMap.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, maxCategories);

      const depthLabels = sorted.map(([name]) => name);
      const depthData = sorted.map(([, count]) => count);
      const total = depthData.reduce((sum, val) => sum + val, 0);

      return {
        labels: depthLabels,
        datasets: [{
          data: depthData,
          backgroundColor: depthLabels.map((_, idx) => 
            CATEGORY_COLORS[idx % CATEGORY_COLORS.length]
          ),
          hoverBackgroundColor: depthLabels.map((_, idx) => 
            CATEGORY_COLORS[idx % CATEGORY_COLORS.length].replace('0.7', '0.9')
          ),
          borderWidth: 0,
        }],
        total,
      };
    }
  }, [drillDownState, totals, labels, palette, filteredRows, maxCategories]);

  // 도넛차트 중앙 표시 데이터
  const doughnutCenterData = useMemo(() => {
    if (drillDownState.type === 'overview') {
      return {
        label: labels.total,
        value: totals.total,
        subValues: [
          { label: labels.correct, value: totals.correct },
          { label: labels.incorrect, value: totals.incorrect },
        ],
      };
    } else if (doughnutData && 'total' in doughnutData) {
      return {
        label: drillDownState.type === 'filtered' 
          ? `${drillDownState.filter === 'correct' ? labels.correct : labels.incorrect} ${labels.total}`
          : drillDownState.type === 'category'
          ? drillDownState.category
          : `${drillDownState.category} - Depth ${drillDownState.depth}`,
        value: doughnutData.total,
        subValues: undefined,
      };
    }
    return null;
  }, [drillDownState, totals, labels, doughnutData]);

  // 막대그래프 데이터 계산
  const { barData, barOptions } = useMemo(() => {
    if (drillDownState.type === 'overview') {
      // 전체 뷰: depth1별 정오답
      const aggregation = new Map<string, { correct: number; incorrect: number; total: number }>();

      rows.forEach(row => {
        const key = row.depth1 || labels.unclassified;
        if (!aggregation.has(key)) {
          aggregation.set(key, { correct: 0, incorrect: 0, total: 0 });
        }
        const entry = aggregation.get(key)!;
        entry.correct += row.correct_count || 0;
        entry.incorrect += row.incorrect_count || 0;
        entry.total += row.total_count || 0;
      });

      const sorted = Array.from(aggregation.entries())
        .sort((a, b) => b[1].total - a[1].total)
        .slice(0, maxCategories);

      if (sorted.length === 0) {
        return { barData: null, barOptions: undefined };
      }

      const labelsData = sorted.map(([name]) => name);
      const correctData = sorted.map(([, counts]) => counts.correct);
      const incorrectData = sorted.map(([, counts]) => counts.incorrect);

      return {
        barData: {
          labels: labelsData,
          datasets: [
            {
              label: labels.correct,
              data: correctData,
              backgroundColor: palette.correct,
              hoverBackgroundColor: palette.correctHover,
              borderRadius: 12,
              stack: 'counts',
            },
            {
              label: labels.incorrect,
              data: incorrectData,
              backgroundColor: palette.incorrect,
              hoverBackgroundColor: palette.incorrectHover,
              borderRadius: 12,
              stack: 'counts',
            },
          ],
        },
        barOptions: {
          responsive: true,
          maintainAspectRatio: false,
          onClick: (event: any) => {
            // barData는 useMemo 내부에서 계산되므로 여기서 직접 참조
            const currentBarData = barData;
            if (currentBarData) {
              handleBarClick(event, currentBarData);
            }
          },
          plugins: {
            legend: {
              position: 'bottom' as const,
              labels: {
                color: palette.text,
                boxWidth: 12,
                boxHeight: 12,
                usePointStyle: true,
              },
            },
            tooltip: {
              callbacks: {
                label: (context: any) => {
                  const value = context.parsed.y ?? context.parsed;
                  return `${context.dataset.label}: ${value}`;
                },
              },
            },
          },
          scales: {
            x: {
              stacked: true,
              ticks: {
                color: palette.text,
                maxRotation: 45,
                minRotation: 0,
              },
              grid: {
                display: false,
              },
            },
            y: {
              stacked: true,
              ticks: {
                color: palette.text,
              },
              grid: {
                color: palette.grid,
              },
            },
          },
        },
      };
    } else if (drillDownState.type === 'category') {
      // 카테고리 뷰: depth2별 정보
      const depthMap = new Map<string, { correct: number; incorrect: number; total: number }>();

      filteredRows
        .filter(row => row.depth1 === drillDownState.category)
        .forEach(row => {
          const key = row.depth2 || labels.unclassified;
          if (!depthMap.has(key)) {
            depthMap.set(key, { correct: 0, incorrect: 0, total: 0 });
          }
          const entry = depthMap.get(key)!;
          entry.correct += row.correct_count || 0;
          entry.incorrect += row.incorrect_count || 0;
          entry.total += row.total_count || 0;
        });

      const sorted = Array.from(depthMap.entries())
        .sort((a, b) => b[1].total - a[1].total)
        .slice(0, maxCategories);

      if (sorted.length === 0) {
        return { barData: null, barOptions: undefined };
      }

      const labelsData = sorted.map(([name]) => name);
      const correctData = sorted.map(([, counts]) => counts.correct);
      const incorrectData = sorted.map(([, counts]) => counts.incorrect);

      return {
        barData: {
          labels: labelsData,
          datasets: [
            {
              label: labels.correct,
              data: correctData,
              backgroundColor: palette.correct,
              hoverBackgroundColor: palette.correctHover,
              borderRadius: 12,
              stack: 'counts',
            },
            {
              label: labels.incorrect,
              data: incorrectData,
              backgroundColor: palette.incorrect,
              hoverBackgroundColor: palette.incorrectHover,
              borderRadius: 12,
              stack: 'counts',
            },
          ],
        },
        barOptions: {
          responsive: true,
          maintainAspectRatio: false,
          onClick: (event: any) => {
            // barData는 useMemo 내부에서 계산되므로 여기서 직접 참조
            const currentBarData = barData;
            if (currentBarData) {
              handleBarClick(event, currentBarData);
            }
          },
          plugins: {
            legend: {
              position: 'bottom' as const,
              labels: {
                color: palette.text,
                boxWidth: 12,
                boxHeight: 12,
                usePointStyle: true,
              },
            },
            tooltip: {
              callbacks: {
                label: (context: any) => {
                  const value = context.parsed.y ?? context.parsed;
                  return `${context.dataset.label}: ${value}`;
                },
              },
            },
          },
          scales: {
            x: {
              stacked: true,
              ticks: {
                color: palette.text,
                maxRotation: 45,
                minRotation: 0,
              },
              grid: {
                display: false,
              },
            },
            y: {
              stacked: true,
              ticks: {
                color: palette.text,
              },
              grid: {
                color: palette.grid,
              },
            },
          },
        },
      };
    } else if (drillDownState.type === 'depth') {
      // depth 뷰: depth3별 정보
      const depthMap = new Map<string, { correct: number; incorrect: number; total: number }>();

      filteredRows
        .filter(row => 
          row.depth1 === drillDownState.category && 
          row.depth2 && 
          drillDownState.depth === 2
        )
        .forEach(row => {
          const key = row.depth3 || labels.unclassified;
          if (!depthMap.has(key)) {
            depthMap.set(key, { correct: 0, incorrect: 0, total: 0 });
          }
          const entry = depthMap.get(key)!;
          entry.correct += row.correct_count || 0;
          entry.incorrect += row.incorrect_count || 0;
          entry.total += row.total_count || 0;
        });

      const sorted = Array.from(depthMap.entries())
        .sort((a, b) => b[1].total - a[1].total)
        .slice(0, maxCategories);

      if (sorted.length === 0) {
        return { barData: null, barOptions: undefined };
      }

      const labelsData = sorted.map(([name]) => name);
      const correctData = sorted.map(([, counts]) => counts.correct);
      const incorrectData = sorted.map(([, counts]) => counts.incorrect);

      return {
        barData: {
          labels: labelsData,
          datasets: [
            {
              label: labels.correct,
              data: correctData,
              backgroundColor: palette.correct,
              hoverBackgroundColor: palette.correctHover,
              borderRadius: 12,
              stack: 'counts',
            },
            {
              label: labels.incorrect,
              data: incorrectData,
              backgroundColor: palette.incorrect,
              hoverBackgroundColor: palette.incorrectHover,
              borderRadius: 12,
              stack: 'counts',
            },
          ],
        },
        barOptions: {
          responsive: true,
          maintainAspectRatio: false,
          onClick: (event: any) => {
            // barData는 useMemo 내부에서 계산되므로 여기서 직접 참조
            const currentBarData = barData;
            if (currentBarData) {
              handleBarClick(event, currentBarData);
            }
          },
          plugins: {
            legend: {
              position: 'bottom' as const,
              labels: {
                color: palette.text,
                boxWidth: 12,
                boxHeight: 12,
                usePointStyle: true,
              },
            },
            tooltip: {
              callbacks: {
                label: (context: any) => {
                  const value = context.parsed.y ?? context.parsed;
                  return `${context.dataset.label}: ${value}`;
                },
              },
            },
          },
          scales: {
            x: {
              stacked: true,
              ticks: {
                color: palette.text,
                maxRotation: 45,
                minRotation: 0,
              },
              grid: {
                display: false,
              },
            },
            y: {
              stacked: true,
              ticks: {
                color: palette.text,
              },
              grid: {
                color: palette.grid,
              },
            },
          },
        },
      };
    } else {
      // 필터링된 뷰: depth1별 정보 (필터링된 데이터만)
      const aggregation = new Map<string, { correct: number; incorrect: number; total: number }>();

      filteredRows.forEach(row => {
        const key = row.depth1 || labels.unclassified;
        if (!aggregation.has(key)) {
          aggregation.set(key, { correct: 0, incorrect: 0, total: 0 });
        }
        const entry = aggregation.get(key)!;
        entry.correct += row.correct_count || 0;
        entry.incorrect += row.incorrect_count || 0;
        entry.total += row.total_count || 0;
      });

      const sorted = Array.from(aggregation.entries())
        .sort((a, b) => b[1].total - a[1].total)
        .slice(0, maxCategories);

      if (sorted.length === 0) {
        return { barData: null, barOptions: undefined };
      }

      const labelsData = sorted.map(([name]) => name);
      const correctData = sorted.map(([, counts]) => counts.correct);
      const incorrectData = sorted.map(([, counts]) => counts.incorrect);

      return {
        barData: {
          labels: labelsData,
          datasets: [
            {
              label: labels.correct,
              data: correctData,
              backgroundColor: palette.correct,
              hoverBackgroundColor: palette.correctHover,
              borderRadius: 12,
              stack: 'counts',
            },
            {
              label: labels.incorrect,
              data: incorrectData,
              backgroundColor: palette.incorrect,
              hoverBackgroundColor: palette.incorrectHover,
              borderRadius: 12,
              stack: 'counts',
            },
          ],
        },
        barOptions: {
          responsive: true,
          maintainAspectRatio: false,
          onClick: (event: any) => {
            // barData는 useMemo 내부에서 계산되므로 여기서 직접 참조
            const currentBarData = barData;
            if (currentBarData) {
              handleBarClick(event, currentBarData);
            }
          },
          plugins: {
            legend: {
              position: 'bottom' as const,
              labels: {
                color: palette.text,
                boxWidth: 12,
                boxHeight: 12,
                usePointStyle: true,
              },
            },
            tooltip: {
              callbacks: {
                label: (context: any) => {
                  const value = context.parsed.y ?? context.parsed;
                  return `${context.dataset.label}: ${value}`;
                },
              },
            },
          },
          scales: {
            x: {
              stacked: true,
              ticks: {
                color: palette.text,
                maxRotation: 45,
                minRotation: 0,
              },
              grid: {
                display: false,
              },
            },
            y: {
              stacked: true,
              ticks: {
                color: palette.text,
              },
              grid: {
                color: palette.grid,
              },
            },
          },
        },
      };
    }
  }, [drillDownState, rows, labels, palette, maxCategories, filteredRows]);

  // 차트 제목 계산
  const doughnutTitle = useMemo(() => {
    if (drillDownState.type === 'overview') {
      return labels.correctVsIncorrect;
    } else if (drillDownState.type === 'filtered') {
      return `${drillDownState.filter === 'correct' ? labels.correct : labels.incorrect} 카테고리 구성`;
    } else if (drillDownState.type === 'category') {
      return `${drillDownState.category} - Depth 2별 구성`;
    } else {
      return `${drillDownState.category} - Depth ${drillDownState.depth}별 구성`;
    }
  }, [drillDownState, labels]);

  const barTitle = useMemo(() => {
    if (drillDownState.type === 'overview') {
      return labels.categoryDistribution;
    } else if (drillDownState.type === 'filtered') {
      return `${drillDownState.filter === 'correct' ? labels.correct : labels.incorrect} 유형별 분포`;
    } else if (drillDownState.type === 'category') {
      return `${drillDownState.category} - Depth 2별 분포`;
    } else {
      return `${drillDownState.category} - Depth ${drillDownState.depth}별 분포`;
    }
  }, [drillDownState, labels]);

  return (
    <div className="space-y-6">
      {/* 네비게이션 바 */}
      {drillDownState.type !== 'overview' && (
        <div className="flex items-center gap-2 text-sm">
          <button
            onClick={handleBack}
            className="px-3 py-1.5 bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-lg hover:bg-slate-300 dark:hover:bg-slate-600 transition-colors flex items-center gap-1"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            뒤로
          </button>
          <span className="text-slate-500 dark:text-slate-400">
            {drillDownState.type === 'filtered' 
              ? `${drillDownState.filter === 'correct' ? labels.correct : labels.incorrect} 필터`
              : drillDownState.type === 'category'
              ? drillDownState.category
              : `${drillDownState.category} - Depth ${drillDownState.depth}`}
          </span>
        </div>
      )}

      <div className="grid gap-6 md:grid-cols-2">
        {/* 도넛차트 */}
        <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/40 p-4 shadow-sm transition-all duration-300">
          <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-200 mb-4">
            {doughnutTitle}
          </h3>
          {doughnutData ? (
            <div className="relative h-64">
              <Doughnut
                ref={setDoughnutChartRef}
                data={doughnutData}
                onClick={(event: any) => {
                  // doughnutData는 useMemo 내부에서 계산되므로 여기서 직접 참조
                  const currentDoughnutData = doughnutData;
                  if (currentDoughnutData) {
                    handleDoughnutClick(event, currentDoughnutData);
                  }
                }}
                options={{
                  plugins: {
                    legend: {
                      position: 'bottom',
                      labels: {
                        color: palette.text,
                        boxWidth: 12,
                        boxHeight: 12,
                        usePointStyle: true,
                        padding: 12,
                      },
                    },
                    tooltip: {
                      callbacks: {
                        label: (context: any) => {
                          const label = context.label || '';
                          const value = context.parsed || 0;
                          const total = context.dataset.data.reduce((a: number, b: number) => a + b, 0);
                          const percentage = total > 0 ? ((value / total) * 100).toFixed(1) : '0';
                          return `${label}: ${value} (${percentage}%)`;
                        },
                      },
                    },
                  },
                  animation: {
                    animateRotate: true,
                    animateScale: true,
                    duration: 800,
                  },
                  cutout: '60%', // 중앙 공간을 더 크게 만들어 텍스트가 잘 보이도록
                  maintainAspectRatio: true,
                  layout: {
                    padding: {
                      top: 0,
                      bottom: 0,
                      left: 0,
                      right: 0,
                    },
                  },
                }}
              />
              {/* 도넛차트 구멍 중앙에 정확히 위치 - 차트의 실제 중앙 (legend를 제외한 차트 영역) */}
              {doughnutCenterData && (
                <div 
                  className="absolute flex flex-col items-center justify-center pointer-events-none z-10"
                  style={{
                    // Chart.js는 차트를 컨테이너의 중앙에 배치하지만, legend가 bottom에 있으면 차트가 위로 올라감
                    // 차트의 실제 중앙을 계산: 컨테이너 높이에서 legend 높이를 빼고, 그 중앙에 위치
                    left: '50%',
                    top: 'calc(50% - 1.5rem)', // legend가 bottom에 있으므로 약간 위로 조정
                    transform: 'translate(-50%, -50%)',
                  }}
                >
                  <span className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mb-1 text-center whitespace-nowrap">
                    {doughnutCenterData.label}
                  </span>
                  <span className="text-2xl sm:text-3xl font-bold text-slate-800 dark:text-slate-100 text-center">
                    {doughnutCenterData.value}
                  </span>
                  {doughnutCenterData.subValues && (
                    <div className="mt-2 flex flex-col sm:flex-row gap-2 sm:gap-4 text-xs sm:text-sm">
                      <div className="flex items-center justify-center gap-1">
                        <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: palette.correct }} />
                        <span className="text-slate-600 dark:text-slate-400 whitespace-nowrap">
                          {labels.correct}: {doughnutCenterData.subValues[0].value}
                        </span>
                      </div>
                      <div className="flex items-center justify-center gap-1">
                        <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: palette.incorrect }} />
                        <span className="text-slate-600 dark:text-slate-400 whitespace-nowrap">
                          {labels.incorrect}: {doughnutCenterData.subValues[1].value}
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-slate-500 dark:text-slate-400">{labels.noData}</p>
          )}
          {/* 클릭 안내 */}
          {drillDownState.type === 'overview' && (
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-2 text-center">
              💡 차트를 클릭하여 상세 정보를 확인하세요
            </p>
          )}
        </div>

        {/* 막대그래프 */}
        <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/40 p-4 shadow-sm transition-all duration-300">
          <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-200 mb-4">
            {barTitle}
          </h3>
          {barData ? (
            <div className="relative h-64">
              <Bar ref={setBarChartRef} data={barData} options={barOptions} />
            </div>
          ) : (
            <p className="text-sm text-slate-500 dark:text-slate-400">{labels.noData}</p>
          )}
          {/* 클릭 안내 */}
          {(drillDownState.type === 'filtered' || drillDownState.type === 'category') && (
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-2 text-center">
              💡 막대를 클릭하여 더 자세한 정보를 확인하세요
            </p>
          )}
        </div>
      </div>
    </div>
  );
};
