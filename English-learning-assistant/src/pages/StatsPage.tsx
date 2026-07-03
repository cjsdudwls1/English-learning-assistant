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
import { ConsultingReportModal } from '../components/ConsultingReportModal';
import { ConsultingHistoryModal } from '../components/ConsultingHistoryModal';
import { StatsGeneratedProblems } from '../components/StatsGeneratedProblems';
import { SolvingStatsCard } from '../components/stats/SolvingStatsCard';
import { useLanguage } from '../contexts/LanguageContext';
import { useTheme } from '../contexts/ThemeContext';
import { getTranslation } from '../utils/translations';
import { translateError } from '../utils/errorI18n';
import { deleteSession, findTaxonomyByDepth, fetchProblemsMetadataByCorrectness, type ProblemMetadataItem } from '../services/db';
import { ProblemMetadataModal } from '../components/ProblemMetadataModal';
import type { StatsNode } from '../services/stats';
import { supabase } from '../services/supabaseClient';
import { useStatsData } from '../hooks/useStatsData';
import { useStatsFilters } from '../hooks/useStatsFilters';
import { useStatsNodes } from '../hooks/useStatsNodes';
import { useProblemGenerationState } from '../hooks/useProblemGenerationState';
import { useExampleGeneration } from '../hooks/useExampleGeneration';
import { useConsulting } from '../hooks/useConsulting';
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
  const [showConsultHistory, setShowConsultHistory] = useState(false);

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

      // 미분류 루트 노드: classification.depth1이 ''라 depth 필터로는 조회 불가 → 전용 플래그로 조회
      const isUnclassified = !depth2 && !depth3 && !depth4 && (depth1 === '미분류' || depth1 === 'Unclassified');

      console.log('Fetching metadata with params:', { depth1, depth2, depth3, depth4, isCorrect, isUnclassified });

      // 메타데이터 조회
      const items = await fetchProblemsMetadataByCorrectness(
        isUnclassified ? undefined : depth1,
        isUnclassified ? undefined : depth2,
        isUnclassified ? undefined : depth3,
        isUnclassified ? undefined : depth4,
        isCorrect,
        isUnclassified
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

  // 학습 컨설턴트 (선택 카테고리 또는 전체 오답 기반 맞춤 보고서)
  const consulting = useConsulting({
    language,
    hierarchicalData: statsData.hierarchicalData,
    selectedNodes: nodes.selectedNodes,
    getLeafNodes: nodes.getLeafNodes,
    getNodeKey: nodes.getNodeKey,
    overallTotals: totals,
    setError: statsData.setError,
  });

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
      alert(translateError(e, language, t, language === 'ko' ? '삭제 실패' : 'Delete failed'));
    }
  }, [language, t, statsData]);

  const handleDeleteSession = useCallback(async (sessionId: string) => {
    const confirmText = language === 'ko'
      ? '이 세션을 삭제하시겠습니까? 통계에서 제거됩니다.'
      : 'Delete this session? It will be removed from stats.';
    if (!window.confirm(confirmText)) return;
    try {
      await deleteSession(sessionId);
      await statsData.loadData(false);
    } catch (e) {
      alert(translateError(e, language, t, language === 'ko' ? '삭제 실패' : 'Delete failed'));
    }
  }, [language, t, statsData]);

  if (statsData.loading) return <div className="text-center text-slate-600 dark:text-slate-400 py-10">{t.common.loading}</div>;
  if (statsData.error) return <div className="text-center text-red-700 dark:text-red-400 py-10">{typeof statsData.error === 'string' ? statsData.error : JSON.stringify(statsData.error)}</div>;

  return (
    <div className="mx-auto space-y-6 w-full max-w-full px-2 sm:px-4 md:px-6 lg:max-w-5xl overflow-x-hidden">
      {/* 분석 중 UI - 최상단 */}
      {statsData.analyzingSessions.map((session) => (
        <AnalyzingCard
          key={session.id}
          sessionId={session.id}
          imageUrl={session.image_url}
          imageUrls={session.image_urls}
          onDelete={handleDeleteSession}
          analysisModel={session.analysis_model}
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
          imageUrls={session.image_urls}
          analysisModel={session.analysis_model}
          modelsUsed={session.models_used}
          onSave={statsData.handleLabelingComplete}
          onDelete={handleDeleteSession}
        />
      ))}

      <SolvingStatsCard />

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
          <div className="min-w-0">
            <div className="text-slate-700 dark:text-slate-300 text-sm sm:text-base break-words">{t.stats.total}: {totals.total} / {t.stats.correct}: {totals.correct} / {t.stats.incorrect}: {totals.incorrect}</div>
            {totals.total > 0 && (
              <p className="mt-1 text-xs text-slate-400 dark:text-slate-500 break-words">
                {language === 'ko'
                  ? `채점 완료 ${statsData.composition.labelMarked}문항 + 과제·생성 풀이 ${statsData.composition.genSolved}건 · 미채점 문항 제외 ('문제관리' 전체 수와 다를 수 있음)`
                  : `${statsData.composition.labelMarked} graded items + ${statsData.composition.genSolved} assignment/generated solves · unmarked excluded (may differ from the "Problems" total)`}
              </p>
            )}
          </div>
          <StatsActionButtons
            language={language}
            isReclassifying={reclassify.isReclassifying}
            isGeneratingExamples={exampleGen.isGeneratingExamples}
            isConsulting={consulting.isConsulting}
            selectedNodesCount={nodes.selectedNodes.size}
            onReclassify={reclassify.handleReclassifyAll}
            onGenerateExamples={handleGenerateExampleSentences}
            onConsult={consulting.handleGenerateConsulting}
            onShowHistory={() => setShowConsultHistory(true)}
            onGenerateSimilarProblems={problemGen.handleGenerateSimilarProblems}
          />
        </div>

        {/* 문제 생성 UI */}
        {problemGen.showProblemGenerator && (
          <ProblemGeneratorUI
            problemCounts={problemGen.problemCounts}
            onCountChange={problemGen.handleCountChange}
            onGenerate={problemGen.handleGenerateProblems}
            onGenerateWithOptions={problemGen.handleGenerateWithOptions}
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
          onImageClick={() => { }}
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

        {/* 학습 컨설팅 보고서 모달 */}
        <ConsultingReportModal
          language={language}
          report={consulting.reportText}
          isOpen={consulting.showConsultModal}
          onClose={() => consulting.setShowConsultModal(false)}
        />

        {/* 학습 컨설팅 기록 모달 */}
        <ConsultingHistoryModal
          language={language}
          isOpen={showConsultHistory}
          onClose={() => setShowConsultHistory(false)}
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
