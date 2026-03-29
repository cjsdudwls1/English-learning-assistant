import React, { useState } from 'react';
import { addClassMember, removeClassMember, fetchClassMembers } from '../../services/db';
import type { ClassMember } from '../../types';

interface Props {
  classId: string;
  members: ClassMember[];
  onUpdate: (members: ClassMember[]) => void;
}

export const MemberList: React.FC<Props> = ({ classId, members, onUpdate }) => {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'teacher' | 'student'>('student');
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleAdd = async () => {
    if (!email.trim()) return;
    setAdding(true);
    setError(null);
    try {
      await addClassMember(classId, email.trim(), role);
      const updated = await fetchClassMembers(classId);
      onUpdate(updated);
      setEmail('');
    } catch (e) {
      setError(e instanceof Error ? e.message : '멤버 추가에 실패했습니다.');
    } finally {
      setAdding(false);
    }
  };

  const handleRemove = async (userId: string) => {
    try {
      await removeClassMember(classId, userId);
      onUpdate(members.filter((m) => m.user_id !== userId));
    } catch {
      alert('멤버 삭제에 실패했습니다.');
    }
  };

  const teachers = members.filter((m) => m.role === 'teacher');
  const students = members.filter((m) => m.role === 'student');

  return (
    <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-5 space-y-4">
      <h3 className="text-lg font-bold text-slate-800 dark:text-slate-200">멤버 ({members.length}명)</h3>

      <div className="flex gap-2">
        <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="이메일로 추가" className="flex-1 px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-sm" />
        <select value={role} onChange={(e) => setRole(e.target.value as 'teacher' | 'student')} className="px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-sm">
          <option value="student">학생</option>
          <option value="teacher">선생님</option>
        </select>
        <button onClick={handleAdd} disabled={adding} className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm disabled:opacity-50">
          {adding ? '...' : '추가'}
        </button>
      </div>
      {error && <p className="text-red-500 text-xs">{error}</p>}

      {teachers.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-slate-500 mb-2">선생님 ({teachers.length})</p>
          {teachers.map((m) => (
            <MemberRow key={m.id} member={m} onRemove={handleRemove} />
          ))}
        </div>
      )}
      <div>
        <p className="text-xs font-semibold text-slate-500 mb-2">학생 ({students.length})</p>
        {students.length === 0 ? (
          <p className="text-slate-400 text-xs py-2">학생이 없습니다.</p>
        ) : (
          students.map((m) => <MemberRow key={m.id} member={m} onRemove={handleRemove} />)
        )}
      </div>
    </div>
  );
};

const MemberRow: React.FC<{ member: ClassMember; onRemove: (userId: string) => void }> = ({ member, onRemove }) => (
  <div className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700/50">
    <span className="text-sm text-slate-700 dark:text-slate-300">{member.email || member.user_id.slice(0, 8)}</span>
    <button onClick={() => onRemove(member.user_id)} className="text-xs text-red-500 hover:underline">삭제</button>
  </div>
);
