import React, { useEffect, useMemo, useState } from 'react';
import DatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';
import { fetchStatsByType, TypeStatsRow, fetchHierarchicalStats, StatsNode } from '../services/stats';
import { HierarchicalStatsTable } from '../components/HierarchicalStatsTable';
import { supabase } from '../services/supabaseClient';
import { fetchAnalyzingSessions, fetchPendingLabelingSessions } from '../services/db';
import { AnalyzingCard } from '../components/AnalyzingCard';
import { QuickLabelingCard } from '../components/QuickLabelingCard';
import type { SessionWithProblems } from '../types';

export const StatsPage: React.FC = () => {
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

  const loadData = async (showLoading: boolean = false) => {
    try {
      if (showLoading) {
        setLoading(true);
      }
      const [statsData, hierarchicalStatsData, analyzing, pendingSessions] = await Promise.all([
        fetchStatsByType(startDate || undefined, endDate || undefined),
        fetchHierarchicalStats(startDate || undefined, endDate || undefined),
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
  }, [startDate, endDate]);

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

  // 유사 문제 생성 핸들러
  const handleGenerateSimilarProblems = async () => {
    if (selectedNodes.size === 0) {
      alert('문제 유형을 선택해주세요.');
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
        alert('최하위 depth의 문제 유형을 선택해주세요.');
        setIsGeneratingProblems(false);
        return;
      }

      // 각 최하위 depth당 2문제씩 생성
      const classifications = selectedLeafNodes.map(node => ({
        depth1: node.depth1,
        depth2: node.depth2 || '',
        depth3: node.depth3 || '',
        depth4: node.depth4 || '',
        problemCount: 2 // 최하위 depth당 2문제
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
          userId: userData.user.id
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP error! status: ${response.status}, ${errorText}`);
      }

      const result = await response.json();
      
      if (result.success) {
        setGeneratedProblems(result.problems || []);
      } else {
        throw new Error(result.error || '유사 문제 생성 실패');
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

  const totals = useMemo(() => {
    const correct = rows.reduce((s, r) => s + (r.correct_count || 0), 0);
    const incorrect = rows.reduce((s, r) => s + (r.incorrect_count || 0), 0);
    const total = rows.reduce((s, r) => s + (r.total_count || 0), 0);
    return { correct, incorrect, total };
  }, [rows]);

  if (loading) return <div className="text-center text-slate-600 py-10">불러오는 중...</div>;
  if (error) return <div className="text-center text-red-700 py-10">{error}</div>;

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

      <div className="bg-white rounded-2xl shadow-lg p-6 md:p-8 border border-slate-200">
        <h2 className="text-2xl font-bold mb-4">유형별 정오답 통계</h2>
        
        {/* 기간 설정 UI */}
        <div className="mb-6 p-3 sm:p-4 bg-slate-50 rounded-lg">
          <div className="flex flex-wrap gap-2 items-center mb-3">
            <span className="text-sm font-medium text-slate-700">기간 설정:</span>
            <button
              onClick={() => handleSetDateRange(1)}
              className="px-3 py-1 text-sm bg-blue-100 text-blue-700 rounded hover:bg-blue-200"
            >
              1개월
            </button>
            <button
              onClick={() => handleSetDateRange(3)}
              className="px-3 py-1 text-sm bg-blue-100 text-blue-700 rounded hover:bg-blue-200"
            >
              3개월
            </button>
            <button
              onClick={() => handleSetDateRange(6)}
              className="px-3 py-1 text-sm bg-blue-100 text-blue-700 rounded hover:bg-blue-200"
            >
              6개월
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
              올 한 해
            </button>
            {(startDate || endDate) && (
              <button
                onClick={handleClearFilter}
                className="px-3 py-1 text-sm bg-gray-200 text-gray-700 rounded hover:bg-gray-300"
              >
                전체
              </button>
            )}
          </div>
          <div className="flex gap-3 items-center">
            <div>
              <label className="text-sm text-slate-600 mr-2">시작일:</label>
              <DatePicker
                selected={startDate}
                onChange={(date) => setStartDate(date)}
                dateFormat="yyyy-MM-dd"
                className="px-3 py-1 border rounded"
                maxDate={endDate || new Date()}
              />
            </div>
            <div>
              <label className="text-sm text-slate-600 mr-2">종료일:</label>
              <DatePicker
                selected={endDate}
                onChange={(date) => setEndDate(date)}
                dateFormat="yyyy-MM-dd"
                className="px-3 py-1 border rounded"
                minDate={startDate}
                maxDate={new Date()}
              />
            </div>
          </div>
        </div>

        <div className="mb-4 flex items-center justify-between">
          <div className="text-slate-700">전체: {totals.total} / 정답: {totals.correct} / 오답: {totals.incorrect}</div>
          <button
            onClick={handleGenerateSimilarProblems}
            disabled={selectedNodes.size === 0 || isGeneratingProblems}
            className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
          >
            {isGeneratingProblems ? '생성 중...' : '유사 문제 생성'}
          </button>
        </div>
        
        <HierarchicalStatsTable 
          data={hierarchicalData} 
          onImageClick={() => {}}
          onNumberClick={handleNodeClick}
          selectedNodes={selectedNodes}
          onNodeSelect={handleNodeSelect}
        />
      </div>

      {/* 생성된 유사 문제 표시 */}
      {generatedProblems.length > 0 && (
        <div className="bg-white rounded-2xl shadow-lg p-6 md:p-8 border border-slate-200">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-xl font-bold">
              생성된 유사 문제 ({generatedProblems.length}개)
            </h3>
            <button
              onClick={() => setGeneratedProblems([])}
              className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300"
            >
              닫기
            </button>
          </div>

          <div className="space-y-4 md:max-h-[70vh] md:overflow-auto">
            {generatedProblems.map((problem, idx) => (
              <div
                key={idx}
                className="border border-slate-200 rounded-lg p-4 hover:bg-slate-50"
              >
                <div className="mb-2">
                  <span className="text-sm font-medium text-indigo-600">
                    문제 {idx + 1}
                  </span>
                  {problem.classification && (
                    <span className="ml-2 text-xs text-slate-500">
                      ({problem.classification.depth1} 
                      {problem.classification.depth2 && ` > ${problem.classification.depth2}`}
                      {problem.classification.depth3 && ` > ${problem.classification.depth3}`}
                      {problem.classification.depth4 && ` > ${problem.classification.depth4}`})
                    </span>
                  )}
                </div>
                <div className="text-slate-700 mb-3">
                  <p className="font-medium mb-2">{problem.stem}</p>
                  {problem.choices && problem.choices.length > 0 && (
                    <ul className="list-disc list-inside space-y-1 text-sm">
                      {problem.choices.map((choice: any, cIdx: number) => (
                        <li key={cIdx} className={choice.is_correct ? 'text-green-600 font-medium' : ''}>
                          {choice.text}
                          {choice.is_correct && ' ✓'}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};


