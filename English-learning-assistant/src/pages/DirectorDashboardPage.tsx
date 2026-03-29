import React, { useEffect, useState } from 'react';
import { fetchDirectorOverview, fetchMyClasses, fetchClassAssignmentStats, fetchTeacherPerformances, type DirectorOverview, type TeacherPerformance } from '../services/db';
import { AcademyOverviewCard } from '../components/director/AcademyOverviewCard';
import { DirectorClassStatsCard } from '../components/director/DirectorClassStatsCard';
import { TeacherPerformanceCard } from '../components/director/TeacherPerformanceCard';
import type { ClassInfo, MonthlyStats } from '../types';

export const DirectorDashboardPage: React.FC = () => {
  const [overview, setOverview] = useState<DirectorOverview | null>(null);
  const [classes, setClasses] = useState<ClassInfo[]>([]);
  const [selectedClassId, setSelectedClassId] = useState<string | null>(null);
  const [classStats, setClassStats] = useState<MonthlyStats[]>([]);
  const [year, setYear] = useState(new Date().getFullYear());
  const [teachers, setTeachers] = useState<TeacherPerformance[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const [o, c, t] = await Promise.all([fetchDirectorOverview(), fetchMyClasses(), fetchTeacherPerformances()]);
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
  }, [selectedClassId, year]);

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
      />
    </div>
  );
};
