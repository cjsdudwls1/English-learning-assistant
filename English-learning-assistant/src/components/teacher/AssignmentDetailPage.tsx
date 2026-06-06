import React, { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { fetchAssignmentProblems, fetchAssignmentResponses, deleteAssignment } from '../../services/db';
import { AssignmentResponseTable } from './AssignmentResponseTable';
import { useLanguage } from '../../contexts/LanguageContext';
import { getTranslation } from '../../utils/translations';
import type { AssignmentResponse } from '../../types';

type AssignmentProblem = Awaited<ReturnType<typeof fetchAssignmentProblems>>[number];

export const AssignmentDetailPage: React.FC = () => {
  const { language } = useLanguage();
  const t = getTranslation(language);
  const { assignmentId } = useParams<{ assignmentId: string }>();
  const navigate = useNavigate();
  const [problems, setProblems] = useState<AssignmentProblem[]>([]);
  const [responses, setResponses] = useState<AssignmentResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!assignmentId) return;
    Promise.all([
      fetchAssignmentProblems(assignmentId),
      fetchAssignmentResponses(assignmentId),
    ]).then(([p, r]) => {
      setProblems(p);
      setResponses(r);
    }).catch(() => {})
      .finally(() => setLoading(false));
  }, [assignmentId]);

  const handleDelete = async () => {
    if (!assignmentId || !confirm(t.assignments.deleteConfirm)) return;
    setDeleting(true);
    try {
      await deleteAssignment(assignmentId);
      navigate('/teacher/dashboard');
    } catch {
      alert(t.errors.deleteFailed);
      setDeleting(false);
    }
  };

  if (loading) return <div className="text-center py-20 text-slate-500">{t.common.loading}</div>;

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link to="/teacher/dashboard" className="text-indigo-600 dark:text-indigo-400 hover:underline text-sm">&larr; {t.teacher.dashboard}</Link>
          <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-200">{t.assignments.detailTitle}</h1>
        </div>
        <button onClick={handleDelete} disabled={deleting}
          className="px-4 py-2 bg-red-500 text-white rounded-xl text-sm hover:bg-red-600 disabled:opacity-50">
          {deleting ? t.teacher.deleting : t.assignments.delete}
        </button>
      </div>
      <p className="text-sm text-slate-500">{language === 'ko' ? `문제 ${problems.length}개 · 응답 ${responses.length}건` : `${problems.length} problems · ${responses.length} responses`}</p>
      <AssignmentResponseTable problems={problems} responses={responses} />
    </div>
  );
};
