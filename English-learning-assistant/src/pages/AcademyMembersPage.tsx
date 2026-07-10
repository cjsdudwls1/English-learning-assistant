import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  fetchAcademyById,
  fetchAcademyMembers,
  addAcademyMember,
  removeAcademyMember,
  searchUserByEmail,
  type AcademyMember,
} from '../services/db/academies';
import { fetchAllClasses, fetchClassMembers, addClassMember, removeClassMember } from '../services/db/classes';
import type { ClassInfo, ClassMember } from '../types';
import { useLanguage } from '../contexts/LanguageContext';
import { getTranslation, type Translations } from '../utils/translations';
import { translateError } from '../utils/errorI18n';

type MemberRole = 'director' | 'teacher' | 'student';

// 역할 라벨을 번역 객체에서 조회 (모듈 상수 → 함수화: useLanguage 접근을 위해)
const roleLabel = (t: Translations, role: MemberRole): string => {
  if (role === 'director') return t.academy.roleDirector;
  if (role === 'teacher') return t.academy.roleTeacher;
  return t.academy.roleStudent;
};

export const AcademyMembersPage: React.FC = () => {
  const { id: academyId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { language } = useLanguage();
  const t = getTranslation(language);

  const [academyName, setAcademyName] = useState('');
  const [members, setMembers] = useState<AcademyMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [searchEmail, setSearchEmail] = useState('');
  const [addingRole, setAddingRole] = useState<MemberRole>('student');
  const [adding, setAdding] = useState(false);

  const [classes, setClasses] = useState<ClassInfo[]>([]);
  const [selectedClassId, setSelectedClassId] = useState<string | null>(null);
  const [classMembers, setClassMembers] = useState<ClassMember[]>([]);
  const [classMemberAddEmail, setClassMemberAddEmail] = useState('');
  const [classMemberAddRole, setClassMemberAddRole] = useState<'teacher' | 'student'>('student');
  const [classBusy, setClassBusy] = useState(false);

  const loadMembers = async () => {
    if (!academyId) return;
    setLoading(true);
    try {
      const [academy, mems, allClasses] = await Promise.all([
        fetchAcademyById(academyId),
        fetchAcademyMembers(academyId),
        fetchAllClasses(),
      ]);
      if (academy) setAcademyName(academy.name);
      setMembers(mems);
      const academyClasses = allClasses.filter(c => c.academy_id === academyId);
      setClasses(academyClasses);
      if (academyClasses.length > 0 && !selectedClassId) {
        setSelectedClassId(academyClasses[0].id);
      }
    } catch (e) {
      setError(translateError(e, language, t, t.academy.loadError));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadMembers();
  }, [academyId]);

  useEffect(() => {
    if (!selectedClassId) {
      setClassMembers([]);
      return;
    }
    fetchClassMembers(selectedClassId)
      .then(setClassMembers)
      .catch((e) => { setClassMembers([]); setError(translateError(e, language, t, t.academy.loadError)); });
  }, [selectedClassId]);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!academyId || !searchEmail.trim()) return;
    setAdding(true);
    setError(null);
    setMessage(null);
    try {
      const user = await searchUserByEmail(searchEmail.trim());
      if (!user) throw new Error(t.academy.userNotFound);
      if (members.some(m => m.user_id === user.user_id && m.role === addingRole)) {
        throw new Error(t.academy.alreadyMember);
      }
      await addAcademyMember(academyId, user.user_id, addingRole);
      setMessage(t.academy.addedMember.replace('{email}', user.email).replace('{role}', roleLabel(t, addingRole)));
      setSearchEmail('');
      await loadMembers();
    } catch (e) {
      setError(translateError(e, language, t, t.academy.addFailed));
    } finally {
      setAdding(false);
    }
  };

  const handleRemove = async (userId: string, role: MemberRole, email: string) => {
    if (!academyId) return;
    if (!confirm(t.academy.removeConfirm.replace('{target}', email || userId).replace('{role}', roleLabel(t, role)))) return;
    setError(null);
    setMessage(null);
    try {
      await removeAcademyMember(academyId, userId, role);
      setMessage(t.academy.removedMember.replace('{target}', email || userId));
      await loadMembers();
    } catch (e) {
      setError(translateError(e, language, t, t.academy.removeFailed));
    }
  };

  const handleAddClassMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedClassId || !classMemberAddEmail.trim()) return;
    setClassBusy(true);
    setError(null);
    setMessage(null);
    try {
      await addClassMember(selectedClassId, classMemberAddEmail.trim(), classMemberAddRole);
      setMessage(t.academy.addedToClass.replace('{email}', classMemberAddEmail.trim()));
      setClassMemberAddEmail('');
      const updated = await fetchClassMembers(selectedClassId);
      setClassMembers(updated);
    } catch (e) {
      setError(translateError(e, language, t, t.academy.addToClassFailed));
    } finally {
      setClassBusy(false);
    }
  };

  const handleRemoveClassMember = async (userId: string, email: string) => {
    if (!selectedClassId) return;
    if (!confirm(t.academy.removeFromClassConfirm.replace('{target}', email || userId))) return;
    setError(null);
    setMessage(null);
    try {
      await removeClassMember(selectedClassId, userId);
      const updated = await fetchClassMembers(selectedClassId);
      setClassMembers(updated);
      setMessage(t.academy.removedFromClass);
    } catch (e) {
      setError(translateError(e, language, t, t.academy.removeFromClassFailed));
    }
  };

  const grouped: Record<MemberRole, AcademyMember[]> = {
    director: members.filter(m => m.role === 'director'),
    teacher: members.filter(m => m.role === 'teacher'),
    student: members.filter(m => m.role === 'student'),
  };

  if (loading) return <div className="text-center py-20 text-slate-500">{t.common.loading}</div>;

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-200">{t.academy.membersTitle}</h1>
          {academyName && <p className="text-sm text-slate-500 mt-0.5">{academyName}</p>}
        </div>
        <button
          type="button"
          onClick={() => navigate('/academies')}
          className="text-sm text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 underline"
        >
          {t.academy.back}
        </button>
      </div>

      {error && (
        <div className="p-3 bg-red-100 dark:bg-red-900/30 border border-red-300 dark:border-red-800 text-red-800 dark:text-red-200 rounded text-sm">
          {error}
        </div>
      )}
      {message && (
        <div className="p-3 bg-green-100 dark:bg-green-900/30 border border-green-300 dark:border-green-800 text-green-800 dark:text-green-200 rounded text-sm">
          {message}
        </div>
      )}

      {/* 학원 멤버 추가 */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-6">
        <h2 className="text-base font-semibold text-slate-800 dark:text-slate-200 mb-4">{t.academy.addMember}</h2>
        <form onSubmit={handleAdd} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
              {t.academy.email} <span className="text-red-500">*</span>
            </label>
            <input
              type="email"
              value={searchEmail}
              onChange={e => setSearchEmail(e.target.value)}
              placeholder={t.academy.emailPlaceholder}
              required
              className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-200 focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">{t.academy.role}</label>
            <div className="flex gap-2">
              {(['director', 'teacher', 'student'] as MemberRole[]).map(r => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setAddingRole(r)}
                  className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                    addingRole === r
                      ? 'bg-indigo-600 text-white'
                      : 'bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600'
                  }`}
                >
                  {roleLabel(t, r)}
                </button>
              ))}
            </div>
          </div>
          <button
            type="submit"
            disabled={adding || !searchEmail.trim()}
            className="w-full px-6 py-3 bg-indigo-600 text-white rounded-lg font-semibold hover:bg-indigo-700 disabled:opacity-50 transition-colors"
          >
            {adding ? t.academy.adding : t.academy.addToAcademy}
          </button>
        </form>
      </div>

      {/* 멤버 목록 (역할별) */}
      {(['director', 'teacher', 'student'] as MemberRole[]).map(role => (
        <div key={role} className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-6">
          <h2 className="text-base font-semibold text-slate-800 dark:text-slate-200 mb-3">
            {roleLabel(t, role)} <span className="text-sm text-slate-400 ml-1">({t.academy.peopleCount.replace('{count}', String(grouped[role].length))})</span>
          </h2>
          {grouped[role].length === 0 ? (
            <p className="text-sm text-slate-400 py-2 text-center">{t.academy.none}</p>
          ) : (
            <div className="space-y-1.5">
              {grouped[role].map(m => (
                <div key={`${m.role}-${m.user_id}`} className="flex items-center justify-between py-2 px-3 rounded-lg bg-slate-50 dark:bg-slate-700/50">
                  <span className="text-sm text-slate-800 dark:text-slate-200">{m.email || m.user_id.slice(0, 8)}</span>
                  <button
                    onClick={() => handleRemove(m.user_id, m.role, m.email)}
                    className="text-xs text-red-500 hover:text-red-700 px-2 py-1"
                  >
                    {t.academy.remove}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}

      {/* 반 배정 */}
      {classes.length > 0 && (
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-6 space-y-4">
          <h2 className="text-base font-semibold text-slate-800 dark:text-slate-200">{t.academy.classAssignment}</h2>

          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">{t.academy.selectClass}</label>
            <div className="flex flex-wrap gap-2">
              {classes.map(c => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setSelectedClassId(c.id)}
                  className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${
                    selectedClassId === c.id
                      ? 'bg-indigo-600 text-white'
                      : 'bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600'
                  }`}
                >
                  {c.name}
                </button>
              ))}
            </div>
          </div>

          {selectedClassId && (
            <>
              <form onSubmit={handleAddClassMember} className="space-y-3 border-t border-slate-200 dark:border-slate-700 pt-4">
                <p className="text-sm font-medium text-slate-700 dark:text-slate-300">{t.academy.addClassMember}</p>
                <div className="flex gap-2">
                  <input
                    type="email"
                    value={classMemberAddEmail}
                    onChange={e => setClassMemberAddEmail(e.target.value)}
                    placeholder={t.academy.classMemberEmailPlaceholder}
                    required
                    className="flex-1 px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-sm text-slate-900 dark:text-slate-200"
                  />
                  <select
                    value={classMemberAddRole}
                    onChange={e => setClassMemberAddRole(e.target.value as 'teacher' | 'student')}
                    className="px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-sm text-slate-900 dark:text-slate-200"
                  >
                    <option value="student">{t.academy.roleStudent}</option>
                    <option value="teacher">{t.academy.roleTeacher}</option>
                  </select>
                  <button
                    type="submit"
                    disabled={classBusy || !classMemberAddEmail.trim()}
                    className="px-4 py-2 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700 disabled:opacity-50"
                  >
                    {t.academy.add}
                  </button>
                </div>
              </form>

              <div className="border-t border-slate-200 dark:border-slate-700 pt-4">
                <p className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                  {t.academy.classMembersCount.replace('{count}', String(classMembers.length))}
                </p>
                {classMembers.length === 0 ? (
                  <p className="text-sm text-slate-400 py-2 text-center">{t.academy.noMembers}</p>
                ) : (
                  <div className="space-y-1.5 max-h-64 overflow-y-auto">
                    {classMembers.map(cm => (
                      <div key={cm.id} className="flex items-center justify-between py-2 px-3 rounded-lg bg-slate-50 dark:bg-slate-700/50">
                        <div className="flex items-center gap-2">
                          <span className="text-sm text-slate-800 dark:text-slate-200">{cm.email || cm.user_id.slice(0, 8)}</span>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                            cm.role === 'teacher'
                              ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300'
                              : 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
                          }`}>
                            {cm.role === 'teacher' ? t.academy.roleTeacher : t.academy.roleStudent}
                          </span>
                        </div>
                        <button
                          onClick={() => handleRemoveClassMember(cm.user_id, cm.email || '')}
                          className="text-xs text-red-500 hover:text-red-700 px-2 py-1"
                        >
                          {t.academy.remove}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
};
