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

type MemberRole = 'director' | 'teacher' | 'student';

const ROLE_LABELS: Record<MemberRole, string> = {
  director: '학원장',
  teacher: '선생님',
  student: '학생',
};

export const AcademyMembersPage: React.FC = () => {
  const { id: academyId } = useParams<{ id: string }>();
  const navigate = useNavigate();

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
      setError(e instanceof Error ? e.message : '데이터를 불러오지 못했습니다.');
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
      .catch(() => setClassMembers([]));
  }, [selectedClassId]);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!academyId || !searchEmail.trim()) return;
    setAdding(true);
    setError(null);
    setMessage(null);
    try {
      const user = await searchUserByEmail(searchEmail.trim());
      if (!user) throw new Error('해당 이메일의 사용자가 존재하지 않습니다.');
      if (members.some(m => m.user_id === user.user_id && m.role === addingRole)) {
        throw new Error('이미 같은 역할로 학원에 소속되어 있습니다.');
      }
      await addAcademyMember(academyId, user.user_id, addingRole);
      setMessage(`${user.email}을(를) ${ROLE_LABELS[addingRole]}로 추가했습니다.`);
      setSearchEmail('');
      await loadMembers();
    } catch (e) {
      setError(e instanceof Error ? e.message : '추가에 실패했습니다.');
    } finally {
      setAdding(false);
    }
  };

  const handleRemove = async (userId: string, role: MemberRole, email: string) => {
    if (!academyId) return;
    if (!confirm(`${email || userId}을(를) ${ROLE_LABELS[role]}에서 제거하시겠습니까?`)) return;
    setError(null);
    setMessage(null);
    try {
      await removeAcademyMember(academyId, userId, role);
      setMessage(`${email || userId} 제거 완료.`);
      await loadMembers();
    } catch (e) {
      setError(e instanceof Error ? e.message : '제거에 실패했습니다.');
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
      setMessage(`${classMemberAddEmail.trim()}을(를) 반에 추가했습니다.`);
      setClassMemberAddEmail('');
      const updated = await fetchClassMembers(selectedClassId);
      setClassMembers(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : '반 추가에 실패했습니다.');
    } finally {
      setClassBusy(false);
    }
  };

  const handleRemoveClassMember = async (userId: string, email: string) => {
    if (!selectedClassId) return;
    if (!confirm(`${email || userId}을(를) 반에서 제거하시겠습니까?`)) return;
    setError(null);
    setMessage(null);
    try {
      await removeClassMember(selectedClassId, userId);
      const updated = await fetchClassMembers(selectedClassId);
      setClassMembers(updated);
      setMessage('반 멤버 제거 완료.');
    } catch (e) {
      setError(e instanceof Error ? e.message : '반 제거에 실패했습니다.');
    }
  };

  const grouped: Record<MemberRole, AcademyMember[]> = {
    director: members.filter(m => m.role === 'director'),
    teacher: members.filter(m => m.role === 'teacher'),
    student: members.filter(m => m.role === 'student'),
  };

  if (loading) return <div className="text-center py-20 text-slate-500">불러오는 중...</div>;

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-200">학원 멤버 관리</h1>
          {academyName && <p className="text-sm text-slate-500 mt-0.5">{academyName}</p>}
        </div>
        <button
          type="button"
          onClick={() => navigate('/academies')}
          className="text-sm text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 underline"
        >
          돌아가기
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
        <h2 className="text-base font-semibold text-slate-800 dark:text-slate-200 mb-4">멤버 추가</h2>
        <form onSubmit={handleAdd} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
              이메일 <span className="text-red-500">*</span>
            </label>
            <input
              type="email"
              value={searchEmail}
              onChange={e => setSearchEmail(e.target.value)}
              placeholder="이미 가입한 사용자 이메일"
              required
              className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-200 focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">역할</label>
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
                  {ROLE_LABELS[r]}
                </button>
              ))}
            </div>
          </div>
          <button
            type="submit"
            disabled={adding || !searchEmail.trim()}
            className="w-full px-6 py-3 bg-indigo-600 text-white rounded-lg font-semibold hover:bg-indigo-700 disabled:opacity-50 transition-colors"
          >
            {adding ? '추가 중...' : '학원에 추가'}
          </button>
        </form>
      </div>

      {/* 멤버 목록 (역할별) */}
      {(['director', 'teacher', 'student'] as MemberRole[]).map(role => (
        <div key={role} className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-6">
          <h2 className="text-base font-semibold text-slate-800 dark:text-slate-200 mb-3">
            {ROLE_LABELS[role]} <span className="text-sm text-slate-400 ml-1">({grouped[role].length}명)</span>
          </h2>
          {grouped[role].length === 0 ? (
            <p className="text-sm text-slate-400 py-2 text-center">없음</p>
          ) : (
            <div className="space-y-1.5">
              {grouped[role].map(m => (
                <div key={`${m.role}-${m.user_id}`} className="flex items-center justify-between py-2 px-3 rounded-lg bg-slate-50 dark:bg-slate-700/50">
                  <span className="text-sm text-slate-800 dark:text-slate-200">{m.email || m.user_id.slice(0, 8)}</span>
                  <button
                    onClick={() => handleRemove(m.user_id, m.role, m.email)}
                    className="text-xs text-red-500 hover:text-red-700 px-2 py-1"
                  >
                    제거
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
          <h2 className="text-base font-semibold text-slate-800 dark:text-slate-200">반 배정</h2>

          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">반 선택</label>
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
                <p className="text-sm font-medium text-slate-700 dark:text-slate-300">반에 멤버 추가</p>
                <div className="flex gap-2">
                  <input
                    type="email"
                    value={classMemberAddEmail}
                    onChange={e => setClassMemberAddEmail(e.target.value)}
                    placeholder="학원 멤버 이메일"
                    required
                    className="flex-1 px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-sm text-slate-900 dark:text-slate-200"
                  />
                  <select
                    value={classMemberAddRole}
                    onChange={e => setClassMemberAddRole(e.target.value as 'teacher' | 'student')}
                    className="px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-sm text-slate-900 dark:text-slate-200"
                  >
                    <option value="student">학생</option>
                    <option value="teacher">선생님</option>
                  </select>
                  <button
                    type="submit"
                    disabled={classBusy || !classMemberAddEmail.trim()}
                    className="px-4 py-2 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700 disabled:opacity-50"
                  >
                    추가
                  </button>
                </div>
              </form>

              <div className="border-t border-slate-200 dark:border-slate-700 pt-4">
                <p className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                  반 멤버 ({classMembers.length}명)
                </p>
                {classMembers.length === 0 ? (
                  <p className="text-sm text-slate-400 py-2 text-center">멤버 없음</p>
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
                            {cm.role === 'teacher' ? '선생님' : '학생'}
                          </span>
                        </div>
                        <button
                          onClick={() => handleRemoveClassMember(cm.user_id, cm.email || '')}
                          className="text-xs text-red-500 hover:text-red-700 px-2 py-1"
                        >
                          제거
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
