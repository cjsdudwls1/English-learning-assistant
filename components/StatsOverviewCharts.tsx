import React, { useMemo } from 'react';
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
import { Bar, Doughnut } from 'react-chartjs-2';
import type { TypeStatsRow } from '../services/stats';

ChartJS.register(ArcElement, Tooltip, Legend, BarElement, CategoryScale, LinearScale, Title);

type Theme = 'light' | 'dark';

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
  },
  dark: {
    text: 'rgba(226, 232, 240, 0.9)', // slate-200
    grid: 'rgba(148, 163, 184, 0.25)',
    correct: 'rgba(74, 222, 128, 0.7)', // green-400
    correctHover: 'rgba(74, 222, 128, 0.9)',
    incorrect: 'rgba(248, 113, 113, 0.7)',
    incorrectHover: 'rgba(248, 113, 113, 0.9)',
  },
} as const;

export const StatsOverviewCharts: React.FC<StatsOverviewChartsProps> = ({
  rows,
  totals,
  labels,
  theme,
  maxCategories = 8,
}) => {
  const palette = CHART_COLORS[theme];

  const doughnutData = useMemo(() => {
    if (totals.total === 0) {
      return null;
    }

    return {
      labels: [labels.correct, labels.incorrect],
      datasets: [
        {
          data: [totals.correct, totals.incorrect],
          backgroundColor: [palette.correct, palette.incorrect],
          hoverBackgroundColor: [palette.correctHover, palette.incorrectHover],
          borderWidth: 0,
        },
      ],
    };
  }, [totals, labels.correct, labels.incorrect, palette]);

  const { barData, barOptions } = useMemo(() => {
    const aggregation = new Map<
      string,
      { correct: number; incorrect: number; total: number }
    >();

    for (const row of rows) {
      const key = row.depth1 || labels.unclassified;
      if (!aggregation.has(key)) {
        aggregation.set(key, { correct: 0, incorrect: 0, total: 0 });
      }
      const entry = aggregation.get(key)!;
      entry.correct += row.correct_count || 0;
      entry.incorrect += row.incorrect_count || 0;
      entry.total += row.total_count || 0;
    }

    const sorted = Array.from(aggregation.entries())
      .sort((a, b) => b[1].total - a[1].total)
      .slice(0, maxCategories);

    if (sorted.length === 0) {
      return {
        barData: null,
        barOptions: undefined,
      };
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
  }, [rows, labels.correct, labels.incorrect, labels.unclassified, maxCategories, palette]);

  return (
    <div className="grid gap-6 md:grid-cols-2">
      <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/40 p-4 shadow-sm">
        <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-200 mb-4">
          {labels.correctVsIncorrect}
        </h3>
        {doughnutData ? (
          <div className="relative h-64">
            <Doughnut
              data={doughnutData}
              options={{
                plugins: {
                  legend: {
                    position: 'bottom',
                    labels: {
                      color: palette.text,
                      boxWidth: 12,
                      boxHeight: 12,
                      usePointStyle: true,
                    },
                  },
                },
              }}
            />
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
              <span className="text-sm text-slate-500 dark:text-slate-400">{labels.total}</span>
              <span className="text-2xl font-bold text-slate-800 dark:text-slate-100">
                {totals.total}
              </span>
            </div>
          </div>
        ) : (
          <p className="text-sm text-slate-500 dark:text-slate-400">{labels.noData}</p>
        )}
      </div>

      <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/40 p-4 shadow-sm">
        <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-200 mb-4">
          {labels.categoryDistribution}
        </h3>
        {barData ? (
          <div className="relative h-64">
            <Bar data={barData} options={barOptions} />
          </div>
        ) : (
          <p className="text-sm text-slate-500 dark:text-slate-400">{labels.noData}</p>
        )}
      </div>
    </div>
  );
};


