import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { createClass } from '../../services/db';
import type { ClassInfo } from '../../types';

interface Props {
  classes: ClassInfo[];
  onDeleteClass?: (classId: string) => void;
}

export const ClassListCard: React.FC<Props> = ({ classes: initialClasses, onDeleteClass }) => {
  const [classes, setClasses] = useState(initialClasses);
  
  React.useEffect(() => {
    setClasses(initialClasses);
  }, [initialClasses]);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [creating, setCreating] = useState(false);

  const handleCreate = async () => {
    if (!name.trim()) return;
    setCreating(true);
    try {
      const id = await createClass(name.trim(), desc.trim() || null);
      setClasses((prev) => [{ id, name: name.trim(), description: desc.trim() || null, created_by: '', created_at: new Date().toISOString(), member_count: 0, student_count: 0 }, ...prev]);
      setName('');
      setDesc('');
      setShowForm(false);
    } catch {
      alert('학급 생성에 실패했습니다.');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-bold text-slate-800 dark:text-slate-200">내 학급</h2>
        <button onClick={() => setShowForm(!showForm)} className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline">
          {showForm ? '취소' : '+ 학급 추가'}
        </button>
      </div>

      {showForm && (
        <div className="mb-4 p-4 rounded-xl bg-slate-50 dark:bg-slate-700/50 space-y-2">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="학급 이름" className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-sm" />
          <input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="설명 (선택)" className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-sm" />
          <button onClick={handleCreate} disabled={creating || !name.trim()} className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm disabled:opacity-50">
            {creating ? '생성 중...' : '생성'}
          </button>
        </div>
      )}

      {classes.length === 0 ? (
        <p className="text-slate-400 text-sm py-4 text-center">학급이 없습니다. 학급을 추가하세요.</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {classes.map((cls) => (
            <Link key={cls.id} to={`/teacher/classes/${cls.id}`} className="block p-4 rounded-xl bg-slate-50 dark:bg-slate-700/50 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors">
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-semibold text-slate-800 dark:text-slate-200">{cls.name}</p>
                  {cls.description && <p className="text-xs text-slate-500 mt-1">{cls.description}</p>}
                </div>
                {onDeleteClass && (
                  <button
                    onClick={(e) => {
                      e.preventDefault();
                      onDeleteClass(cls.id);
                    }}
                    className="p-1.5 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 rounded-lg transition-colors"
                    title="학급 삭제"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                )}
              </div>
              <div className="flex gap-3 mt-2 text-xs text-slate-500">
                <span>학생 {cls.student_count ?? 0}명</span>
                <span>전체 {cls.member_count ?? 0}명</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
};
