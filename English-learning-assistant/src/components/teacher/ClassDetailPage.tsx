import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { fetchClassMembers, fetchClassAssignmentStats } from '../../services/db';
import { MemberList } from './MemberList';
import { ClassStatsCard } from './ClassStatsCard';
import type { ClassMember, MonthlyStats } from '../../types';

export const ClassDetailPage: React.FC = () => {
  const { classId } = useParams<{ classId: string }>();
  const [members, setMembers] = useState<ClassMember[]>([]);
  const [stats, setStats] = useState<MonthlyStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [year, setYear] = useState(new Date().getFullYear());

  useEffect(() => {
    if (!classId) return;
    const load = async () => {
      try {
        const [m, s] = await Promise.all([
          fetchClassMembers(classId),
          fetchClassAssignmentStats(classId, year),
        ]);
        setMembers(m);
        setStats(s);
      } catch (e) {
        setError(e instanceof Error ? e.message : '오류가 발생했습니다.');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [classId, year]);

  if (loading) return <div className="text-center py-20 text-slate-500">불러오는 중...</div>;

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Link to="/teacher/dashboard" className="text-indigo-600 dark:text-indigo-400 hover:underline text-sm">&larr; 대시보드</Link>
        <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-200">학급 상세</h1>
      </div>
      {error && <p className="text-red-500 text-sm">{error}</p>}
      <MemberList classId={classId!} members={members} onUpdate={setMembers} />
      <ClassStatsCard monthlyStats={stats} year={year} onYearChange={setYear} />
    </div>
  );
};
