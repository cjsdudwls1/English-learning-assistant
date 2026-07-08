import React, { useState } from 'react';
import { addClassMember, removeClassMember, fetchClassMembers } from '../../services/db';
import type { ClassMember } from '../../types';
import { useLanguage } from '../../contexts/LanguageContext';
import { getTranslation } from '../../utils/translations';
import { translateError } from '../../utils/errorI18n';

interface Props {
  classId: string;
  members: ClassMember[];
  onUpdate: (members: ClassMember[]) => void;
  selectedStudentId?: string | null;
  onSelectStudent?: (userId: string, email?: string) => void;
}

export const MemberList: React.FC<Props> = ({ classId, members, onUpdate, selectedStudentId, onSelectStudent }) => {
  const { language } = useLanguage();
  const t = getTranslation(language);
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
      setError(translateError(e, language, t, t.teacher.addMemberFailed));
    } finally {
      setAdding(false);
    }
  };

  const handleRemove = async (userId: string) => {
    try {
      await removeClassMember(classId, userId);
      onUpdate(members.filter((m) => m.user_id !== userId));
    } catch {
      alert(t.teacher.removeMemberFailed);
    }
  };

  const teachers = members.filter((m) => m.role === 'teacher');
  const students = members.filter((m) => m.role === 'student');

  return (
    <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-5 space-y-4">
      <h3 className="text-lg font-bold text-slate-800 dark:text-slate-200">{t.teacher.membersCount.replace('{count}', String(members.length))}</h3>

      <div className="flex gap-2">
        <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t.teacher.addByEmailPlaceholder} className="flex-1 px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-sm" />
        <select value={role} onChange={(e) => setRole(e.target.value as 'teacher' | 'student')} className="px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-sm">
          <option value="student">{t.teacher.student}</option>
          <option value="teacher">{t.teacher.teacher}</option>
        </select>
        <button onClick={handleAdd} disabled={adding} className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm disabled:opacity-50">
          {adding ? '...' : t.teacher.add}
        </button>
      </div>
      {error && <p className="text-red-500 text-xs">{error}</p>}

      {teachers.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-slate-500 mb-2">{t.teacher.teachersCount.replace('{count}', String(teachers.length))}</p>
          {teachers.map((m) => (
            <MemberRow key={m.id} member={m} onRemove={handleRemove} isSelected={false} />
          ))}
        </div>
      )}
      <div>
        <p className="text-xs font-semibold text-slate-500 mb-2">{t.teacher.studentsCount.replace('{count}', String(students.length))}</p>
        {students.length === 0 ? (
          <p className="text-slate-400 text-xs py-2">{t.teacher.noStudents}</p>
        ) : (
          students.map((m) => (
            <MemberRow
              key={m.id}
              member={m}
              onRemove={handleRemove}
              isSelected={selectedStudentId === m.user_id}
              onSelect={onSelectStudent ? () => onSelectStudent(m.user_id, m.name || m.email) : undefined}
            />
          ))
        )}
      </div>
    </div>
  );
};

const MemberRow: React.FC<{
  member: ClassMember;
  onRemove: (userId: string) => void;
  isSelected?: boolean;
  onSelect?: () => void;
}> = ({ member, onRemove, isSelected, onSelect }) => {
  const { language } = useLanguage();
  const t = getTranslation(language);
  return (
  <div
    className={`flex items-center justify-between py-2 px-3 rounded-lg transition-colors ${
      isSelected
        ? 'bg-indigo-50 dark:bg-indigo-900/30 border border-indigo-200 dark:border-indigo-700'
        : 'hover:bg-slate-50 dark:hover:bg-slate-700/50'
    } ${onSelect ? 'cursor-pointer' : ''}`}
    onClick={onSelect}
  >
    <div className="flex items-center gap-2">
      <span className="text-sm text-slate-700 dark:text-slate-300">{member.name || member.email || member.user_id.slice(0, 8)}</span>
      {onSelect && (
        <span className="text-[10px] text-indigo-500 dark:text-indigo-400">
          {isSelected ? t.teacher.viewingStats : t.teacher.clickToViewStats}
        </span>
      )}
    </div>
    <button
      onClick={(e) => { e.stopPropagation(); onRemove(member.user_id); }}
      className="text-xs text-red-500 hover:underline"
    >
      {t.common.delete}
    </button>
  </div>
  );
};
