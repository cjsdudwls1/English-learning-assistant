import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchUserSessions, deleteSession, fetchPendingLabelingSessions, fetchAnalyzingSessions } from '../services/db';
import { ImageModal } from '../components/ImageModal';
import { QuickLabelingCard } from '../components/QuickLabelingCard';
import { AnalyzingCard } from '../components/AnalyzingCard';
import type { SessionWithProblems } from '../types';

export const RecentProblemsPage: React.FC = () => {
  const navigate = useNavigate();
  const [sessions, setSessions] = useState<SessionWithProblems[]>([]);
  const [analyzingSessions, setAnalyzingSessions] = useState<SessionWithProblems[]>([]);
  const [pendingLabelingSessions, setPendingLabelingSessions] = useState<SessionWithProblems[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [displayedCount, setDisplayedCount] = useState(5);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalImageUrl, setModalImageUrl] = useState<string>('');
  const [modalSessionId, setModalSessionId] = useState<string>('');
  const [selectedSessions, setSelectedSessions] = useState<Set<string>>(new Set());
  const [pollingActive, setPollingActive] = useState(true);

  const loadData = async () => {
    try {
      setLoading(true);
      const sessionsData = await fetchUserSessions();
      setSessions(sessionsData);
      
      // 분석 중인 세션 조회
      const analyzing = await fetchAnalyzingSessions();
      setAnalyzingSessions(analyzing);
      console.log('Analyzing sessions:', analyzing.length);
      
      // 라벨링이 필요한 세션 조회
      const pendingSessions = await fetchPendingLabelingSessions();
      setPendingLabelingSessions(pendingSessions);
      console.log('Pending labeling sessions:', pendingSessions.length);
      
      // 분석 중이거나 라벨링이 필요하면 폴링 계속, 없으면 폴링 중단
      const shouldPoll = analyzing.length > 0 || pendingSessions.length > 0;
      setPollingActive(shouldPoll);
      console.log('Should poll:', shouldPoll);
    } catch (e) {
      setError(e instanceof Error ? e.message : '조회 실패');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // 폴링 로직: 분석 중이거나 라벨링이 필요한 세션이 있으면 1초마다 상태 확인
  useEffect(() => {
    if (!pollingActive) return;
    
    const interval = setInterval(() => {
      console.log('Polling: Checking for updates...');
      loadData();
    }, 1000);
    
    return () => clearInterval(interval);
  }, [pollingActive]);

  const handleDelete = async (sessionId: string) => {
    if (!window.confirm('이 세션을 삭제하시겠습니까?')) return;
    
    try {
      await deleteSession(sessionId);
      await loadData();
    } catch (e) {
      alert(e instanceof Error ? e.message : '삭제 실패');
    }
  };

  const handleBulkDelete = async () => {
    if (selectedSessions.size === 0) {
      alert('삭제할 항목을 선택해주세요.');
      return;
    }

    if (!window.confirm(`${selectedSessions.size}개의 세션을 삭제하시겠습니까?`)) return;

    try {
      await Promise.all(Array.from(selectedSessions).map(id => deleteSession(id)));
      setSelectedSessions(new Set());
      await loadData();
    } catch (e) {
      alert(e instanceof Error ? e.message : '삭제 실패');
    }
  };

  const handleSessionImageClick = (sessionId: string, imageUrl: string) => {
    setModalImageUrl(imageUrl);
    setModalSessionId(sessionId);
    setIsModalOpen(true);
  };

  const toggleSessionSelection = (sessionId: string) => {
    const newSelected = new Set(selectedSessions);
    if (newSelected.has(sessionId)) {
      newSelected.delete(sessionId);
    } else {
      newSelected.add(sessionId);
    }
    setSelectedSessions(newSelected);
  };

  const handleSelectAll = () => {
    if (selectedSessions.size === displayedSessions.length) {
      // 모든 항목이 선택되어 있으면 전체 해제
      setSelectedSessions(new Set());
    } else {
      // 모든 항목 선택
      setSelectedSessions(new Set(displayedSessions.map(session => session.id)));
    }
  };

  const handleLabelingComplete = async () => {
    // 라벨링 완료 후 데이터 다시 로드
    await loadData();
  };

  const displayedSessions = useMemo(() => {
    return sessions.slice(0, displayedCount);
  }, [sessions, displayedCount]);

  if (loading && sessions.length === 0 && analyzingSessions.length === 0 && pendingLabelingSessions.length === 0) return <div className="text-center text-slate-600 py-10">불러오는 중...</div>;
  if (error) return <div className="text-center text-red-700 py-10">{error}</div>;

  return (
    <div className="max-w-5xl mx-auto space-y-6">
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
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-2xl font-bold">최근 업로드한 문제</h2>
          <div className="flex gap-2">
            <button
              onClick={handleSelectAll}
              className="px-4 py-2 bg-slate-600 text-white text-sm rounded-lg hover:bg-slate-700"
            >
              {selectedSessions.size === displayedSessions.length ? '전체 해제' : '전체선택'}
            </button>
            {selectedSessions.size > 0 && (
              <button
                onClick={handleBulkDelete}
                className="px-4 py-2 bg-red-600 text-white text-sm rounded-lg hover:bg-red-700"
              >
                선택 삭제 ({selectedSessions.size})
              </button>
            )}
            <button
              onClick={loadData}
              className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700"
            >
              새로고침
            </button>
          </div>
        </div>
        {sessions.length === 0 ? (
          <p className="text-slate-500 text-center py-4">아직 업로드한 문제가 없습니다.</p>
        ) : (
          <div className="space-y-3">
            {displayedSessions.map((session) => (
              <div key={session.id} className="border border-slate-200 rounded-lg p-4 flex items-center gap-4">
                <input
                  type="checkbox"
                  checked={selectedSessions.has(session.id)}
                  onChange={() => toggleSessionSelection(session.id)}
                  className="w-5 h-5"
                />
                <img 
                  src={session.image_url} 
                  alt="문제 이미지" 
                  className="w-20 h-20 object-cover rounded border cursor-pointer hover:opacity-80"
                  onClick={() => handleSessionImageClick(session.id, session.image_url)}
                />
                <div className="flex-1">
                  <p className="text-sm text-slate-500">
                    {new Date(session.created_at).toLocaleString('ko-KR', {
                      year: 'numeric',
                      month: 'long',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </p>
                  {session.problem_count === 0 ? (
                    <p className="text-orange-600 font-medium mt-1">
                      🔍 AI 분석 중... 잠시 후 새로고침해주세요
                    </p>
                  ) : (
                    <p className="text-slate-700 mt-1">
                      문제 {session.problem_count}개 | 정답 {session.correct_count}개 | 오답 {session.incorrect_count}개
                    </p>
                  )}
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
                </div>
              </div>
            ))}
            {displayedCount < sessions.length && (
              <div className="text-center pt-4">
                <button
                  onClick={() => setDisplayedCount(prev => Math.min(prev + 5, sessions.length))}
                  className="px-4 py-2 bg-slate-600 text-white text-sm rounded-lg hover:bg-slate-700"
                >
                  더보기 (5개)
                </button>
              </div>
            )}
          </div>
        )}
      </div>
      
      <ImageModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        imageUrl={modalImageUrl}
        sessionId={modalSessionId}
      />
    </div>
  );
};
