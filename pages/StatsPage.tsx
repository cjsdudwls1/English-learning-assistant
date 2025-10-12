import React, { useEffect, useMemo, useState } from 'react';
import { fetchStatsByType, TypeStatsRow } from '../services/stats';
import { makeCoachingMessage } from '../services/coaching';

export const StatsPage: React.FC = () => {
  const [rows, setRows] = useState<TypeStatsRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [coach, setCoach] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        const data = await fetchStatsByType();
        setRows(data);
        const msg = await makeCoachingMessage(data);
        setCoach(msg);
      } catch (e) {
        setError(e instanceof Error ? e.message : '통계 조회 실패');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const totals = useMemo(() => {
    const correct = rows.reduce((s, r) => s + (r.correct_count || 0), 0);
    const incorrect = rows.reduce((s, r) => s + (r.incorrect_count || 0), 0);
    const total = rows.reduce((s, r) => s + (r.total_count || 0), 0);
    return { correct, incorrect, total };
  }, [rows]);

  if (loading) return <div className="text-center text-slate-600 py-10">불러오는 중...</div>;
  if (error) return <div className="text-center text-red-700 py-10">{error}</div>;

  return (
    <div className="max-w-5xl mx-auto bg-white rounded-2xl shadow-lg p-6 md:p-8 border border-slate-200">
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
  );
};


