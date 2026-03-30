import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchMyClasses, fetchMyAssignments, deleteClass } from '../services/db';
import type { ClassInfo, SharedAssignment } from '../types';
import { ClassListCard } from '../components/teacher/ClassListCard';

export const TeacherDashboardPage: React.FC = () => {
  const [classes, setClasses] = useState<ClassInfo[]>([]);
  const [assignments, setAssignments] = useState<SharedAssignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const [c, a] = await Promise.all([fetchMyClasses(), fetchMyAssignments()]);
        setClasses(c);
        setAssignments(a);
      } catch (e) {
        console.error("Dashboard Load Error:", e);
        const errMsg = e instanceof Error ? e.message : (e as any)?.message || JSON.stringify(e);
        setError(`데이터를 불러오는 중 오류가 발생했습니다: ${errMsg}`);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  if (loading) {
    return <div className="text-center py-20 text-slate-500">불러오는 중...</div>;
  }

  const handleDeleteClass = async (classId: string) => {
    if (!window.confirm("정말로 이 학급을 삭제하시겠습니까? 관련 데이터가 모두 삭제됩니다.")) return;
    try {
      await deleteClass(classId);
      setClasses(prev => prev.filter(c => c.id !== classId));
    } catch (e) {
      alert(e instanceof Error ? e.message : '학급 삭제에 실패했습니다.');
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-200">선생님 대시보드</h1>
        <Link to="/teacher/assignments/create" className="px-4 py-2 bg-indigo-600 text-white rounded-xl text-sm font-medium hover:bg-indigo-700 transition-colors">
          + 과제 만들기
        </Link>
      </div>
      {error && <p className="text-red-500 text-sm">{error}</p>}

      <ClassListCard classes={classes} onDeleteClass={handleDeleteClass} />

      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-5">
        <h2 className="text-lg font-bold text-slate-800 dark:text-slate-200 mb-4">최근 과제</h2>
        {assignments.length === 0 ? (
          <p className="text-slate-400 text-sm py-4 text-center">아직 생성한 과제가 없습니다.</p>
        ) : (
          <div className="space-y-2">
            {assignments.slice(0, 5).map((a) => (
              <Link to={`/teacher/assignments/${a.id}`} key={a.id} className="flex items-center justify-between p-3 rounded-xl bg-slate-50 dark:bg-slate-700/50 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors">
                <div>
                  <p className="font-medium text-slate-800 dark:text-slate-200">{a.title}</p>
                  <p className="text-xs text-slate-500">{new Date(a.created_at).toLocaleDateString('ko-KR')} · {a.problem_count ?? 0}문제 · {a.completed_count ?? 0}응답</p>
                </div>
                {a.due_date && (
                  <span className="text-xs text-orange-500">마감: {new Date(a.due_date).toLocaleDateString('ko-KR')}</span>
                )}
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
