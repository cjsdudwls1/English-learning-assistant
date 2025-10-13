import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchStatsByType, TypeStatsRow } from '../services/stats';
import { makeCoachingMessage } from '../services/coaching';
import { fetchUserSessions, deleteSession } from '../services/db';
import type { SessionWithProblems } from '../types';

export const StatsPage: React.FC = () => {
  const navigate = useNavigate();
  const [rows, setRows] = useState<TypeStatsRow[]>([]);
  const [sessions, setSessions] = useState<SessionWithProblems[]>([]);
  const [loading, setLoading] = useState(true);
  const [coach, setCoach] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  const loadData = async () => {
    try {
      setLoading(true);
      const [statsData, sessionsData] = await Promise.all([
        fetchStatsByType(),
        fetchUserSessions(),
      ]);
      setRows(statsData);
      setSessions(sessionsData);
      const msg = await makeCoachingMessage(statsData);
      setCoach(msg);
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

  if (loading) return <div className="text-center text-slate-600 py-10">불러오는 중...</div>;
  if (error) return <div className="text-center text-red-700 py-10">{error}</div>;

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* 최근 업로드한 문제 목록 */}
      <div className="bg-white rounded-2xl shadow-lg p-6 md:p-8 border border-slate-200">
        <h2 className="text-2xl font-bold mb-4">최근 업로드한 문제</h2>
        {sessions.length === 0 ? (
          <p className="text-slate-500 text-center py-4">아직 업로드한 문제가 없습니다.</p>
        ) : (
          <div className="space-y-3">
            {sessions.map((session) => (
              <div key={session.id} className="border border-slate-200 rounded-lg p-4 flex items-center gap-4">
                <img 
                  src={session.image_url} 
                  alt="문제 이미지" 
                  className="w-20 h-20 object-cover rounded border"
                />
                <div className="flex-1">
                  <p className="text-sm text-slate-500">
                    {new Date(session.created_at).toLocaleString('ko-KR')}
                  </p>
                  <p className="text-slate-700 mt-1">
                    문제 {session.problem_count}개 | 정답 {session.correct_count}개 | 오답 {session.incorrect_count}개
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => navigate(`/edit/${session.id}`)}
                    className="px-4 py-2 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700"
                  >
                    수정
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
          </div>
        )}
      </div>

      {/* 유형별 통계 */}
      <div className="bg-white rounded-2xl shadow-lg p-6 md:p-8 border border-slate-200">
        <h2 className="text-2xl font-bold mb-4">유형별 정오답 통계</h2>
        <div className="mb-4 text-slate-700">전체: {totals.total} / 정답: {totals.correct} / 오답: {totals.incorrect}</div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-100">
                <th className="p-2">1Depth</th>
                <th className="p-2">2Depth</th>
                <th className="p-2">3Depth</th>
                <th className="p-2">4Depth</th>
                <th className="p-2">정답</th>
                <th className="p-2">오답</th>
                <th className="p-2">총합</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-b">
                  <td className="p-2">{r.depth1 ?? '-'}</td>
                  <td className="p-2">{r.depth2 ?? '-'}</td>
                  <td className="p-2">{r.depth3 ?? '-'}</td>
                  <td className="p-2">{r.depth4 ?? '-'}</td>
                  <td className="p-2">{r.correct_count}</td>
                  <td className="p-2">{r.incorrect_count}</td>
                  <td className="p-2">{r.total_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-8 p-4 bg-indigo-50 border border-indigo-200 rounded">
          <h3 className="text-lg font-bold text-indigo-700 mb-2">개인화 코칭</h3>
          <p className="whitespace-pre-wrap text-slate-800">{coach}</p>
        </div>
      </div>
    </div>
  );
};


