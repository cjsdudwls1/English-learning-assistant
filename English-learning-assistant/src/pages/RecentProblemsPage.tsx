import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchUserSessions, deleteSession, fetchPendingLabelingSessions, fetchAnalyzingSessions, fetchFailedSessions } from '../services/db';
import { ImageModal } from '../components/ImageModal';
import { QuickLabelingCard } from '../components/QuickLabelingCard';
import { AnalyzingCard } from '../components/AnalyzingCard';
import type { SessionWithProblems } from '../types';
import { useLanguage } from '../contexts/LanguageContext';
import { getTranslation } from '../utils/translations';

export const RecentProblemsPage: React.FC = () => {
  const { language } = useLanguage();
  const t = getTranslation(language);
  const navigate = useNavigate();
  const [sessions, setSessions] = useState<SessionWithProblems[]>([]);
  const [analyzingSessions, setAnalyzingSessions] = useState<SessionWithProblems[]>([]);
  const [failedSessions, setFailedSessions] = useState<SessionWithProblems[]>([]);
  const [pendingLabelingSessions, setPendingLabelingSessions] = useState<SessionWithProblems[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [visibleSessionCount, setVisibleSessionCount] = useState(5);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalImageUrl, setModalImageUrl] = useState<string>('');
  const [modalSessionId, setModalSessionId] = useState<string>('');
  const [selectedSessions, setSelectedSessions] = useState<Set<string>>(new Set());
  const [pollingActive, setPollingActive] = useState(true);
  const lastAnalyzingSeenAtRef = useRef<number>(0);

  const loadData = async () => {
    try {
      setLoading(true);
      const sessionsData = await fetchUserSessions();
      setSessions(sessionsData);
      
      // 분석 중인 세션 조회
      const analyzing = await fetchAnalyzingSessions();
      setAnalyzingSessions(analyzing);

      // 분석 실패 세션 조회 (UI에 표시하지 않으면 사용자가 원인을 알 수 없음)
      const failed = await fetchFailedSessions();
      setFailedSessions(failed);
      
      // 라벨링이 필요한 세션 조회
      const pendingSessions = await fetchPendingLabelingSessions();
      setPendingLabelingSessions(pendingSessions);
      
      // 폴링 로직:
      // - analyzing/pending이 있으면 계속
      // - analyzing이 막 끝난 직후(=status가 processing->completed/failed로 바뀌는 순간)에는
      //   DB 반영/조인 조회 타이밍 때문에 pending/failed가 다음 틱에야 잡힐 수 있으므로,
      //   잠깐(예: 60초) 더 폴링을 유지해서 "아무 카드도 안 뜨는" 구간을 없앰.
      const now = Date.now();
      if (analyzing.length > 0) {
        lastAnalyzingSeenAtRef.current = now;
      }
      const recentlyHadAnalyzing = lastAnalyzingSeenAtRef.current > 0 && now - lastAnalyzingSeenAtRef.current < 60_000;
      setPollingActive(analyzing.length > 0 || pendingSessions.length > 0 || recentlyHadAnalyzing);
    } catch (e) {
      setError(e instanceof Error ? e.message : '조회 실패');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // 폴링 로직: 분석 중이거나 라벨링이 필요한 세션이 있으면 2초마다 상태 확인
  useEffect(() => {
    if (!pollingActive) return;
    
    const interval = setInterval(() => {
      loadData();
    }, 2000);
    
    return () => clearInterval(interval);
  }, [pollingActive]);

  const handleDelete = async (sessionId: string) => {
    const confirmMessage = language === 'ko' 
      ? '이 세션을 삭제하시겠습니까?'
      : 'Are you sure you want to delete this session?';
    if (!window.confirm(confirmMessage)) return;
    
    try {
      await deleteSession(sessionId);
      await loadData();
    } catch (e) {
      alert(e instanceof Error ? e.message : (language === 'ko' ? '삭제 실패' : 'Delete failed'));
    }
  };

  const handleBulkDelete = async () => {
    if (selectedSessions.size === 0) {
      alert(language === 'ko' ? '삭제할 항목을 선택해주세요.' : 'Please select items to delete.');
      return;
    }

    const confirmMessage = language === 'ko' 
      ? `${selectedSessions.size}개의 세션을 삭제하시겠습니까?`
      : `Are you sure you want to delete ${selectedSessions.size} session(s)?`;
    if (!window.confirm(confirmMessage)) return;

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

  const toggleSelectAll = () => {
    if (selectedSessions.size === sessions.length) {
      // 모든 항목이 선택되어 있으면 모두 해제
      setSelectedSessions(new Set());
    } else {
      // 모든 항목 선택 (보이지 않는 것 포함)
      setSelectedSessions(new Set(sessions.map(s => s.id)));
    }
  };

  const handleLabelingComplete = async () => {
    // 라벨링 완료 후 데이터 다시 로드
    await loadData();
  };

  const displayedSessions = useMemo(() => {
    return sessions.slice(0, visibleSessionCount);
  }, [sessions, visibleSessionCount]);

  if (loading && sessions.length === 0 && analyzingSessions.length === 0 && pendingLabelingSessions.length === 0 && failedSessions.length === 0) return <div className="text-center text-slate-600 py-10">{t.common.loading}</div>;
  if (error) return <div className="text-center text-red-700 py-10">{error}</div>;

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* 분석 중 UI - 최상단 */}
      {analyzingSessions.map((session) => (
        <AnalyzingCard
          key={session.id}
          sessionId={session.id}
          imageUrl={session.image_url}
          onDelete={handleDelete}
        />
      ))}

      {/* 분석 실패 UI - 분석 중 다음 */}
      {failedSessions.map((session) => (
        <div
          key={session.id}
          className="bg-white dark:bg-slate-800 rounded-2xl shadow-lg p-6 md:p-8 border border-red-200 dark:border-red-800 mb-6"
        >
          <div className="flex items-start gap-6">
            <img
              src={session.image_url}
              alt={language === 'ko' ? '문제 이미지' : 'Problem Image'}
              className="w-24 h-24 object-cover rounded border border-slate-300 dark:border-slate-600 flex-shrink-0"
            />
            <div className="flex-1">
              <h3 className="text-xl font-bold text-red-700 dark:text-red-300 mb-2">
                {language === 'ko' ? 'AI 분석 실패' : 'AI Analysis Failed'}
              </h3>
              <p className="text-slate-600 dark:text-slate-400">
                {language === 'ko'
                  ? '이미지에서 문제를 추출하지 못했습니다. (0문항) 이미지가 선명한지 확인 후 다시 업로드하거나, 해당 세션을 삭제해주세요.'
                  : 'Failed to extract problems from the image (0 items). Please re-upload with a clearer image or delete this session.'}
              </p>
              <div className="mt-4 flex gap-2 justify-end">
                <button
                  onClick={() => handleDelete(session.id)}
                  className="px-4 py-2 bg-red-600 text-white text-sm rounded-lg hover:bg-red-700"
                >
                  {language === 'ko' ? '삭제' : 'Delete'}
                </button>
              </div>
            </div>
          </div>
        </div>
      ))}

      {/* 라벨링 UI - 분석 중 다음 */}
      {pendingLabelingSessions.map((session) => (
        <QuickLabelingCard
          key={session.id}
          sessionId={session.id}
          imageUrl={session.image_url}
          analysisModel={session.analysis_model}
          onSave={handleLabelingComplete}
          onDelete={handleDelete}
        />
      ))}

      <div className="bg-white rounded-2xl shadow-lg p-6 md:p-8 border border-slate-200">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-2xl font-bold whitespace-nowrap">{t.recent.title}</h2>
          <div className="flex gap-2">
            <button
              onClick={toggleSelectAll}
              className="px-4 py-2 bg-gray-600 text-white text-sm rounded-lg hover:bg-gray-700"
            >
              {selectedSessions.size === sessions.length && sessions.length > 0 ? '전체 해제' : '전체 선택'}
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
          <p className="text-slate-500 text-center py-4">{t.recent.noProblems}</p>
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
                  alt={language === 'ko' ? '문제 이미지' : 'Problem Image'} 
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
                      {language === 'ko' ? '🔍 AI 분석 중... 잠시 후 새로고침해주세요' : '🔍 AI analyzing... Please refresh later'}
                    </p>
                  ) : (
                    <p className="text-slate-700 mt-1">
                      {language === 'ko' 
                        ? `문제 ${session.problem_count}개 | 정답 ${session.correct_count}개 | 오답 ${session.incorrect_count}개`
                        : `${t.recent.problemCount} ${session.problem_count} | ${t.stats.correct}: ${session.correct_count} | ${t.stats.incorrect}: ${session.incorrect_count}`}
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
                    {t.recent.viewDetails}
                  </button>
                </div>
              </div>
            ))}
            {visibleSessionCount < sessions.length && (
              <div className="text-center pt-4">
                <button
                  onClick={() => setVisibleSessionCount(prev => Math.min(prev + 5, sessions.length))}
                  className="px-4 py-2 bg-slate-600 text-white text-sm rounded-lg hover:bg-slate-700"
                >
                  {t.recent.loadMore} ({sessions.length - visibleSessionCount}{language === 'ko' ? '개' : ''})
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
