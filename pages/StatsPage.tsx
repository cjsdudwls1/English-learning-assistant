import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchStatsByType, TypeStatsRow, fetchHierarchicalStats, StatsNode } from '../services/stats';
import { fetchUserSessions, deleteSession } from '../services/db';
import { HierarchicalStatsTable } from '../components/HierarchicalStatsTable';
import { ImageModal } from '../components/ImageModal';
import type { SessionWithProblems } from '../types';

export const StatsPage: React.FC = () => {
  const navigate = useNavigate();
  const [rows, setRows] = useState<TypeStatsRow[]>([]);
  const [hierarchicalData, setHierarchicalData] = useState<StatsNode[]>([]);
  const [sessions, setSessions] = useState<SessionWithProblems[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAllSessions, setShowAllSessions] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalImageUrl, setModalImageUrl] = useState<string>('');
  const [modalSessionId, setModalSessionId] = useState<string>('');

  const loadData = async () => {
    try {
      setLoading(true);
      const [statsData, hierarchicalStatsData, sessionsData] = await Promise.all([
        fetchStatsByType(),
        fetchHierarchicalStats(),
        fetchUserSessions(),
      ]);
      setRows(statsData);
      setHierarchicalData(hierarchicalStatsData);
      setSessions(sessionsData);
    } catch (e) {
      setError(e instanceof Error ? e.message : '통계 조회 실패');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleDelete = async (sessionId: string) => {
    if (!window.confirm('이 세션을 삭제하시겠습니까?')) return;
    
    try {
      await deleteSession(sessionId);
      await loadData(); // 삭제 후 데이터 다시 로드
    } catch (e) {
      alert(e instanceof Error ? e.message : '삭제 실패');
    }
  };

  const totals = useMemo(() => {
    const correct = rows.reduce((s, r) => s + (r.correct_count || 0), 0);
    const incorrect = rows.reduce((s, r) => s + (r.incorrect_count || 0), 0);
    const total = rows.reduce((s, r) => s + (r.total_count || 0), 0);
    return { correct, incorrect, total };
  }, [rows]);

  const displayedSessions = useMemo(() => {
    return showAllSessions ? sessions : sessions.slice(0, 5);
  }, [sessions, showAllSessions]);

  const handleImageClick = (sessionIds: string[]) => {
    if (sessionIds.length > 0) {
      // 첫 번째 세션의 이미지를 모달로 표시
      const session = sessions.find(s => sessionIds.includes(s.id));
      if (session) {
        setModalImageUrl(session.image_url);
        setModalSessionId(session.id);
        setIsModalOpen(true);
      }
    }
  };

  const handleSessionImageClick = (sessionId: string, imageUrl: string) => {
    setModalImageUrl(imageUrl);
    setModalSessionId(sessionId);
    setIsModalOpen(true);
  };

  if (loading) return <div className="text-center text-slate-600 py-10">불러오는 중...</div>;
  if (error) return <div className="text-center text-red-700 py-10">{error}</div>;

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* 유형별 통계 */}
      <div className="bg-white rounded-2xl shadow-lg p-6 md:p-8 border border-slate-200">
        <h2 className="text-2xl font-bold mb-4">유형별 정오답 통계</h2>
        <div className="mb-4 text-slate-700">전체: {totals.total} / 정답: {totals.correct} / 오답: {totals.incorrect}</div>
        
        <HierarchicalStatsTable 
          data={hierarchicalData} 
          onImageClick={handleImageClick}
        />
      </div>

      {/* 최근 업로드한 문제 목록 */}
      <div className="bg-white rounded-2xl shadow-lg p-6 md:p-8 border border-slate-200">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-2xl font-bold">최근 업로드한 문제</h2>
          <button
            onClick={loadData}
            className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700"
          >
            새로고침
          </button>
        </div>
        {sessions.length === 0 ? (
          <p className="text-slate-500 text-center py-4">아직 업로드한 문제가 없습니다.</p>
        ) : (
          <div className="space-y-3">
            {displayedSessions.map((session) => (
              <div key={session.id} className="border border-slate-200 rounded-lg p-4 flex items-center gap-4">
                <img 
                  src={session.image_url} 
                  alt="문제 이미지" 
                  className="w-20 h-20 object-cover rounded border cursor-pointer hover:opacity-80"
                  onClick={() => handleSessionImageClick(session.id, session.image_url)}
                />
                <div className="flex-1">
                  <p className="text-sm text-slate-500">
                    {new Date(session.created_at).toLocaleString('ko-KR')}
                  </p>
                  <p className="text-slate-700 mt-1">
                    {session.problem_count === 0 ? (
                      <span className="text-orange-600 font-medium">🔍 AI 분석 중... 잠시 후 새로고침해주세요</span>
                    ) : (
                      `문제 ${session.problem_count}개 | 정답 ${session.correct_count}개 | 오답 ${session.incorrect_count}개`
                    )}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => navigate(`/session/${session.id}`)}
                    disabled={session.problem_count === 0}
                    className={`px-4 py-2 text-white text-sm rounded-lg ${
                      session.problem_count === 0 
                        ? 'bg-gray-400 cursor-not-allowed' 
                        : 'bg-indigo-600 hover:bg-indigo-700'
                    }`}
                  >
                    상세보기
                  </button>
                  <button
                    onClick={() => handleDelete(session.id)}
                    className="px-4 py-2 bg-red-600 text-white text-sm rounded-lg hover:bg-red-700"
                  >
                    삭제
                  </button>
                </div>
              </div>
            ))}
            {sessions.length > 5 && (
              <div className="text-center pt-4">
                <button
                  onClick={() => setShowAllSessions(!showAllSessions)}
                  className="px-4 py-2 bg-slate-600 text-white text-sm rounded-lg hover:bg-slate-700"
                >
                  {showAllSessions ? '접기' : `전체 보기 (${sessions.length}개)`}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
      
      {/* 이미지 모달 */}
      <ImageModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        imageUrl={modalImageUrl}
        sessionId={modalSessionId}
      />
    </div>
  );
};


