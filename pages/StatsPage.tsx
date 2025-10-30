import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import DatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';
import { fetchStatsByType, TypeStatsRow, fetchHierarchicalStats, StatsNode } from '../services/stats';
import { HierarchicalStatsTable } from '../components/HierarchicalStatsTable';
import { fetchProblemsByClassification } from '../services/db';
import { supabase } from '../services/supabaseClient';
// import { generateProblemAnalysisReport } from '../services/coaching'; // SECURITY FIX: Edge Function으로 이동

export const StatsPage: React.FC = () => {
  const navigate = useNavigate();
  const [rows, setRows] = useState<TypeStatsRow[]>([]);
  const [hierarchicalData, setHierarchicalData] = useState<StatsNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [startDate, setStartDate] = useState<Date | null>(null);
  const [endDate, setEndDate] = useState<Date | null>(null);
  const [selectedProblems, setSelectedProblems] = useState<any[]>([]);
  const [checkedProblemIds, setCheckedProblemIds] = useState<Set<string>>(new Set());
  const [selectedFilter, setSelectedFilter] = useState<{node: StatsNode, isCorrect: boolean} | null>(null);
  const [aiAnalysisReport, setAiAnalysisReport] = useState<string | null>(null);
  const [isGeneratingReport, setIsGeneratingReport] = useState(false);

  const loadData = async () => {
    try {
      setLoading(true);
      const [statsData, hierarchicalStatsData] = await Promise.all([
        fetchStatsByType(startDate || undefined, endDate || undefined),
        fetchHierarchicalStats(startDate || undefined, endDate || undefined),
      ]);
      setRows(statsData);
      setHierarchicalData(hierarchicalStatsData);
    } catch (e) {
      setError(e instanceof Error ? e.message : '통계 조회 실패');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [startDate, endDate]);

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

  const handleNodeClick = async (node: StatsNode, isCorrect: boolean) => {
    try {
      setLoading(true);
      const problems = await fetchProblemsByClassification(
        node.depth1,
        node.depth2 || '',
        node.depth3 || '',
        node.depth4 || '',
        isCorrect
      );
      setSelectedProblems(problems);
      setCheckedProblemIds(new Set());
      setSelectedFilter({ node, isCorrect });
      setAiAnalysisReport(null); // 새로운 문제 선택 시 리포트 초기화
    } catch (e) {
      setError(e instanceof Error ? e.message : '문제 조회 실패');
    } finally {
      setLoading(false);
    }
  };

  const toggleCheck = (problemId: string, checked: boolean) => {
    setCheckedProblemIds(prev => {
      const next = new Set(prev);
      if (checked) next.add(problemId); else next.delete(problemId);
      return next;
    });
  };

  const navigateRetry = () => {
    if (checkedProblemIds.size === 0) return;
    const ids = Array.from(checkedProblemIds).join(',');
    navigate(`/retry?ids=${encodeURIComponent(ids)}`);
  };

  const toggleSelectAll = () => {
    if (selectedProblems.length === 0) return;
    const allIds = new Set<string>(selectedProblems.map((p: any) => p.problem_id));
    // 모두 선택되어 있으면 전체 해제, 아니면 전체 선택
    const isAllSelected = Array.from(allIds).every(id => checkedProblemIds.has(id));
    setCheckedProblemIds(isAllSelected ? new Set() : allIds);
  };

  const handleAiAnalysis = async () => {
    if (selectedProblems.length === 0) return;
    
    try {
      setIsGeneratingReport(true);
      
      // SECURITY FIX: Edge Function 호출로 변경
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) {
        setError('로그인이 필요합니다.');
        return;
      }

      // 선택된 문제만 필터링
      const filteredProblems = selectedProblems.filter((p: any) => checkedProblemIds.has(p.problem_id));
      const problemsToAnalyze = filteredProblems.length > 0 ? filteredProblems : selectedProblems;

      const functionUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-report`;
      
      const response = await fetch(functionUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`,
        },
        body: JSON.stringify({
          problems: problemsToAnalyze,
          userId: userData.user.id
        })
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const result = await response.json();
      
      if (result.success) {
        setAiAnalysisReport(result.report);
      } else {
        throw new Error(result.error || 'AI 분석 리포트 생성 실패');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'AI 분석 리포트 생성 실패');
    } finally {
      setIsGeneratingReport(false);
    }
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

        <div className="mb-4 text-slate-700">전체: {totals.total} / 정답: {totals.correct} / 오답: {totals.incorrect}</div>
        
        <HierarchicalStatsTable 
          data={hierarchicalData} 
          onImageClick={() => {}}
          onNumberClick={handleNodeClick}
        />
      </div>

      {/* 선택된 문제 리스트 */}
      {selectedProblems.length > 0 && (
        <div className="bg-white rounded-2xl shadow-lg p-6 md:p-8 border border-slate-200">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-xl font-bold">
              {selectedFilter?.node.depth1} - {selectedFilter?.isCorrect ? '정답' : '오답'} 문제 ({selectedProblems.length}개)
            </h3>
            <div className="flex items-center gap-2">
              {!selectedFilter?.isCorrect && (
                <>
                  <button
                    onClick={toggleSelectAll}
                    className="px-4 py-2 bg-blue-100 text-blue-800 rounded-lg hover:bg-blue-200"
                  >
                    {selectedProblems.length > 0 && selectedProblems.every((p: any) => checkedProblemIds.has(p.problem_id)) ? '전체해제' : '전체선택'}
                  </button>
                  <button
                    onClick={navigateRetry}
                    disabled={checkedProblemIds.size === 0}
                    className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
                  >
                    다시 풀어보기
                  </button>
                </>
              )}
              <button
              onClick={handleAiAnalysis}
              disabled={isGeneratingReport}
              className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
            >
              {isGeneratingReport ? 'AI 분석 중...' : 'AI 분석'}
              </button>
            </div>
          </div>
          {/* AI 분석 리포트: 상단으로 이동 */}
          {aiAnalysisReport && (
            <div className="mb-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
              <h4 className="text-lg font-semibold text-blue-800 mb-3">AI 분석 리포트</h4>
              <div className="text-blue-700 whitespace-pre-wrap">
                {aiAnalysisReport}
              </div>
            </div>
          )}

          <div className="space-y-3 max-h-[60vh] sm:max-h-[65vh] md:max-h-[70vh] overflow-auto">
            {selectedProblems.map((item, idx) => (
              <div
                key={idx}
                className={`border rounded-lg p-3 sm:p-4 transition-colors cursor-pointer ${checkedProblemIds.has(item.problem_id) ? 'bg-blue-50 border-blue-300' : 'border-slate-200 hover:bg-slate-50'}`}
                onClick={() => {
                  if (selectedFilter?.isCorrect) return; // 정답 목록에서는 선택 비활성화 유지
                  const isChecked = checkedProblemIds.has(item.problem_id);
                  toggleCheck(item.problem_id, !isChecked);
                }}
              >
                <div className="flex items-start gap-3">
                  <img 
                    src={item.problem.session.image_url} 
                    alt="문제 이미지"
                    className="w-20 h-20 sm:w-24 sm:h-24 object-cover rounded border cursor-pointer flex-shrink-0"
                    onClick={() => navigate(`/session/${item.problem.session_id}`)}
                  />
                  <div className="flex-1">
                    <p className="text-sm text-slate-500">
                      {new Date(item.problem.session.created_at).toLocaleDateString('ko-KR')}
                    </p>
                    <p className="text-slate-700 font-medium mt-1">
                      문제 #{item.problem.index_in_image + 1}
                    </p>
                    <p className="text-slate-600 text-sm mt-1 line-clamp-2">
                      {item.problem.stem}
                    </p>
                  </div>
                  <span className={`px-2 py-1 text-xs rounded ${
                    item.is_correct ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                  }`}>
                    {item.is_correct ? '정답' : '오답'}
                  </span>
                </div>
              </div>
            ))}
          </div>
          
        </div>
      )}
    </div>
  );
};


