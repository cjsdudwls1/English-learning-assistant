import React, { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { createAssignment, fetchMyClasses, fetchClassMembers } from '../../services/db';
import { ProblemSelector } from './ProblemSelector';
import { TargetSelector } from './TargetSelector';
import type { ClassInfo, ClassMember } from '../../types';

export const AssignmentCreatePage: React.FC = () => {
  const navigate = useNavigate();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [selectedClassId, setSelectedClassId] = useState<string | null>(null);
  const [selectedProblemIds, setSelectedProblemIds] = useState<string[]>([]);
  const [selectedStudentIds, setSelectedStudentIds] = useState<string[]>([]);
  const [classes, setClasses] = useState<ClassInfo[]>([]);
  const [members, setMembers] = useState<ClassMember[]>([]);
  const [dueDate, setDueDate] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchMyClasses().then(setClasses).catch(() => {});
  }, []);

  useEffect(() => {
    if (!selectedClassId) { setMembers([]); return; }
    fetchClassMembers(selectedClassId).then((m) => {
      setMembers(m.filter((mb) => mb.role === 'student'));
    }).catch(() => {});
  }, [selectedClassId]);

  const handleCreate = async () => {
    if (!title.trim() || selectedProblemIds.length === 0 || selectedStudentIds.length === 0) {
      setError('제목, 문제, 대상 학생을 모두 선택해주세요.');
      return;
    }
    setCreating(true);
    setError(null);
    try {
      await createAssignment({
        title: title.trim(),
        description: description.trim() || null,
        classId: selectedClassId,
        problemIds: selectedProblemIds,
        studentIds: selectedStudentIds,
        dueDate: dueDate ? new Date(dueDate).toISOString() : null,
      });
      navigate('/teacher/dashboard');
    } catch (e) {
      setError(e instanceof Error ? e.message : '과제 생성에 실패했습니다.');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Link to="/teacher/dashboard" className="text-indigo-600 dark:text-indigo-400 hover:underline text-sm">&larr; 대시보드</Link>
        <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-200">과제 만들기</h1>
      </div>
      {error && <p className="text-red-500 text-sm">{error}</p>}

      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-5 space-y-4">
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="과제 제목" className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-sm" />
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="설명 (선택)" rows={2} className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-sm resize-none" />
        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">마감일 (선택)</label>
          <input type="datetime-local" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-sm" />
        </div>
      </div>

      <ProblemSelector selectedIds={selectedProblemIds} onSelect={setSelectedProblemIds} />

      <TargetSelector
        classes={classes}
        members={members}
        selectedClassId={selectedClassId}
        selectedStudentIds={selectedStudentIds}
        onSelectClass={setSelectedClassId}
        onSelectStudents={setSelectedStudentIds}
      />

      <button onClick={handleCreate} disabled={creating} className="w-full py-3 bg-indigo-600 text-white rounded-xl font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors">
        {creating ? '생성 중...' : `과제 생성 (${selectedProblemIds.length}문제 → ${selectedStudentIds.length}명)`}
      </button>
    </div>
  );
};
