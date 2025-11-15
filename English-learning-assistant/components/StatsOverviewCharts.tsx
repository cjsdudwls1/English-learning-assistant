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
import ChartDataLabels from 'chartjs-plugin-datalabels';
import type { TypeStatsRow } from '../services/stats';

ChartJS.register(ArcElement, Tooltip, Legend, BarElement, CategoryScale, LinearScale, Title, ChartDataLabels);

type Theme = 'light' | 'dark';
type FilterType = 'correct' | 'incorrect';

// 드릴다운 상태 타입
type DrillDownState = 
  | { type: 'overview' }
  | { type: 'all' } // 전체 카테고리 구성
  | { type: 'filtered', filter: FilterType }
  | { type: 'category', filter?: FilterType, category: string } // filter가 없으면 정오답 모두 표시
  | { type: 'depth', filter: FilterType, category: string, depth: number, depth2Value?: string, depth3Value?: string };

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

// Chart.js context 타입 (any로 처리 - Chart.js 타입이 복잡함)
type ChartContext = any;

const CHART_COLORS = {
  light: {
    text: 'rgba(30, 41, 59, 0.85)',
    grid: 'rgba(148, 163, 184, 0.2)',
    correct: 'rgba(59, 130, 246, 0.7)',
    correctHover: 'rgba(59, 130, 246, 0.9)',
    incorrect: 'rgba(239, 68, 68, 0.7)',
    incorrectHover: 'rgba(239, 68, 68, 0.9)',
    background: 'rgba(255, 255, 255, 1)',
  },
  dark: {
    text: 'rgba(226, 232, 240, 0.9)',
    grid: 'rgba(148, 163, 184, 0.25)',
    correct: 'rgba(96, 165, 250, 0.7)',
    correctHover: 'rgba(96, 165, 250, 0.9)',
    incorrect: 'rgba(239, 68, 68, 0.7)',
    incorrectHover: 'rgba(239, 68, 68, 0.9)',
    background: 'rgba(15, 23, 42, 0.4)',
  },
} as const;

// 카테고리 색상 (정오답 색상과 구분되도록 파란색, 빨간색 계열 제외)
const CATEGORY_COLORS = [
  'rgba(139, 92, 246, 0.7)',  // 보라색
  'rgba(236, 72, 153, 0.7)',  // 핑크색
  'rgba(251, 146, 60, 0.7)',  // 주황색
  'rgba(34, 197, 94, 0.7)',   // 초록색
  'rgba(234, 179, 8, 0.7)',   // 노란색
  'rgba(168, 85, 247, 0.7)',  // 보라색
  'rgba(20, 184, 166, 0.7)',  // 청록색
  'rgba(251, 113, 133, 0.7)', // 연한 핑크색
  'rgba(249, 115, 22, 0.7)',  // 주황색
  'rgba(217, 70, 239, 0.7)',  // 자주색
];

// 차트 설정 상수
const CHART_CONFIG = {
  doughnut: {
    cutout: '60%',
    padding: { top: 0, bottom: 0, left: 0, right: 0 },
    animation: { duration: 800 },
  },
  bar: {
    borderRadius: 12,
    datalabelOffset: 5,
    datalabelFontSize: 11,
  },
} as const;

// 헬퍼 함수: depth 4인지 확인
const isDepth4 = (state: DrillDownState): boolean => {
  return state.type === 'depth' && state.depth === 4;
};

// 헬퍼 함수: 최종 depth인지 확인 (depth 2, 3, 4 모두 최종 depth일 수 있음)
const isFinalDepth = (state: DrillDownState): boolean => {
  return state.type === 'depth';
};

// 헬퍼 함수: 카운트 가져오기
const getCount = (row: TypeStatsRow, filter: FilterType | null): number => {
  if (filter === null) {
    // 필터가 null이면 전체 카운트 (정오답 모두)
    return (row.correct_count || 0) + (row.incorrect_count || 0);
  }
  return filter === 'correct' ? (row.correct_count || 0) : (row.incorrect_count || 0);
};

// 헬퍼 함수: 데이터 집계
const aggregateData = (
  rows: TypeStatsRow[],
  filter: FilterType | null,
  keyExtractor: (row: TypeStatsRow) => string,
  unclassified: string
): Map<string, number> => {
  const map = new Map<string, number>();
  rows.forEach(row => {
    const key = keyExtractor(row) || unclassified;
    const count = getCount(row, filter);
    if (count > 0) {
      map.set(key, (map.get(key) || 0) + count);
    }
  });
  return map;
};

// 헬퍼 함수: 정렬 및 제한
const sortAndLimit = <T,>(map: Map<string, T>, max: number): Array<[string, T]> => {
  return Array.from(map.entries())
    .sort((a, b) => {
      const aVal = typeof a[1] === 'number' ? a[1] : (a[1] as any).total || 0;
      const bVal = typeof b[1] === 'number' ? b[1] : (b[1] as any).total || 0;
      return bVal - aVal;
    })
    .slice(0, max);
};

// 헬퍼 함수: 색상 배열 생성
const createColorArray = (length: number, baseColors: string[]): string[] => {
  return Array.from({ length }, (_, idx) => baseColors[idx % baseColors.length]);
};

// 헬퍼 함수: 호버 색상 생성
const createHoverColors = (colors: string[]): string[] => {
  return colors.map(color => color.replace('0.7', '0.9'));
};

// 헬퍼 함수: 차트 키 생성
const generateChartKey = (type: string, state: DrillDownState): string => {
  if (state.type === 'filtered') {
    return `${type}-${state.type}-${state.filter}`;
  }
  if (state.type === 'category') {
    return `${type}-${state.type}-${state.category}`;
  }
  if (state.type === 'depth') {
    return `${type}-${state.type}-${state.depth}-${state.depth2Value || ''}-${state.depth3Value || ''}`;
  }
  return `${type}-${state.type}`;
};

// 헬퍼 함수: 현재 카테고리 라벨 가져오기
const getCurrentCategoryLabel = (state: DrillDownState, labels: StatsOverviewChartsProps['labels']): string => {
  if (state.type === 'all') {
    return labels.total; // '전체' 또는 'Total'
  }
  if (state.type === 'filtered') {
    return `${state.filter === 'correct' ? labels.correct : labels.incorrect} ${labels.total}`;
  }
  if (state.type === 'category') {
    return state.category;
  }
  if (state.type === 'depth') {
    if (state.depth === 2 && state.depth2Value) return state.depth2Value;
    if (state.depth === 3 && state.depth3Value) return state.depth3Value;
    if (state.depth === 4 && state.depth3Value) return state.depth3Value;
    return state.category;
  }
  return '';
};

// 막대 차트 옵션 생성 함수
const createBarChartOptions = (
  palette: typeof CHART_COLORS.light | typeof CHART_COLORS.dark,
  labels: StatsOverviewChartsProps['labels'],
  onBarClick: (event: any, chartData: any, elements?: any[]) => void,
  barData: any
): any => ({
  responsive: true,
  maintainAspectRatio: false,
  interaction: {
    mode: 'index' as const,
    intersect: false,
  },
  onClick: (event: any, elements: any) => {
    if (barData) {
      onBarClick(event, barData, elements);
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
        label: (context: ChartContext) => {
          const value = (context.parsed as { y?: number })?.y ?? context.parsed ?? 0;
          return `${context.dataset.label}: ${value}`;
        },
      },
    },
    datalabels: {
      display: false,
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
});

// 도넛 차트 옵션 생성 함수
const createDoughnutChartOptions = (palette: typeof CHART_COLORS.light | typeof CHART_COLORS.dark): any => ({
  plugins: {
    legend: {
      display: false,
    },
    tooltip: {
      callbacks: {
        label: (context: ChartContext) => {
          const label = (context.chart.data.labels?.[context.dataIndex] as string) || '';
          const value = context.parsed as number || 0;
          const total = context.dataset.data.reduce((a: number, b: number) => a + b, 0);
          const percentage = total > 0 ? ((value / total) * 100).toFixed(1) : '0';
          return `${label}: ${value} (${percentage}%)`;
        },
      },
    },
    datalabels: {
      display: (context: ChartContext) => {
        return context.dataset.data[context.dataIndex] > 0;
      },
      color: palette.text,
      anchor: 'center' as const,
      align: 'center' as const,
      offset: -25,
      font: {
        size: 13,
        weight: 'bold' as const,
      },
      formatter: (value: number) => {
        return value > 0 ? value.toString() : '';
      },
    },
  },
  animation: {
    animateRotate: true,
    animateScale: true,
    duration: CHART_CONFIG.doughnut.animation.duration,
  },
  cutout: CHART_CONFIG.doughnut.cutout,
  maintainAspectRatio: true,
  layout: {
    padding: CHART_CONFIG.doughnut.padding,
  },
});

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
      if (drillDownState.depth === 4) {
        setDrillDownState({ 
          type: 'depth', 
          filter: drillDownState.filter, 
          category: drillDownState.category, 
          depth: 3,
          depth2Value: drillDownState.depth2Value
        });
      } else if (drillDownState.depth === 3) {
        setDrillDownState({ 
          type: 'depth', 
          filter: drillDownState.filter, 
          category: drillDownState.category, 
          depth: 2
        });
      } else if (drillDownState.depth === 2) {
        setDrillDownState({ type: 'category', filter: drillDownState.filter, category: drillDownState.category });
      }
    } else if (drillDownState.type === 'category') {
      // category에서 뒤로가기 시 filter가 있으면 filtered로, 없으면 all로
      if (drillDownState.filter) {
        setDrillDownState({ type: 'filtered', filter: drillDownState.filter });
      } else {
        setDrillDownState({ type: 'all' });
      }
    } else if (drillDownState.type === 'filtered') {
      setDrillDownState({ type: 'overview' });
    } else if (drillDownState.type === 'all') {
      setDrillDownState({ type: 'overview' });
    }
  }, [drillDownState]);

  // 도넛차트 클릭 핸들러
  const handleDoughnutClick = useCallback((event: any, chartData: any) => {
    if (!doughnutChartRef) return;
    
    // 최종 depth일 때는 더 이상 드릴다운하지 않음
    if (isFinalDepth(drillDownState)) return;
    
    const elements = getElementAtEvent(doughnutChartRef, event);
    
    // overview 상태일 때 중앙 부분 클릭 (elements.length === 0)하면 '전체 카테고리 구성'으로 이동
    if (drillDownState.type === 'overview' && elements.length === 0) {
      setDrillDownState({ type: 'all' });
      return;
    }
    
    if (elements.length === 0) return;

    const index = elements[0].index;
    const clickedLabel = chartData?.labels?.[index] as string;

    if (drillDownState.type === 'overview') {
      const filter = index === 0 ? 'correct' : 'incorrect';
      setDrillDownState({ type: 'filtered', filter });
    } else if (drillDownState.type === 'all' && clickedLabel) {
      // 'all' 상태에서 카테고리 클릭 시 해당 카테고리로 이동 (filter 없이)
      setDrillDownState({
        type: 'category',
        category: clickedLabel
      });
    } else if (drillDownState.type === 'filtered' && clickedLabel) {
      setDrillDownState({ 
        type: 'category', 
        filter: drillDownState.filter, 
        category: clickedLabel
      });
    } else if (drillDownState.type === 'category' && clickedLabel) {
      setDrillDownState({
        type: 'depth',
        filter: drillDownState.filter,
        category: drillDownState.category,
        depth: 2,
        depth2Value: clickedLabel
      });
    } else if (drillDownState.type === 'depth' && clickedLabel) {
      if (drillDownState.depth === 2) {
        setDrillDownState({
          type: 'depth',
          filter: drillDownState.filter,
          category: drillDownState.category,
          depth: 3,
          depth2Value: drillDownState.depth2Value,
          depth3Value: clickedLabel
        });
      } else if (drillDownState.depth === 3) {
        setDrillDownState({
          type: 'depth',
          filter: drillDownState.filter,
          category: drillDownState.category,
          depth: 4,
          depth2Value: drillDownState.depth2Value,
          depth3Value: drillDownState.depth3Value
        });
      }
    }
  }, [doughnutChartRef, drillDownState]);

  // 막대그래프 클릭 핸들러
  const handleBarClick = useCallback((event: any, chartData: any, elements?: any[]) => {
    if (!barChartRef || !chartData?.labels) return;
    
    // 최종 depth일 때는 더 이상 드릴다운하지 않음
    if (isFinalDepth(drillDownState)) return;
    
    const chart = barChartRef;
    const xScale = chart.scales.x;
    const yScale = chart.scales.y;
    
    if (!xScale || !yScale) return;
    
    let index: number | null = null;
    let datasetIndex: number | null = null;
    
    // elements가 있으면 막대를 클릭한 것
    if (elements && elements.length > 0) {
      index = elements[0].index;
      
      // stacked bar의 경우 여러 element가 반환될 수 있음
      // y 좌표를 사용하여 실제로 클릭한 세그먼트 판별
      const canvasY = event.offsetY !== undefined ? event.offsetY : 
                     (event.nativeEvent?.offsetY !== undefined ? event.nativeEvent.offsetY : null);
      
      if (canvasY !== null && drillDownState.type === 'overview' && chartData.datasets && chartData.datasets.length >= 2) {
        // 막대의 정답/오답 세그먼트 높이 계산
        const correctData = chartData.datasets[0].data[index] || 0;
        const incorrectData = chartData.datasets[1].data[index] || 0;
        const total = correctData + incorrectData;
        
        if (total > 0 && yScale.max > 0) {
          // offsetY는 canvas의 위쪽 모서리(0)에서 시작
          // yScale은 차트 내부 좌표계이므로 변환 필요
          // canvasY가 yScale 영역 내에 있는지 확인
          if (canvasY >= yScale.top && canvasY <= yScale.bottom) {
            // yScale 내에서의 상대 위치 계산
            const scaleHeight = yScale.bottom - yScale.top;
            const relativeY = canvasY - yScale.top;
            
            // 데이터 값을 픽셀 높이로 변환
            const totalHeight = (total / yScale.max) * scaleHeight;
            const correctHeight = (correctData / yScale.max) * scaleHeight;
            
            // 막대의 bottom은 yScale.bottom (차트 내부 좌표)
            // 막대의 top은 bottom - totalHeight
            // 정답과 오답의 경계는 bottom - correctHeight
            const barBottom = scaleHeight; // yScale 내에서의 bottom (상대 위치)
            const barTop = barBottom - totalHeight;
            const boundaryY = barBottom - correctHeight;
            
            // 클릭한 y 위치가 어느 세그먼트인지 확인
            // (정답이 아래, 오답이 위에 쌓여있으므로)
            // relativeY는 위에서 아래로 증가 (0이 top, scaleHeight가 bottom)
            if (relativeY >= boundaryY && relativeY <= barBottom) {
              // 정답 세그먼트 클릭 (아래쪽)
              datasetIndex = 0;
            } else if (relativeY >= barTop && relativeY < boundaryY) {
              // 오답 세그먼트 클릭 (위쪽)
              datasetIndex = 1;
            } else {
              // elements에서 가져온 datasetIndex 사용
              datasetIndex = elements[0].datasetIndex;
            }
          } else {
            // yScale 영역 밖이면 elements 사용
            datasetIndex = elements[0].datasetIndex;
          }
        } else {
          // 데이터가 없으면 elements에서 가져온 값 사용
          datasetIndex = elements[0].datasetIndex;
        }
      } else {
        // y 좌표를 가져올 수 없으면 elements에서 가져온 값 사용
        datasetIndex = elements[0].datasetIndex;
      }
    } else {
      // elements가 없으면 차트 영역 전체에서 x축 위치 기반으로 계산
      // Chart.js의 이벤트는 chart.canvas 기준 좌표를 사용
      const canvasX = event.offsetX !== undefined ? event.offsetX : 
                     (event.nativeEvent?.offsetX !== undefined ? event.nativeEvent.offsetX : null);
      
      if (canvasX === null) return;
      
      // x축 스케일 영역 내에서 클릭한 경우
      if (canvasX >= xScale.left && canvasX <= xScale.right) {
        const labelCount = chartData.labels.length;
        const scaleWidth = xScale.right - xScale.left;
        const relativeX = canvasX - xScale.left;
        const calculatedIndex = Math.floor((relativeX / scaleWidth) * labelCount);
        
        if (calculatedIndex >= 0 && calculatedIndex < labelCount) {
          index = calculatedIndex;
          // y 좌표로 정답/오답 판별
          const canvasY = event.offsetY !== undefined ? event.offsetY : 
                         (event.nativeEvent?.offsetY !== undefined ? event.nativeEvent.offsetY : null);
          
          if (canvasY !== null && drillDownState.type === 'overview' && chartData.datasets && chartData.datasets.length >= 2) {
            const correctData = chartData.datasets[0].data[index] || 0;
            const incorrectData = chartData.datasets[1].data[index] || 0;
            const total = correctData + incorrectData;
            
            if (total > 0 && yScale.max > 0 && canvasY >= yScale.top && canvasY <= yScale.bottom) {
              const scaleHeight = yScale.bottom - yScale.top;
              const relativeY = canvasY - yScale.top;
              const totalHeight = (total / yScale.max) * scaleHeight;
              const correctHeight = (correctData / yScale.max) * scaleHeight;
              const barBottom = scaleHeight;
              const barTop = barBottom - totalHeight;
              const boundaryY = barBottom - correctHeight;
              
              if (relativeY >= boundaryY && relativeY <= barBottom) {
                datasetIndex = 0; // 정답
              } else if (relativeY >= barTop && relativeY < boundaryY) {
                datasetIndex = 1; // 오답
              } else {
                datasetIndex = 0; // 기본값: 정답
              }
            } else {
              datasetIndex = 0; // 기본값: 정답
            }
          } else {
            datasetIndex = 0; // 기본값: 정답
          }
        }
      }
    }
    
    if (index === null || index < 0 || index >= chartData.labels.length) return;
    
    const clickedLabel = chartData.labels[index] as string;
    
    // datasetIndex가 여전히 null이면 기본값 사용
    if (datasetIndex === null) {
      datasetIndex = 0;
    }

    // overview 상태에서 막대차트 클릭
    if (drillDownState.type === 'overview' && clickedLabel) {
      // 클릭한 세그먼트가 정답(0)인지 오답(1)인지 확인
      // x축 레이블을 클릭한 경우 datasetIndex가 0이므로 정답으로 처리
      const filter: FilterType = datasetIndex === 0 ? 'correct' : 'incorrect';
      // 해당 카테고리로 필터링
      setDrillDownState({
        type: 'category',
        filter,
        category: clickedLabel
      });
    } else if (drillDownState.type === 'filtered' && clickedLabel) {
      setDrillDownState({
        type: 'category',
        filter: drillDownState.filter,
        category: clickedLabel
      });
    } else if (drillDownState.type === 'category' && clickedLabel) {
      setDrillDownState({
        type: 'depth',
        filter: drillDownState.filter,
        category: drillDownState.category,
        depth: 2,
        depth2Value: clickedLabel
      });
    } else if (drillDownState.type === 'depth' && clickedLabel) {
      if (drillDownState.depth === 2) {
        setDrillDownState({
          type: 'depth',
          filter: drillDownState.filter,
          category: drillDownState.category,
          depth: 3,
          depth2Value: drillDownState.depth2Value,
          depth3Value: clickedLabel
        });
      } else if (drillDownState.depth === 3) {
        setDrillDownState({
          type: 'depth',
          filter: drillDownState.filter,
          category: drillDownState.category,
          depth: 4,
          depth2Value: drillDownState.depth2Value,
          depth3Value: drillDownState.depth3Value
        });
      }
    }
  }, [barChartRef, drillDownState]);

  // 필터링된 rows 계산
  const filteredRows = useMemo(() => {
    if (drillDownState.type === 'overview' || drillDownState.type === 'all') {
      return rows;
    }
    
    // 최종 depth일 때는 필터 무시하고 전체 rows 반환
    if (isFinalDepth(drillDownState)) {
      return rows;
    }
    
    // category 타입에서 filter가 없으면 정오답 모두 포함
    if (drillDownState.type === 'category' && !drillDownState.filter) {
      return rows;
    }
    
    const filter = drillDownState.filter;
    return rows.filter(row => getCount(row, filter) > 0);
  }, [rows, drillDownState]);

  // 도넛차트 데이터 계산
  const doughnutData = useMemo(() => {
    if (drillDownState.type === 'overview') {
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
    }

    if (drillDownState.type === 'all') {
      // 전체 카테고리 구성 (정오답 모두 포함)
      const categoryMap = aggregateData(
        filteredRows,
        null, // filter 없음 (정오답 모두)
        (row) => row.depth1 || labels.unclassified,
        labels.unclassified
      );

      if (categoryMap.size === 0) return null;

      const sorted = sortAndLimit(categoryMap, maxCategories);
      const categoryLabels = sorted.map(([name]) => name);
      const categoryData = sorted.map(([, count]) => count);
      const total = categoryData.reduce((sum, val) => sum + val, 0);

      return {
        labels: categoryLabels,
        datasets: [{
          data: categoryData,
          backgroundColor: createColorArray(categoryLabels.length, CATEGORY_COLORS),
          hoverBackgroundColor: createHoverColors(createColorArray(categoryLabels.length, CATEGORY_COLORS)),
          borderWidth: 0,
        }],
        total,
      };
    }

    if (drillDownState.type === 'filtered') {
      const categoryMap = aggregateData(
        filteredRows,
        drillDownState.filter,
        (row) => row.depth1 || labels.unclassified,
        labels.unclassified
      );

      if (categoryMap.size === 0) return null;

      const sorted = sortAndLimit(categoryMap, maxCategories);
      const categoryLabels = sorted.map(([name]) => name);
      const categoryData = sorted.map(([, count]) => count);
      const total = categoryData.reduce((sum, val) => sum + val, 0);

      return {
        labels: categoryLabels,
        datasets: [{
          data: categoryData,
          backgroundColor: createColorArray(categoryLabels.length, CATEGORY_COLORS),
          hoverBackgroundColor: createHoverColors(createColorArray(categoryLabels.length, CATEGORY_COLORS)),
          borderWidth: 0,
        }],
        total,
      };
    }

    if (drillDownState.type === 'category') {
      // filter가 없으면 정오답 모두 표시
      const filter = drillDownState.filter || null;
      const depthMap = aggregateData(
        filteredRows.filter(row => row.depth1 === drillDownState.category),
        filter,
        (row) => row.depth2 || labels.unclassified,
        labels.unclassified
      );

      if (depthMap.size === 0) return null;

      const sorted = sortAndLimit(depthMap, maxCategories);
      const depthLabels = sorted.map(([name]) => name);
      const depthData = sorted.map(([, count]) => count);
      const total = depthData.reduce((sum, val) => sum + val, 0);

      return {
        labels: depthLabels,
        datasets: [{
          data: depthData,
          backgroundColor: createColorArray(depthLabels.length, CATEGORY_COLORS),
          hoverBackgroundColor: createHoverColors(createColorArray(depthLabels.length, CATEGORY_COLORS)),
          borderWidth: 0,
        }],
        total,
      };
    }

    // depth 뷰
    let filteredDepthRows = filteredRows.filter(row => row.depth1 === drillDownState.category);
    
    if (drillDownState.depth2Value) {
      filteredDepthRows = filteredDepthRows.filter(row => row.depth2 === drillDownState.depth2Value);
    }
    if (drillDownState.depth3Value) {
      filteredDepthRows = filteredDepthRows.filter(row => row.depth3 === drillDownState.depth3Value);
    }

    // depth 2일 때는 depth3, depth 3일 때는 depth4, depth 4일 때는 더 이상 없음
    const depthKey = drillDownState.depth === 2 ? 'depth3' : 'depth4';
    
    // 최종 depth일 때는 정오답 모두 표시 (overview처럼)
    if (isFinalDepth(drillDownState)) {
      // depth 4일 때는 각 카테고리별로 정오답을 모두 집계
      const categoryMap = new Map<string, { correct: number; incorrect: number }>();
      
      filteredDepthRows.forEach(row => {
        const key = (row[depthKey as keyof TypeStatsRow] as string) || labels.unclassified;
        if (!categoryMap.has(key)) {
          categoryMap.set(key, { correct: 0, incorrect: 0 });
        }
        const entry = categoryMap.get(key)!;
        entry.correct += row.correct_count || 0;
        entry.incorrect += row.incorrect_count || 0;
      });
      
      // depth 3 데이터가 없으면 현재 depth 2 값에 대한 정오답을 모두 표시
      if (categoryMap.size === 0 && drillDownState.depth === 2 && drillDownState.depth2Value) {
        const correctTotal = filteredDepthRows.reduce((sum, row) => sum + (row.correct_count || 0), 0);
        const incorrectTotal = filteredDepthRows.reduce((sum, row) => sum + (row.incorrect_count || 0), 0);
        const total = correctTotal + incorrectTotal;
        
        if (total === 0) return null;
        
        return {
          labels: [drillDownState.depth2Value],
          datasets: [{
            data: [total],
            backgroundColor: [CATEGORY_COLORS[0]],
            hoverBackgroundColor: [createHoverColors([CATEGORY_COLORS[0]])[0]],
            borderWidth: 0,
          }],
          total,
          // 정오답 정보 저장 (중앙 표시용)
          correctIncorrectData: [{ name: drillDownState.depth2Value, correct: correctTotal, incorrect: incorrectTotal }],
        };
      }
      
      if (categoryMap.size === 0) return null;
      
      // 정오답 합계로 정렬
      const sorted = Array.from(categoryMap.entries())
        .sort((a, b) => {
          const aTotal = a[1].correct + a[1].incorrect;
          const bTotal = b[1].correct + b[1].incorrect;
          return bTotal - aTotal;
        })
        .slice(0, maxCategories);
      
      const categoryLabels = sorted.map(([name]) => name);
      // 각 카테고리별로 정오답 합계 계산
      const categoryData = sorted.map(([, counts]) => counts.correct + counts.incorrect);
      const total = categoryData.reduce((sum, val) => sum + val, 0);
      
      return {
        labels: categoryLabels,
        datasets: [{
          data: categoryData,
          backgroundColor: createColorArray(categoryLabels.length, CATEGORY_COLORS),
          hoverBackgroundColor: createHoverColors(createColorArray(categoryLabels.length, CATEGORY_COLORS)),
          borderWidth: 0,
        }],
        total,
        // 정오답 정보 저장 (중앙 표시용)
        correctIncorrectData: sorted.map(([name, counts]) => ({ name, correct: counts.correct, incorrect: counts.incorrect })),
      };
    }
    
    // depth 2, 3일 때는 기존 로직 사용
    const filter = drillDownState.filter;
    const depthMap = aggregateData(
      filteredDepthRows,
      filter,
      (row) => (row[depthKey as keyof TypeStatsRow] as string) || labels.unclassified,
      labels.unclassified
    );

    if (depthMap.size === 0) return null;

    const sorted = sortAndLimit(depthMap, maxCategories);
    const depthLabels = sorted.map(([name]) => name);
    const depthData = sorted.map(([, count]) => count);
    const total = depthData.reduce((sum, val) => sum + val, 0);

    return {
      labels: depthLabels,
      datasets: [{
        data: depthData,
        backgroundColor: createColorArray(depthLabels.length, CATEGORY_COLORS),
        hoverBackgroundColor: createHoverColors(createColorArray(depthLabels.length, CATEGORY_COLORS)),
        borderWidth: 0,
      }],
      total,
    };
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
    }
    
    // 'all' 타입이나 최종 depth일 때는 정오답 정보 표시하지 않음 (카테고리만 표시)
    if ((drillDownState.type === 'all' || isFinalDepth(drillDownState)) && doughnutData && 'total' in doughnutData) {
      return {
        label: getCurrentCategoryLabel(drillDownState, labels),
        value: doughnutData.total,
        subValues: undefined,
      };
    }
    
    if (doughnutData && 'total' in doughnutData) {
      return {
        label: getCurrentCategoryLabel(drillDownState, labels),
        value: doughnutData.total,
        subValues: undefined,
      };
    }
    
    return null;
  }, [drillDownState, totals, labels, doughnutData]);

  // 막대그래프 데이터 계산
  const { barData, barOptions } = useMemo(() => {
    type AggregationValue = { correct: number; incorrect: number; total: number };
    let aggregation: Map<string, AggregationValue>;

    if (drillDownState.type === 'overview' || drillDownState.type === 'all') {
      aggregation = new Map<string, AggregationValue>();
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
    } else if (drillDownState.type === 'category') {
      aggregation = new Map<string, AggregationValue>();
      filteredRows
        .filter(row => row.depth1 === drillDownState.category)
        .forEach(row => {
          const key = row.depth2 || labels.unclassified;
          if (!aggregation.has(key)) {
            aggregation.set(key, { correct: 0, incorrect: 0, total: 0 });
          }
          const entry = aggregation.get(key)!;
          entry.correct += row.correct_count || 0;
          entry.incorrect += row.incorrect_count || 0;
          entry.total += row.total_count || 0;
        });
    } else if (drillDownState.type === 'depth') {
      aggregation = new Map<string, AggregationValue>();
      let filteredDepthRows = filteredRows.filter(row => row.depth1 === drillDownState.category);
      
      if (drillDownState.depth2Value) {
        filteredDepthRows = filteredDepthRows.filter(row => row.depth2 === drillDownState.depth2Value);
      }
      if (drillDownState.depth3Value) {
        filteredDepthRows = filteredDepthRows.filter(row => row.depth3 === drillDownState.depth3Value);
      }

      const depthKey = drillDownState.depth === 2 ? 'depth3' : 'depth4';
      filteredDepthRows.forEach(row => {
        const key = (row[depthKey as keyof TypeStatsRow] as string) || labels.unclassified;
        if (!aggregation.has(key)) {
          aggregation.set(key, { correct: 0, incorrect: 0, total: 0 });
        }
        const entry = aggregation.get(key)!;
        entry.correct += row.correct_count || 0;
        entry.incorrect += row.incorrect_count || 0;
        entry.total += row.total_count || 0;
      });
    } else {
      // filtered 뷰
      aggregation = new Map<string, AggregationValue>();
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
    }

    const sorted = sortAndLimit(aggregation, maxCategories);

    if (sorted.length === 0) {
      return { barData: null, barOptions: undefined };
    }

    const labelsData = sorted.map(([name]) => name);
    const correctData = sorted.map(([, counts]) => counts.correct);
    const incorrectData = sorted.map(([, counts]) => counts.incorrect);

    const data = {
      labels: labelsData,
      datasets: [
        {
          label: labels.correct,
          data: correctData,
          backgroundColor: palette.correct,
          hoverBackgroundColor: palette.correctHover,
          borderRadius: CHART_CONFIG.bar.borderRadius,
          stack: 'counts',
        },
        {
          label: labels.incorrect,
          data: incorrectData,
          backgroundColor: palette.incorrect,
          hoverBackgroundColor: palette.incorrectHover,
          borderRadius: CHART_CONFIG.bar.borderRadius,
          stack: 'counts',
        },
      ],
    };

    return {
      barData: data,
      barOptions: createBarChartOptions(palette, labels, handleBarClick, data),
    };
  }, [drillDownState, rows, labels, palette, maxCategories, filteredRows, handleBarClick]);

  // 차트 제목 계산
  const doughnutTitle = useMemo(() => {
    if (drillDownState.type === 'overview') {
      return labels.correctVsIncorrect;
    }
    if (drillDownState.type === 'filtered') {
      return `${drillDownState.filter === 'correct' ? labels.correct : labels.incorrect} 카테고리 구성`;
    }
    return getCurrentCategoryLabel(drillDownState, labels);
  }, [drillDownState, labels]);

  const barTitle = useMemo(() => {
    if (drillDownState.type === 'overview') {
      return labels.categoryDistribution;
    }
    if (drillDownState.type === 'filtered') {
      return `${drillDownState.filter === 'correct' ? labels.correct : labels.incorrect} 유형별 분포`;
    }
    return getCurrentCategoryLabel(drillDownState, labels);
  }, [drillDownState, labels]);

  // 네비게이션 경로 텍스트
  const navigationPath = useMemo(() => {
    if (drillDownState.type === 'filtered') {
      return `${drillDownState.filter === 'correct' ? labels.correct : labels.incorrect} 필터`;
    }
    if (drillDownState.type === 'category') {
      return drillDownState.category;
    }
    if (drillDownState.type === 'depth') {
      const parts = [drillDownState.category];
      if (drillDownState.depth2Value) parts.push(drillDownState.depth2Value);
      if (drillDownState.depth3Value) parts.push(drillDownState.depth3Value);
      return parts.join(' > ');
    }
    return '';
  }, [drillDownState, labels]);

  const doughnutKey = useMemo(() => generateChartKey('doughnut', drillDownState), [drillDownState]);
  const barKey = useMemo(() => generateChartKey('bar', drillDownState), [drillDownState]);

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
          <span className="text-slate-500 dark:text-slate-400">{navigationPath}</span>
        </div>
      )}

      <div className="grid gap-6 md:grid-cols-2">
        {/* 도넛차트 */}
        <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/40 p-4 shadow-sm transition-all duration-300">
          <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-200 mb-4">
            {doughnutTitle}
          </h3>
          {doughnutData ? (
            <div className="relative h-64 flex items-center justify-center">
              <Doughnut
                key={doughnutKey}
                ref={setDoughnutChartRef}
                data={doughnutData}
                onClick={(event: any) => {
                  if (doughnutData) {
                    handleDoughnutClick(event, doughnutData);
                  }
                }}
                options={createDoughnutChartOptions(palette)}
              />
              {/* 도넛차트 구멍 중앙에 정확히 위치 */}
              {doughnutCenterData && (
                <div 
                  className={`absolute flex flex-col items-center justify-center z-10 ${
                    drillDownState.type === 'overview' ? 'cursor-pointer' : 'pointer-events-none'
                  }`}
                  style={{
                    left: '50%',
                    top: '50%',
                    transform: 'translate(-50%, -50%)',
                  }}
                  onClick={(e) => {
                    if (drillDownState.type === 'overview') {
                      e.stopPropagation();
                      setDrillDownState({ type: 'all' });
                    }
                  }}
                >
                  <span className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mb-1 text-center whitespace-nowrap">
                    {doughnutCenterData.label}
                  </span>
                  <span className="text-2xl sm:text-3xl font-bold text-slate-800 dark:text-slate-100 text-center">
                    {doughnutCenterData.value}
                  </span>
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-slate-500 dark:text-slate-400">{labels.noData}</p>
          )}
          {/* 정답/오답 정보 - overview 또는 최종 depth일 때 표시 */}
          {(drillDownState.type === 'overview' || isFinalDepth(drillDownState)) && doughnutCenterData && doughnutCenterData.subValues && (
            <div className="mt-2 flex flex-col sm:flex-row gap-2 sm:gap-4 text-xs sm:text-sm justify-center">
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
          {/* 카테고리별 정보 - overview가 아닌 모든 하이라키 레벨에서 표시 */}
          {drillDownState.type !== 'overview' && doughnutData && doughnutData.labels && doughnutData.labels.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2 sm:gap-4 text-xs sm:text-sm justify-center">
              {doughnutData.labels.map((label: string, index: number) => {
                const count = doughnutData.datasets[0].data[index];
                const color = doughnutData.datasets[0].backgroundColor[index];
                
                return (
                  <div key={index} className="flex items-center justify-center gap-1">
                    <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
                    <span className="text-slate-600 dark:text-slate-400 whitespace-nowrap">
                      {label}: {count}
                    </span>
                  </div>
                );
              })}
            </div>
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
              <Bar 
                key={barKey}
                ref={setBarChartRef} 
                data={barData} 
                options={barOptions} 
              />
            </div>
          ) : (
            <p className="text-sm text-slate-500 dark:text-slate-400">{labels.noData}</p>
          )}
          {/* 클릭 안내 */}
          {(drillDownState.type === 'overview' || drillDownState.type === 'filtered' || drillDownState.type === 'category' || (drillDownState.type === 'depth' && drillDownState.depth < 4)) && (
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-2 text-center">
              💡 막대를 클릭하여 더 자세한 정보를 확인하세요
            </p>
          )}
        </div>
      </div>
    </div>
  );
};
