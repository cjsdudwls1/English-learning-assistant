import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { fetchClassMembers, fetchClassAssignmentStats } from '../../services/db';
import { fetchClassHierarchicalStats, type StatsNode } from '../../services/stats';
import { MemberList } from './MemberList';
import { ClassStatsCard } from './ClassStatsCard';
import { StudentStatsPanel } from './StudentStatsPanel';
import { HierarchicalStatsTable } from '../HierarchicalStatsTable';
import type { ClassMember, MonthlyStats } from '../../types';

export const ClassDetailPage: React.FC = () => {
  const { classId } = useParams<{ classId: string }>();
  const [members, setMembers] = useState<ClassMember[]>([]);
  const [stats, setStats] = useState<MonthlyStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [year, setYear] = useState(new Date().getFullYear());
  const [selectedStudentId, setSelectedStudentId] = useState<string | null>(null);
  const [selectedStudentEmail, setSelectedStudentEmail] = useState<string | undefined>(undefined);
  const [classTaxonomy, setClassTaxonomy] = useState<StatsNode[]>([]);
  const [showClassTaxonomy, setShowClassTaxonomy] = useState(false);
  const [taxonomyLoading, setTaxonomyLoading] = useState(false);

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

  const handleSelectStudent = (userId: string, email?: string) => {
    if (selectedStudentId === userId) {
      setSelectedStudentId(null);
      setSelectedStudentEmail(undefined);
    } else {
      setSelectedStudentId(userId);
      setSelectedStudentEmail(email);
    }
  };

  const handleToggleClassTaxonomy = () => {
    const next = !showClassTaxonomy;
    setShowClassTaxonomy(next);
    if (next && classTaxonomy.length === 0 && classId) {
      setTaxonomyLoading(true);
      fetchClassHierarchicalStats(classId)
        .then(setClassTaxonomy)
        .catch(() => setClassTaxonomy([]))
        .finally(() => setTaxonomyLoading(false));
    }
  };

  if (loading) return <div className="text-center py-20 text-slate-500">불러오는 중...</div>;

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Link to="/teacher/dashboard" className="text-indigo-600 dark:text-indigo-400 hover:underline text-sm">&larr; 대시보드</Link>
        <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-200">학급 상세</h1>
      </div>
      {error && <p className="text-red-500 text-sm">{error}</p>}
      <MemberList
        classId={classId!}
        members={members}
        onUpdate={setMembers}
        selectedStudentId={selectedStudentId}
        onSelectStudent={handleSelectStudent}
      />

      {/* 개별 학생 통계 패널 */}
      {selectedStudentId && (
        <StudentStatsPanel
          studentId={selectedStudentId}
          studentEmail={selectedStudentEmail}
          onClose={() => { setSelectedStudentId(null); setSelectedStudentEmail(undefined); }}
        />
      )}

      <ClassStatsCard monthlyStats={stats} year={year} onYearChange={setYear} />

      {/* 학급 전체 택사노미별 통계 */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-5 space-y-4">
        <button
          onClick={handleToggleClassTaxonomy}
          className="flex items-center gap-2 text-sm font-bold text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-300 transition-colors"
        >
          <span>{showClassTaxonomy ? '\u25BC' : '\u25B6'}</span>
          학급 전체 문제 유형(택사노미)별 통계
        </button>

        {showClassTaxonomy && (
          <div className="mt-3">
            {taxonomyLoading ? (
              <p className="text-sm text-slate-500 py-4 text-center">택사노미 통계 불러오는 중...</p>
            ) : classTaxonomy.length === 0 ? (
              <p className="text-sm text-slate-400 py-4 text-center">택사노미 통계 데이터가 없습니다.</p>
            ) : (
              <HierarchicalStatsTable data={classTaxonomy} />
            )}
          </div>
        )}
      </div>
    </div>
  );
};
