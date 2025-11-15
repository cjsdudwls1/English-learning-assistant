import React, { useCallback, useEffect, useMemo, useState } from 'react';
import DatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';
import { fetchStatsByType, TypeStatsRow, fetchHierarchicalStats, StatsNode } from '../services/stats';
import { HierarchicalStatsTable } from '../components/HierarchicalStatsTable';
import { supabase } from '../services/supabaseClient';
import { fetchAnalyzingSessions, fetchPendingLabelingSessions } from '../services/db';
import { AnalyzingCard } from '../components/AnalyzingCard';
import { QuickLabelingCard } from '../components/QuickLabelingCard';
import { GeneratedProblemCard } from '../components/GeneratedProblemCard';
import type { GeneratedProblemResult } from '../components/GeneratedProblemCard';
import type { SessionWithProblems } from '../types';
import { useLanguage } from '../contexts/LanguageContext';
import { useTheme } from '../contexts/ThemeContext';
import { getTranslation } from '../utils/translations';
import { TaxonomyDetailPopup } from '../components/TaxonomyDetailPopup';
import { findTaxonomyByDepth } from '../services/db';
import { StatsOverviewCharts } from '../components/StatsOverviewCharts';

export const StatsPage: React.FC = () => {
  const { language } = useLanguage();
  const { theme } = useTheme();
  const t = getTranslation(language);
  const [rows, setRows] = useState<TypeStatsRow[]>([]);
  const [hierarchicalData, setHierarchicalData] = useState<StatsNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [startDate, setStartDate] = useState<Date | null>(null);
  const [endDate, setEndDate] = useState<Date | null>(null);
  const [selectedNodes, setSelectedNodes] = useState<Set<string>>(new Set());
  const [generatedProblems, setGeneratedProblems] = useState<any[]>([]);
  const [isGeneratingProblems, setIsGeneratingProblems] = useState(false);
  const [analyzingSessions, setAnalyzingSessions] = useState<SessionWithProblems[]>([]);
  const [pendingLabelingSessions, setPendingLabelingSessions] = useState<SessionWithProblems[]>([]);
  const [pollingActive, setPollingActive] = useState(true);
  const [isReclassifying, setIsReclassifying] = useState(false);
  const [reclassificationStatus, setReclassificationStatus] = useState<string | null>(null);
  const [selectedTaxonomyCode, setSelectedTaxonomyCode] = useState<string | null>(null);
  const [isGeneratingExamples, setIsGeneratingExamples] = useState(false);
  const [exampleSentences, setExampleSentences] = useState<string[]>([]);
  const [showExampleModal, setShowExampleModal] = useState(false);
  const [currentProblemIndex, setCurrentProblemIndex] = useState(0);
  const [quizResults, setQuizResults] = useState<(GeneratedProblemResult | null)[]>([]);
  const [showResultSummary, setShowResultSummary] = useState(false);

  const loadData = async (showLoading: boolean = false) => {
    try {
      if (showLoading) {
        setLoading(true);
      }
      const [statsData, hierarchicalStatsData, analyzing, pendingSessions] = await Promise.all([
        fetchStatsByType(startDate || undefined, endDate || undefined, language),
        fetchHierarchicalStats(startDate || undefined, endDate || undefined, language),
        fetchAnalyzingSessions(),
        fetchPendingLabelingSessions(),
      ]);
      setRows(statsData);
      setHierarchicalData(hierarchicalStatsData);
      
      // AnalyzingCard에 표시된 세션 ID 수집
      const analyzingIds = new Set(analyzing.map(s => s.id));
      
      // AnalyzingCard에 표시되지 않은 세션만 QuickLabelingCard에 표시
      const filteredPendingSessions = pendingSessions.filter(s => !analyzingIds.has(s.id));
      
      setAnalyzingSessions(analyzing);
      setPendingLabelingSessions(filteredPendingSessions);
      
      // 분석 중이거나 라벨링이 필요하면 폴링 계속, 없으면 폴링 중단
      setPollingActive(analyzing.length > 0 || pendingSessions.length > 0);
    } catch (e) {
      setError(e instanceof Error ? e.message : '통계 조회 실패');
    } finally {
      if (showLoading) {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    loadData(true); // 초기 로드 시에만 loading 표시
  }, [startDate, endDate, language]);

  // 폴링 로직: 분석 중이거나 라벨링이 필요한 세션이 있으면 3초마다 상태 확인 (loading 표시 없음)
  useEffect(() => {
    if (!pollingActive) return;
    
    const interval = setInterval(() => {
      loadData(false); // 폴링 시에는 loading 표시 안 함
    }, 3000);
    
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pollingActive]);

  const handleLabelingComplete = async () => {
    // 라벨링 완료 후 데이터 다시 로드
    await loadData();
  };

  const handleSetDateRange = (months: number) => {
    const end = new Date();
    const start = new Date();
    start.setMonth(start.getMonth() - months);
    setStartDate(start);
    setEndDate(end);
  };

  const handleClearFilter = () => {
    setStartDate(null);
    setEndDate(null);
  };

  // 노드 키 생성 함수
  const getNodeKey = (node: StatsNode): string => {
    return `${node.depth1 || ''}_${node.depth2 || ''}_${node.depth3 || ''}_${node.depth4 || ''}`;
  };

  // 노드 선택 핸들러
  const handleNodeSelect = (node: StatsNode, selected: boolean) => {
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
  };

  // 최하위 depth 노드만 필터링하는 함수
  const getLeafNodes = (nodes: StatsNode[]): StatsNode[] => {
    const leafNodes: StatsNode[] = [];
    const traverse = (ns: StatsNode[]) => {
      for (const node of ns) {
        if (!node.children || node.children.length === 0) {
          // 최하위 노드
          leafNodes.push(node);
        } else {
          traverse(node.children);
        }
      }
    };
    traverse(nodes);
    return leafNodes;
  };

  // 전체 문제 재분류 핸들러
  const handleReclassifyAll = async () => {
    if (!confirm('전체 문제를 새로운 분류 체계로 재분류하시겠습니까?\n이 작업은 시간이 걸릴 수 있으며, 백그라운드에서 진행됩니다.')) {
      return;
    }

    try {
      setIsReclassifying(true);
      setReclassificationStatus('재분류 작업을 시작합니다...');
      setError(null);

      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) {
        setError('로그인이 필요합니다.');
        return;
      }

      const functionUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/reclassify-problems`;
      const { data: { session } } = await supabase.auth.getSession();
      
      const response = await fetch(functionUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({
          userId: userData.user.id,
          batchSize: 100, // 배치 크기
          language: language
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP error! status: ${response.status}, ${errorText}`);
      }

      const result = await response.json();
      
      if (result.success) {
        setReclassificationStatus(
          `재분류 작업이 시작되었습니다. 처리된 문제: ${result.processed || 0}개 / 전체: ${result.total || 0}개. ` +
          `성공: ${result.successCount || 0}개, 실패: ${result.failCount || 0}개. ` +
          `새로고침하여 최신 통계를 확인하세요.`
        );
        
        // 3초 후 자동 새로고침
        setTimeout(() => {
          loadData(true);
          setReclassificationStatus(null);
        }, 3000);
      } else {
        throw new Error(result.error || '재분류 작업에 실패했습니다.');
      }
    } catch (error) {
      console.error('Error reclassifying problems:', error);
      setError(error instanceof Error ? error.message : '재분류 중 오류가 발생했습니다.');
      setReclassificationStatus(null);
    } finally {
      setIsReclassifying(false);
    }
  };

  // 예시 문장 생성 핸들러
  const handleGenerateExampleSentences = async () => {
    if (selectedNodes.size === 0) {
      alert(t.example.selectCategory);
      return;
    }

    try {
      setIsGeneratingExamples(true);
      setError(null);

      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) {
        setError(language === 'ko' ? '로그인이 필요합니다.' : 'Login required.');
        return;
      }

      // 선택된 노드들 중 최하위 depth만 필터링
      const allLeafNodes = getLeafNodes(hierarchicalData);
      const selectedLeafNodes = allLeafNodes.filter(node => {
        const key = getNodeKey(node);
        return selectedNodes.has(key);
      });

      if (selectedLeafNodes.length === 0) {
        alert(t.example.selectCategory);
        setIsGeneratingExamples(false);
        return;
      }

      // 각 선택된 depth에 대해 예시 문장 생성
      const examplePromises = selectedLeafNodes.map(async (node) => {
        try {
          const taxonomy = await findTaxonomyByDepth(
            node.depth1 || '',
            node.depth2 || '',
            node.depth3 || '',
            node.depth4 || '',
            language
          );

          if (!taxonomy?.code) {
            return null;
          }

          const functionUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-example`;
          const { data: { session } } = await supabase.auth.getSession();
          
          const response = await fetch(functionUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${session?.access_token}`,
            },
            body: JSON.stringify({
              code: taxonomy.code,
              userId: userData.user.id,
              language: language
            })
          });

          if (!response.ok) {
            const errorText = await response.text();
            let errorData;
            try {
              errorData = JSON.parse(errorText);
            } catch {
              errorData = { error: errorText };
            }
            throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
          }

          const result = await response.json();
          
          if (!result.success) {
            console.error('Error from generate-example:', result.error || result.details);
            throw new Error(result.error || result.details || 'Failed to generate example');
          }
          
          if (result.success && result.example) {
            const example = result.example;
            // 필수 필드 확인
            if (!example.wrong_example && !example.correct_example) {
              console.warn('Example missing required fields:', example);
              return null;
            }
            return `❌ ${example.wrong_example || ''}\n✅ ${example.correct_example || ''}\n\n${example.explanation || ''}`;
          }
          
          return null;
        } catch (error) {
          console.error('Error generating example for node:', error);
          return null;
        }
      });

      const examples = (await Promise.all(examplePromises)).filter(Boolean) as string[];
      
      if (examples.length === 0) {
        setError(language === 'ko' 
          ? '예시 문장을 생성할 수 없습니다. 선택한 카테고리에 대한 taxonomy 정보가 없거나 AI 응답에 문제가 있을 수 있습니다.'
          : 'Unable to generate example sentences. The selected category may not have taxonomy information or there may be an issue with the AI response.');
        setIsGeneratingExamples(false);
        return;
      }
      
      setExampleSentences(examples);
      setShowExampleModal(true);
    } catch (e) {
      console.error('Error generating examples:', e);
      setError(e instanceof Error ? e.message : (language === 'ko' ? '예시 문장 생성 실패' : 'Failed to generate example sentences'));
    } finally {
      setIsGeneratingExamples(false);
    }
  };

  // 유사 문제 생성 핸들러
  const handleGenerateSimilarProblems = async () => {
    if (selectedNodes.size === 0) {
      alert(t.stats.selectCategory);
      return;
    }

    try {
      setIsGeneratingProblems(true);
      setError(null);

      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) {
        setError('로그인이 필요합니다.');
        return;
      }

      // 선택된 노드들 중 최하위 depth만 필터링
      const allLeafNodes = getLeafNodes(hierarchicalData);
      const selectedLeafNodes = allLeafNodes.filter(node => {
        const key = getNodeKey(node);
        return selectedNodes.has(key);
      });

      if (selectedLeafNodes.length === 0) {
        alert(t.stats.selectLeafCategory);
        setIsGeneratingProblems(false);
        return;
      }

      // 각 최하위 depth당 1문제씩 생성
      const classifications = selectedLeafNodes.map(node => ({
        depth1: node.depth1,
        depth2: node.depth2 || '',
        depth3: node.depth3 || '',
        depth4: node.depth4 || '',
        problemCount: 1 // 최하위 depth당 1문제
      }));

      const functionUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-similar-problems`;
      
      const response = await fetch(functionUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`,
        },
        body: JSON.stringify({
          classifications,
          userId: userData.user.id,
          language: language
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP error! status: ${response.status}, ${errorText}`);
      }

      const result = await response.json();
      
      if (result.success) {
        setGeneratedProblems(result.problems || []);
        setCurrentProblemIndex(0); // 첫 번째 문제부터 시작
        setQuizResults(new Array(result.problems?.length || 0).fill(null));
        setShowResultSummary(false);
      } else {
        throw new Error(result.error || (language === 'ko' ? '유사 문제 생성 실패' : 'Failed to generate similar problems'));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '유사 문제 생성 실패');
    } finally {
      setIsGeneratingProblems(false);
    }
  };

  // 숫자 클릭 핸들러 제거 (더 이상 문제 리스트 표시하지 않음)
  const handleNodeClick = () => {
    // 숫자 클릭 시 아무 동작도 하지 않음 (유사 문제 생성은 체크박스 선택 후 버튼 클릭)
  };

  const handleProblemResult = useCallback((problemIndex: number, result: GeneratedProblemResult) => {
    setQuizResults(prev => {
      const next = [...prev];
      next[problemIndex] = result;
      return next;
    });
  }, []);

  const handleNextProblem = useCallback(() => {
    if (currentProblemIndex < generatedProblems.length - 1) {
      setCurrentProblemIndex(prev => prev + 1);
    } else {
      setShowResultSummary(true);
    }
  }, [currentProblemIndex, generatedProblems.length]);

  const handleCloseGeneratedProblems = useCallback(() => {
    setGeneratedProblems([]);
    setQuizResults([]);
    setCurrentProblemIndex(0);
    setShowResultSummary(false);
  }, []);

  const summaryStats = useMemo(() => {
    if (!showResultSummary || generatedProblems.length === 0) {
      return null;
    }

    const validResults = quizResults.filter((result): result is GeneratedProblemResult => Boolean(result));
    const correctCount = validResults.filter(result => result.isCorrect).length;
    const totalCount = generatedProblems.length;
    const totalTime = validResults.reduce((sum, result) => sum + (result?.timeSpentSeconds || 0), 0);

    return {
      correctCount,
      incorrectCount: totalCount - correctCount,
      totalCount,
      totalTime,
    };
  }, [generatedProblems.length, quizResults, showResultSummary]);

  const formatSeconds = useCallback((seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }, []);

  const totals = useMemo(() => {
    const correct = rows.reduce((s, r) => s + (r.correct_count || 0), 0);
    const incorrect = rows.reduce((s, r) => s + (r.incorrect_count || 0), 0);
    const total = rows.reduce((s, r) => s + (r.total_count || 0), 0);
    return { correct, incorrect, total };
  }, [rows]);

  const chartLabels = useMemo(
    () => ({
      overview: t.stats.chartOverview,
      correctVsIncorrect: t.stats.correctVsIncorrectChart,
      categoryDistribution: t.stats.categoryDistributionChart,
      noData: t.stats.noData,
      correct: t.stats.correct,
      incorrect: t.stats.incorrect,
      total: t.stats.total,
      unclassified: t.stats.unclassified,
    }),
    [
      t.stats.chartOverview,
      t.stats.correctVsIncorrectChart,
      t.stats.categoryDistributionChart,
      t.stats.noData,
      t.stats.correct,
      t.stats.incorrect,
      t.stats.total,
      t.stats.unclassified,
    ]
  );

  if (loading) return <div className="text-center text-slate-600 dark:text-slate-400 py-10">{t.common.loading}</div>;
  if (error) return <div className="text-center text-red-700 dark:text-red-400 py-10">{error}</div>;

  return (
    <div className="mx-auto space-y-6 max-w-full px-2 sm:px-4 md:px-6 lg:max-w-5xl">
      {/* 분석 중 UI - 최상단 */}
      {analyzingSessions.map((session) => (
        <AnalyzingCard
          key={session.id}
          sessionId={session.id}
          imageUrl={session.image_url}
        />
      ))}

      {/* 라벨링 UI - 분석 중 다음 */}
      {pendingLabelingSessions.map((session) => (
        <QuickLabelingCard
          key={session.id}
          sessionId={session.id}
          imageUrl={session.image_url}
          onSave={handleLabelingComplete}
        />
      ))}

      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-lg p-6 md:p-8 border border-slate-200 dark:border-slate-700">
        <h2 className="text-2xl font-bold mb-4 text-slate-800 dark:text-slate-200">{t.stats.statsByType}</h2>
        
        {/* 기간 설정 UI */}
        <div className="mb-6 p-3 sm:p-4 bg-slate-50 dark:bg-slate-900/50 rounded-lg">
          <div className="flex flex-wrap gap-2 items-center mb-3">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">{t.stats.periodSetting}</span>
            <button
              onClick={() => handleSetDateRange(1)}
              className="px-3 py-1 text-sm bg-blue-100 text-blue-700 rounded hover:bg-blue-200"
            >
              {t.stats.oneMonth}
            </button>
            <button
              onClick={() => handleSetDateRange(3)}
              className="px-3 py-1 text-sm bg-blue-100 text-blue-700 rounded hover:bg-blue-200"
            >
              {t.stats.threeMonths}
            </button>
            <button
              onClick={() => handleSetDateRange(6)}
              className="px-3 py-1 text-sm bg-blue-100 text-blue-700 rounded hover:bg-blue-200"
            >
              {t.stats.sixMonths}
            </button>
            <button
              onClick={() => {
                const now = new Date();
                const start = new Date(now.getFullYear(), 0, 1);
                setStartDate(start);
                setEndDate(now);
              }}
              className="px-3 py-1 text-sm bg-blue-100 text-blue-700 rounded hover:bg-blue-200"
            >
              {t.stats.thisYear}
            </button>
            {(startDate || endDate) && (
              <button
                onClick={handleClearFilter}
                className="px-3 py-1 text-sm bg-gray-200 text-gray-700 rounded hover:bg-gray-300"
              >
                {t.stats.total}
              </button>
            )}
          </div>
          <div className="flex gap-3 items-center">
            <div>
              <label className="text-sm text-slate-600 mr-2">{t.stats.startDate}</label>
              <DatePicker
                selected={startDate}
                onChange={(date: Date | null) => setStartDate(date)}
                dateFormat="yyyy-MM-dd"
                className="px-3 py-1 border rounded"
                maxDate={endDate || new Date()}
              />
            </div>
            <div>
              <label className="text-sm text-slate-600 mr-2">{t.stats.endDate}</label>
              <DatePicker
                selected={endDate}
                onChange={(date: Date | null) => setEndDate(date)}
                dateFormat="yyyy-MM-dd"
                className="px-3 py-1 border rounded"
                minDate={startDate}
                maxDate={new Date()}
              />
            </div>
          </div>
        </div>

        <div className="mb-4 flex items-center justify-between flex-wrap gap-3">
          <div className="text-slate-700 dark:text-slate-300">{t.stats.total}: {totals.total} / {t.stats.correct}: {totals.correct} / {t.stats.incorrect}: {totals.incorrect}</div>
          <div className="flex gap-2">
            <button
              onClick={handleReclassifyAll}
              disabled={isReclassifying}
              className="px-4 py-2 bg-orange-600 dark:bg-orange-500 text-white rounded-lg hover:bg-orange-700 dark:hover:bg-orange-600 disabled:bg-gray-400 dark:disabled:bg-gray-600 disabled:cursor-not-allowed transition-colors"
              title={language === 'ko' ? '기존 문제들을 새로운 분류 체계로 재분류합니다' : 'Reclassify all problems with the new classification system'}
            >
              {isReclassifying ? t.stats.reclassifying : t.stats.reclassifyAll}
            </button>
            <button
              onClick={handleGenerateExampleSentences}
              disabled={selectedNodes.size === 0 || isGeneratingExamples}
              className="px-4 py-2 bg-green-600 dark:bg-green-500 text-white rounded-lg hover:bg-green-700 dark:hover:bg-green-600 disabled:bg-gray-400 dark:disabled:bg-gray-600 disabled:cursor-not-allowed transition-colors"
            >
              {isGeneratingExamples ? t.example.generating : t.example.generate}
            </button>
            <button
              onClick={handleGenerateSimilarProblems}
              disabled={selectedNodes.size === 0 || isGeneratingProblems}
              className="px-4 py-2 bg-indigo-600 dark:bg-indigo-500 text-white rounded-lg hover:bg-indigo-700 dark:hover:bg-indigo-600 disabled:bg-gray-400 dark:disabled:bg-gray-600 disabled:cursor-not-allowed transition-colors"
            >
              {isGeneratingProblems ? t.stats.generating : t.stats.generateSimilar}
            </button>
          </div>
        </div>

        <div className="mt-6">
          <h3 className="text-xl font-semibold text-slate-800 dark:text-slate-200 mb-4">
            {chartLabels.overview}
          </h3>
          <StatsOverviewCharts
            rows={rows}
            totals={totals}
            theme={theme}
            labels={chartLabels}
          />
        </div>
        
        {reclassificationStatus && (
          <div className="mb-4 p-3 bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800 rounded-lg">
            <p className="text-sm text-blue-800 dark:text-blue-200">{reclassificationStatus}</p>
          </div>
        )}
        
        <HierarchicalStatsTable 
          data={hierarchicalData} 
          onImageClick={() => {}}
          onNumberClick={handleNodeClick}
          selectedNodes={selectedNodes}
          onNodeSelect={handleNodeSelect}
          onQuestionClick={async (node) => {
            if (node.depth4) {
              try {
                const taxonomy = await findTaxonomyByDepth(
                  node.depth1 || '',
                  node.depth2 || '',
                  node.depth3 || '',
                  node.depth4 || '',
                  language
                );
                if (taxonomy?.code) {
                  setSelectedTaxonomyCode(taxonomy.code);
                } else {
                  alert(language === 'ko' ? '분류 정보를 찾을 수 없습니다.' : 'Classification information not found.');
                }
              } catch (error) {
                console.error('Error loading taxonomy:', error);
                alert(language === 'ko' ? '분류 정보를 불러오는 중 오류가 발생했습니다.' : 'Error loading classification information.');
              }
            }
          }}
        />
        
        {/* Taxonomy 정보 모달 */}
        {selectedTaxonomyCode && (
          <TaxonomyDetailPopup
            code={selectedTaxonomyCode}
            onClose={() => setSelectedTaxonomyCode(null)}
          />
        )}
        
        {/* 예시 문장 모달 */}
        {showExampleModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white dark:bg-slate-800 rounded-lg shadow-xl max-w-2xl w-full max-h-[80vh] overflow-y-auto">
              <div className="p-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-xl font-bold text-slate-800 dark:text-slate-200">
                    {t.example.generate}
                  </h3>
                  <button
                    onClick={() => {
                      setShowExampleModal(false);
                      setExampleSentences([]);
                    }}
                    className="text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                  >
                    {t.common.close}
                  </button>
                </div>
                <div className="space-y-4">
                  {exampleSentences.length > 0 ? (
                    exampleSentences.map((example, idx) => (
                      <div key={idx} className="p-4 bg-slate-50 dark:bg-slate-900/50 rounded-lg">
                        <p className="text-slate-700 dark:text-slate-300 whitespace-pre-wrap">{example}</p>
                      </div>
                    ))
                  ) : (
                    <p className="text-slate-500 dark:text-slate-400">
                      {language === 'ko' ? '생성된 예시 문장이 없습니다.' : 'No example sentences generated.'}
                    </p>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 생성된 유사 문제 표시 */}
      {generatedProblems.length > 0 && (
        <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-lg p-6 md:p-8 border border-slate-200 dark:border-slate-700">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-xl font-bold text-slate-800 dark:text-slate-200">
              {t.stats.generatedProblems} ({generatedProblems.length}{language === 'ko' ? '개' : ''})
            </h3>
            <button
              onClick={handleCloseGeneratedProblems}
              className="px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
            >
              {t.common.close}
            </button>
          </div>

          {!showResultSummary && (
            <div className="space-y-4">
              <GeneratedProblemCard
                key={currentProblemIndex}
                problem={generatedProblems[currentProblemIndex]}
                index={currentProblemIndex}
                problemId={generatedProblems[currentProblemIndex].id}
                isActive={true}
                onNext={handleNextProblem}
                onResult={(result) => handleProblemResult(currentProblemIndex, result)}
              />
              {generatedProblems.length > 1 && (
                <div className="text-center text-sm text-slate-500 dark:text-slate-400">
                  {language === 'ko' 
                    ? `문제 ${currentProblemIndex + 1} / ${generatedProblems.length}`
                    : `Problem ${currentProblemIndex + 1} / ${generatedProblems.length}`}
                </div>
              )}
            </div>
          )}

          {showResultSummary && summaryStats && (
            <div className="space-y-4">
              <div className="p-4 bg-slate-50 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-700 rounded-lg flex flex-wrap items-center justify-between gap-3">
                <h4 className="text-lg font-semibold text-slate-800 dark:text-slate-200">
                  {t.practice.summaryTitle}
                </h4>
                <div className="flex flex-wrap gap-4 text-sm text-slate-600 dark:text-slate-300">
                  <span>{t.practice.correct}: {summaryStats.correctCount}</span>
                  <span>{t.practice.incorrect}: {summaryStats.incorrectCount}</span>
                  <span>{t.practice.timeSpent}: {formatSeconds(summaryStats.totalTime)}</span>
                </div>
              </div>

              <div className="space-y-4">
                {generatedProblems.map((problem, idx) => (
                  <GeneratedProblemCard
                    key={problem.id ?? idx}
                    problem={problem}
                    index={idx}
                    problemId={problem.id}
                    mode="review"
                    result={quizResults[idx] ?? undefined}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};


