import React, { useEffect, useState } from 'react';
import { fetchDirectorOverview, fetchAllClasses, fetchClassAssignmentStats, fetchTeacherPerformances, fetchClassMembers, deleteClass, type DirectorOverview, type TeacherPerformance } from '../services/db';
import { AcademyOverviewCard } from '../components/director/AcademyOverviewCard';
import { DirectorClassStatsCard } from '../components/director/DirectorClassStatsCard';
import { TeacherPerformanceCard } from '../components/director/TeacherPerformanceCard';
import { StudentStatsPanel } from '../components/teacher/StudentStatsPanel';
import { HierarchicalStatsTable } from '../components/HierarchicalStatsTable';
import { fetchClassHierarchicalStats, type StatsNode } from '../services/stats';
import type { ClassInfo, ClassMember, MonthlyStats } from '../types';

export const DirectorDashboardPage: React.FC = () => {
  const [overview, setOverview] = useState<DirectorOverview | null>(null);
  const [classes, setClasses] = useState<ClassInfo[]>([]);
  const [selectedClassId, setSelectedClassId] = useState<string | null>(null);
  const [classStats, setClassStats] = useState<MonthlyStats[]>([]);
  const [year, setYear] = useState(new Date().getFullYear());
  const [teachers, setTeachers] = useState<TeacherPerformance[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 학생 목록 및 개별 통계
  const [students, setStudents] = useState<ClassMember[]>([]);
  const [selectedStudentId, setSelectedStudentId] = useState<string | null>(null);
  const [selectedStudentEmail, setSelectedStudentEmail] = useState<string | undefined>(undefined);

  // 학급 전체 택사노미 통계
  const [classTaxonomy, setClassTaxonomy] = useState<StatsNode[]>([]);
  const [showClassTaxonomy, setShowClassTaxonomy] = useState(false);
  const [taxonomyLoading, setTaxonomyLoading] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        const [o, c, t] = await Promise.all([fetchDirectorOverview(), fetchAllClasses(), fetchTeacherPerformances()]);
        setOverview(o);
        setClasses(c);
        setTeachers(t);
        if (c.length > 0) setSelectedClassId(c[0].id);
      } catch (e) {
        setError(e instanceof Error ? e.message : '데이터를 불러오지 못했습니다.');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  useEffect(() => {
    if (!selectedClassId) return;
    fetchClassAssignmentStats(selectedClassId, year)
      .then(setClassStats).catch((e) => setError(e instanceof Error ? e.message : '학급 통계를 불러오지 못했습니다.'));

    // 학급 학생 목록 로드
    fetchClassMembers(selectedClassId)
      .then((members) => setStudents(members.filter((m) => m.role === 'student')))
      .catch(() => setStudents([]));

    // 학급 변경 시 초기화
    setSelectedStudentId(null);
    setSelectedStudentEmail(undefined);
    setShowClassTaxonomy(false);
    setClassTaxonomy([]);
  }, [selectedClassId, year]);

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
    if (next && classTaxonomy.length === 0 && selectedClassId) {
      setTaxonomyLoading(true);
      fetchClassHierarchicalStats(selectedClassId)
        .then(setClassTaxonomy)
        .catch(() => setClassTaxonomy([]))
        .finally(() => setTaxonomyLoading(false));
    }
  };

  const handleDeleteClass = async (classId: string) => {
    try {
      await deleteClass(classId);
      setClasses(prev => prev.filter(c => c.id !== classId));
      setSelectedClassId(prevId => {
        if (prevId === classId) {
          const remaining = classes.filter(c => c.id !== classId);
          return remaining.length > 0 ? remaining[0].id : null;
        }
        return prevId;
      });
      // 통계 업데이트
      fetchDirectorOverview().then(setOverview).catch(console.error);
    } catch (e) {
      alert(e instanceof Error ? e.message : '학급 삭제에 실패했습니다.');
    }
  };

  if (loading) return <div className="text-center py-20 text-slate-500">불러오는 중...</div>;

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-200">학원장 대시보드</h1>
      {error && <p className="text-red-500 text-sm">{error}</p>}
      {overview && <AcademyOverviewCard overview={overview} />}
      <TeacherPerformanceCard teachers={teachers} />

      <DirectorClassStatsCard
        classes={classes}
        selectedClassId={selectedClassId}
        classStats={classStats}
        year={year}
        onSelectClass={setSelectedClassId}
        onYearChange={setYear}
        onDeleteClass={handleDeleteClass}
      />

      {/* 학급 전체 택사노미별 통계 */}
      {selectedClassId && (
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
      )}

      {/* 학급 내 학생 목록 및 개별 통계 */}
      {selectedClassId && students.length > 0 && (
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-5 space-y-3">
          <h3 className="text-lg font-bold text-slate-800 dark:text-slate-200">학생별 통계</h3>
          <p className="text-xs text-slate-500">학생을 클릭하여 개별 통계를 확인하세요.</p>
          <div className="space-y-1 max-h-48 overflow-y-auto">
            {students.map((s) => (
              <button
                key={s.user_id}
                onClick={() => handleSelectStudent(s.user_id, s.email)}
                className={`w-full text-left flex items-center justify-between py-2 px-3 rounded-lg text-sm transition-colors ${
                  selectedStudentId === s.user_id
                    ? 'bg-indigo-50 dark:bg-indigo-900/30 border border-indigo-200 dark:border-indigo-700 text-indigo-700 dark:text-indigo-300'
                    : 'hover:bg-slate-50 dark:hover:bg-slate-700/50 text-slate-700 dark:text-slate-300'
                }`}
              >
                <span>{s.email || s.user_id.slice(0, 8)}</span>
                <span className="text-[10px] text-indigo-500 dark:text-indigo-400">
                  {selectedStudentId === s.user_id ? '(보기 중)' : '통계 보기'}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {selectedStudentId && (
        <StudentStatsPanel
          studentId={selectedStudentId}
          studentEmail={selectedStudentEmail}
          onClose={() => { setSelectedStudentId(null); setSelectedStudentEmail(undefined); }}
        />
      )}
    </div>
  );
};
