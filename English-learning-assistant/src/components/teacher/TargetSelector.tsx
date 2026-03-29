import React from 'react';
import type { ClassInfo, ClassMember } from '../../types';

interface Props {
  classes: ClassInfo[];
  members: ClassMember[];
  selectedClassId: string | null;
  selectedStudentIds: string[];
  onSelectClass: (id: string | null) => void;
  onSelectStudents: (ids: string[]) => void;
}

export const TargetSelector: React.FC<Props> = ({ classes, members, selectedClassId, selectedStudentIds, onSelectClass, onSelectStudents }) => {
  const toggleStudent = (id: string) => {
    onSelectStudents(
      selectedStudentIds.includes(id)
        ? selectedStudentIds.filter((i) => i !== id)
        : [...selectedStudentIds, id]
    );
  };

  const selectAllStudents = () => {
    const allIds = members.map((m) => m.user_id);
    onSelectStudents(selectedStudentIds.length === allIds.length ? [] : allIds);
  };

  return (
    <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-5 space-y-3">
      <h3 className="text-lg font-bold text-slate-800 dark:text-slate-200">대상 선택</h3>

      <div>
        <label className="text-xs font-semibold text-slate-500 mb-1 block">학급 선택</label>
        <select
          value={selectedClassId ?? ''}
          onChange={(e) => {
            const v = e.target.value || null;
            onSelectClass(v);
            onSelectStudents([]);
          }}
          className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-sm"
        >
          <option value="">학급을 선택하세요</option>
          {classes.map((c) => (
            <option key={c.id} value={c.id}>{c.name} ({c.student_count ?? 0}명)</option>
          ))}
        </select>
      </div>

      {selectedClassId && members.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs font-semibold text-slate-500">학생 ({selectedStudentIds.length}/{members.length})</label>
            <button onClick={selectAllStudents} className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline">
              {selectedStudentIds.length === members.length ? '전체 해제' : '전체 선택'}
            </button>
          </div>
          <div className="max-h-40 overflow-y-auto space-y-1">
            {members.map((m) => (
              <label key={m.user_id} className={`flex items-center gap-3 p-2 rounded-lg cursor-pointer ${selectedStudentIds.includes(m.user_id) ? 'bg-indigo-50 dark:bg-indigo-900/20' : 'hover:bg-slate-50 dark:hover:bg-slate-700/50'}`}>
                <input type="checkbox" checked={selectedStudentIds.includes(m.user_id)} onChange={() => toggleStudent(m.user_id)} className="rounded border-slate-300" />
                <span className="text-sm text-slate-700 dark:text-slate-300">{m.email || m.user_id.slice(0, 8)}</span>
              </label>
            ))}
          </div>
        </div>
      )}

      {selectedClassId && members.length === 0 && (
        <p className="text-slate-400 text-xs py-2">이 학급에 학생이 없습니다.</p>
      )}
    </div>
  );
};
