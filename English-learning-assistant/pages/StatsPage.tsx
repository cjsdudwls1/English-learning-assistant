import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { HierarchicalStatsTable } from '../components/HierarchicalStatsTable';
import { AnalyzingCard } from '../components/AnalyzingCard';
import { QuickLabelingCard } from '../components/QuickLabelingCard';
import { FailedAnalysisCard } from '../components/FailedAnalysisCard';
import { StatsOverviewCharts } from '../components/StatsOverviewCharts';
import { TaxonomyDetailPopup } from '../components/TaxonomyDetailPopup';
import { TestSheetView } from '../components/TestSheetView';
import { ProblemGeneratorUI } from '../components/ProblemGeneratorUI';
import { StatsDateFilter } from '../components/StatsDateFilter';
import { StatsActionButtons } from '../components/StatsActionButtons';
import { StatsExampleModal } from '../components/StatsExampleModal';
import { StatsGeneratedProblems } from '../components/StatsGeneratedProblems';
import { useLanguage } from '../contexts/LanguageContext';
import { useTheme } from '../contexts/ThemeContext';
import { getTranslation } from '../utils/translations';
import { deleteSession, findTaxonomyByDepth, fetchProblemsMetadataByCorrectness, type ProblemMetadataItem } from '../services/db';
import { ProblemMetadataModal } from '../components/ProblemMetadataModal';
import type { StatsNode } from '../services/stats';
import { supabase } from '../services/supabaseClient';
import { useStatsData } from '../hooks/useStatsData';
import { useStatsFilters } from '../hooks/useStatsFilters';
import { useStatsNodes } from '../hooks/useStatsNodes';
import { useProblemGenerationState } from '../hooks/useProblemGenerationState';
import { useExampleGeneration } from '../hooks/useExampleGeneration';
import { useReclassification } from '../hooks/useReclassification';
import type { GeneratedProblemResult } from '../components/GeneratedProblemCard';

type ProblemType = 'multiple_choice' | 'short_answer' | 'essay' | 'ox';

export const StatsPage: React.FC = () => {
  const { language } = useLanguage();
  const { theme } = useTheme();
  const t = getTranslation(language);

  // 필터링
  const filters = useStatsFilters();

  // 통계 데이터
  const statsData = useStatsData({
    startDate: filters.startDate,
    endDate: filters.endDate,
    language,
  });

  // 노드 선택 및 분류
  const nodes = useStatsNodes(statsData.hierarchicalData);

  // 사용자 ID 가져오기
  const [userId, setUserId] = useState<string>('');
  useEffect(() => {
    supabase.auth.getUser().then(({ data: userData }) => {
      if (userData.user) {
        setUserId(userData.user.id);
      }
    });
  }, []);

  // 문제 생성 상태
  const problemGen = useProblemGenerationState({
    userId,
    language,
    classifications: nodes.classifications,
    onError: statsData.setError,
  });

  // 예시 생성
  const exampleGen = useExampleGeneration({
    language,
    hierarchicalData: statsData.hierarchicalData,
    selectedNodes: nodes.selectedNodes,
    getLeafNodes: nodes.getLeafNodes,
    getNodeKey: nodes.getNodeKey,
    setError: statsData.setError,
  });

  // 재분류
  const reclassify = useReclassification({
    language,
    loadData: statsData.loadData,
    setError: statsData.setError,
  });

  // 문제 풀이 관련 상태
  const [currentProblemIndex, setCurrentProblemIndex] = useState(0);
  const [quizResults, setQuizResults] = useState<(GeneratedProblemResult | null)[]>([]);
  const [showResultSummary, setShowResultSummary] = useState(false);
  const [selectedTaxonomyCode, setSelectedTaxonomyCode] = useState<string | null>(null);
  const [problemMetadataItems, setProblemMetadataItems] = useState<ProblemMetadataItem[]>([]);
  const [showMetadataModal, setShowMetadataModal] = useState(false);
  const [metadataIsCorrect, setMetadataIsCorrect] = useState(false);
  const [isLoadingMetadata, setIsLoadingMetadata] = useState(false);

  const handleProblemResult = useCallback((problemIndex: number, result: GeneratedProblemResult) => {
    setQuizResults(prev => {
      const next = [...prev];
      next[problemIndex] = result;
      return next;
    });
  }, []);

  const handleNextProblem = useCallback(() => {
    if (currentProblemIndex < problemGen.generatedProblems.length - 1) {
      setCurrentProblemIndex(prev => prev + 1);
    } else {
      setShowResultSummary(true);
    }
  }, [currentProblemIndex, problemGen.generatedProblems.length]);

  const handleCloseGeneratedProblems = useCallback(() => {
    problemGen.setGeneratedProblems([]);
    setQuizResults([]);
    setCurrentProblemIndex(0);
    setShowResultSummary(false);
  }, [problemGen]);

  // 숫자 클릭 핸들러 - 문제 메타데이터 조회 및 표시
  const handleNodeClick = useCallback(async (node: StatsNode, isCorrect: boolean) => {
    console.log('handleNodeClick called', { node, isCorrect });
    try {
      setIsLoadingMetadata(true);
      setMetadataIsCorrect(isCorrect);
      
      // 분류 정보 추출
      const depth1 = node.depth1 || undefined;
      const depth2 = node.depth2 || undefined;
      const depth3 = node.depth3 || undefined;
      const depth4 = node.depth4 || undefined;
      
      console.log('Fetching metadata with params:', { depth1, depth2, depth3, depth4, isCorrect });
      
      // 메타데이터 조회
      const items = await fetchProblemsMetadataByCorrectness(
        depth1,
        depth2,
        depth3,
        depth4,
        isCorrect
      );
      
      console.log('Metadata items received:', items);
      setProblemMetadataItems(items);
      setShowMetadataModal(true);
      console.log('Modal should be shown now');
    } catch (error) {
      console.error('Error fetching problem metadata:', error);
      alert(language === 'ko' 
        ? '문제 분석 정보를 불러오는 중 오류가 발생했습니다.' 
        : 'Error loading problem analysis information.');
    } finally {
      setIsLoadingMetadata(false);
    }
  }, [language]);

  const totals = useMemo(() => {
    const correct = statsData.rows.reduce((s, r) => s + (r.correct_count || 0), 0);
    const incorrect = statsData.rows.reduce((s, r) => s + (r.incorrect_count || 0), 0);
    const total = statsData.rows.reduce((s, r) => s + (r.total_count || 0), 0);
    return { correct, incorrect, total };
  }, [statsData.rows]);

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

  const handleThisYearClick = useCallback(() => {
    const now = new Date();
    const start = new Date(now.getFullYear(), 0, 1);
    filters.setStartDate(start);
    filters.setEndDate(now);
  }, [filters]);

  const handleGenerateExampleSentences = useCallback(async () => {
    if (nodes.selectedNodes.size === 0) {
      alert(t.example.selectCategory);
      return;
    }
    await exampleGen.handleGenerateExampleSentences();
  }, [nodes.selectedNodes.size, exampleGen, t.example.selectCategory]);

  const handleDeleteFailedSession = useCallback(async (sessionId: string) => {
    try {
      await deleteSession(sessionId);
      await statsData.loadData(false);
    } catch (e) {
      alert(e instanceof Error ? e.message : (language === 'ko' ? '삭제 실패' : 'Delete failed'));
    }
  }, [language, statsData]);

  const handleDeleteSession = useCallback(async (sessionId: string) => {
    const confirmText = language === 'ko'
      ? '이 세션을 삭제하시겠습니까? 통계에서 제거됩니다.'
      : 'Delete this session? It will be removed from stats.';
    if (!window.confirm(confirmText)) return;
    try {
      await deleteSession(sessionId);
      await statsData.loadData(false);
    } catch (e) {
      alert(e instanceof Error ? e.message : (language === 'ko' ? '삭제 실패' : 'Delete failed'));
    }
  }, [language, statsData]);

  if (statsData.loading) return <div className="text-center text-slate-600 dark:text-slate-400 py-10">{t.common.loading}</div>;
  if (statsData.error) return <div className="text-center text-red-700 dark:text-red-400 py-10">{statsData.error}</div>;

  return (
    <div className="mx-auto space-y-6 w-full max-w-full px-2 sm:px-4 md:px-6 lg:max-w-5xl overflow-x-hidden">
      {/* 분석 중 UI - 최상단 */}
      {statsData.analyzingSessions.map((session) => (
        <AnalyzingCard
          key={session.id}
          sessionId={session.id}
          imageUrl={session.image_url}
          onDelete={handleDeleteSession}
        />
      ))}

      {/* 분석 실패 UI - 분석 중 다음 (실패해도 사라지지 않게: 관찰 가능성) */}
      {statsData.failedSessions.map((session) => (
        <FailedAnalysisCard key={session.id} session={session} onDelete={handleDeleteFailedSession} />
      ))}

      {/* 라벨링 UI - 분석 중 다음 */}
      {statsData.pendingLabelingSessions.map((session) => (
        <QuickLabelingCard
          key={session.id}
          sessionId={session.id}
          imageUrl={session.image_url}
          analysisModel={session.analysis_model}
          onSave={statsData.handleLabelingComplete}
          onDelete={handleDeleteSession}
        />
      ))}

      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-lg p-6 md:p-8 border border-slate-200 dark:border-slate-700 w-full max-w-full min-w-0">
        <h2 className="text-2xl font-bold mb-4 text-slate-800 dark:text-slate-200">{t.stats.statsByType}</h2>
        
        {/* 기간 설정 UI */}
        <StatsDateFilter
          startDate={filters.startDate}
          endDate={filters.endDate}
          language={language}
          onStartDateChange={filters.setStartDate}
          onEndDateChange={filters.setEndDate}
          onSetDateRange={filters.handleSetDateRange}
          onClearFilter={filters.handleClearFilter}
          onThisYearClick={handleThisYearClick}
        />

        <div className="mb-4 flex items-center justify-between flex-wrap gap-3 w-full max-w-full min-w-0">
          <div className="text-slate-700 dark:text-slate-300 text-sm sm:text-base break-words">{t.stats.total}: {totals.total} / {t.stats.correct}: {totals.correct} / {t.stats.incorrect}: {totals.incorrect}</div>
          <StatsActionButtons
            language={language}
            isReclassifying={reclassify.isReclassifying}
            isGeneratingExamples={exampleGen.isGeneratingExamples}
            selectedNodesCount={nodes.selectedNodes.size}
            onReclassify={reclassify.handleReclassifyAll}
            onGenerateExamples={handleGenerateExampleSentences}
            onGenerateSimilarProblems={problemGen.handleGenerateSimilarProblems}
          />
        </div>

        {/* 문제 생성 UI */}
        {problemGen.showProblemGenerator && (
          <ProblemGeneratorUI
            problemCounts={problemGen.problemCounts}
            onCountChange={problemGen.handleCountChange}
            onGenerate={problemGen.handleGenerateProblems}
            onLoadExisting={problemGen.handleLoadExistingProblems}
            isGenerating={problemGen.isGeneratingProblems}
            isLoadingExisting={problemGen.isLoadingExistingProblems}
            error={problemGen.generationError}
            selectedNodesCount={nodes.selectedNodes.size}
            language={language}
            useExistingProblems={problemGen.useExistingProblems}
            onToggleUseExisting={problemGen.setUseExistingProblems}
            onClose={() => {
              problemGen.setShowProblemGenerator(false);
              statsData.setError(null);
            }}
          />
        )}

        {/* 생성된 시험지 표시 */}
        {problemGen.showTestSheet && problemGen.generatedProblems.length > 0 && (
          <div className="mt-6">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-2xl font-bold text-slate-800 dark:text-slate-200">
                {language === 'ko' ? '생성된 시험지' : 'Generated Test Sheet'}
              </h2>
              <button
                onClick={() => {
                  problemGen.setShowTestSheet(false);
                  problemGen.setGeneratedProblems([]);
                  problemGen.setShowProblemGenerator(true);
                }}
                className="px-4 py-2 bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-lg hover:bg-slate-300 dark:hover:bg-slate-600 transition-colors"
              >
                {language === 'ko' ? '새로 생성' : 'Generate New'}
              </button>
            </div>
            <TestSheetView 
              problems={problemGen.generatedProblems} 
              problemType={problemGen.generatedProblems[0]?.problem_type || problemGen.selectedProblemType} 
            />
          </div>
        )}

        <div className="mt-6">
          <h3 className="text-xl font-semibold text-slate-800 dark:text-slate-200 mb-4">
            {chartLabels.overview}
          </h3>
          <StatsOverviewCharts
            rows={statsData.rows}
            totals={totals}
            theme={theme}
            labels={chartLabels}
          />
        </div>
        
        {reclassify.reclassificationStatus && (
          <div className="mb-4 p-3 bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800 rounded-lg">
            <p className="text-sm text-blue-800 dark:text-blue-200">{reclassify.reclassificationStatus}</p>
          </div>
        )}
        
        <HierarchicalStatsTable 
          data={statsData.hierarchicalData} 
          onImageClick={() => {}}
          onNumberClick={handleNodeClick}
          selectedNodes={nodes.selectedNodes}
          onNodeSelect={nodes.handleNodeSelect}
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

        {/* 문제 메타데이터 모달 */}
        {showMetadataModal && (
          <ProblemMetadataModal
            items={problemMetadataItems}
            isCorrect={metadataIsCorrect}
            onClose={() => {
              setShowMetadataModal(false);
              setProblemMetadataItems([]);
            }}
          />
        )}

        {/* 메타데이터 로딩 표시 */}
        {isLoadingMetadata && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white dark:bg-slate-800 rounded-lg p-6">
              <div className="text-center text-slate-700 dark:text-slate-300">
                {language === 'ko' ? '분석 정보를 불러오는 중...' : 'Loading analysis information...'}
              </div>
            </div>
          </div>
        )}
        
        {/* 예시 문장 모달 */}
        <StatsExampleModal
          language={language}
          exampleSentences={exampleGen.exampleSentences}
          isOpen={exampleGen.showExampleModal}
          onClose={() => {
            exampleGen.setShowExampleModal(false);
            // exampleSentences는 useExampleGeneration 내부에서 관리되므로 여기서는 닫기만
          }}
        />
      </div>

      {/* 생성된 유사 문제 표시 */}
      <StatsGeneratedProblems
        language={language}
        generatedProblems={problemGen.generatedProblems}
        currentProblemIndex={currentProblemIndex}
        quizResults={quizResults}
        showResultSummary={showResultSummary}
        onProblemResult={handleProblemResult}
        onNextProblem={handleNextProblem}
        onClose={handleCloseGeneratedProblems}
      />
    </div>
  );
};
