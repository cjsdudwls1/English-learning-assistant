import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchMyClasses, fetchMyAssignments, deleteClass } from '../services/db';
import type { ClassInfo, SharedAssignment } from '../types';
import { ClassListCard } from '../components/teacher/ClassListCard';
import { useLanguage } from '../contexts/LanguageContext';
import { getTranslation } from '../utils/translations';
import { translateError } from '../utils/errorI18n';

export const TeacherDashboardPage: React.FC = () => {
  const { language } = useLanguage();
  const t = getTranslation(language);
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
        // 서비스 레이어 한글 throw가 en 모드에 누출되지 않도록 번역/차단(fallback=원시 메시지)
        const rawMsg = e instanceof Error ? e.message : (e as any)?.message || JSON.stringify(e);
        const errMsg = translateError(e, language, t, rawMsg);
        setError(t.errors.loadDataError.replace('{message}', errMsg));
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  if (loading) {
    return <div className="text-center py-20 text-slate-500">{t.common.loading}</div>;
  }

  const handleDeleteClass = async (classId: string) => {
    if (!window.confirm(t.teacher.deleteClassConfirm)) return;
    try {
      await deleteClass(classId);
      setClasses(prev => prev.filter(c => c.id !== classId));
    } catch (e) {
      alert(translateError(e, language, t, t.errors.deleteClassFailed));
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-200">{t.teacher.dashboardTitle}</h1>
        <Link to="/teacher/assignments/create" className="px-4 py-2 bg-indigo-600 text-white rounded-xl text-sm font-medium hover:bg-indigo-700 transition-colors">
          + {t.teacher.createAssignment}
        </Link>
      </div>
      {error && <p className="text-red-500 text-sm">{error}</p>}

      <ClassListCard classes={classes} onDeleteClass={handleDeleteClass} />

      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-5">
        <h2 className="text-lg font-bold text-slate-800 dark:text-slate-200 mb-4">{t.teacher.recentAssignments}</h2>
        {assignments.length === 0 ? (
          <p className="text-slate-400 text-sm py-4 text-center">{t.teacher.noAssignments}</p>
        ) : (
          <div className="space-y-2">
            {assignments.slice(0, 5).map((a) => (
              <Link to={`/teacher/assignments/${a.id}`} key={a.id} className="flex items-center justify-between p-3 rounded-xl bg-slate-50 dark:bg-slate-700/50 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors">
                <div>
                  <p className="font-medium text-slate-800 dark:text-slate-200">{a.title}</p>
                  <p className="text-xs text-slate-500">{new Date(a.created_at).toLocaleDateString(language === 'ko' ? 'ko-KR' : 'en-US')} · {t.teacher.problemUnit.replace('{count}', String(a.problem_count ?? 0))} · {t.teacher.responseUnit.replace('{count}', String(a.completed_count ?? 0))}</p>
                </div>
                {a.due_date && (
                  <span className="text-xs text-orange-500">{t.teacher.dueDate.replace('{date}', new Date(a.due_date).toLocaleDateString(language === 'ko' ? 'ko-KR' : 'en-US'))}</span>
                )}
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
