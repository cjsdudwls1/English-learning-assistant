import React from 'react';
import { Link } from 'react-router-dom';
import { useUserRole } from '../contexts/UserRoleContext';

export const AcademyListPage: React.FC = () => {
  const { availableAcademies, activeAcademyId, setActiveAcademy } = useUserRole();

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-200">내 학원</h1>
        <Link
          to="/academies/new"
          className="px-4 py-2 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700 transition-colors"
        >
          + 학원 만들기
        </Link>
      </div>

      {availableAcademies.length === 0 ? (
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-8 text-center">
          <p className="text-slate-400 text-sm mb-4">소속된 학원이 없습니다.</p>
          <Link to="/academies/new" className="text-indigo-600 dark:text-indigo-400 underline text-sm">
            새 학원 만들기
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {availableAcademies.map(a => (
            <div
              key={a.id}
              className={`bg-white dark:bg-slate-800 rounded-2xl border p-5 transition-colors ${
                activeAcademyId === a.id
                  ? 'border-indigo-400 dark:border-indigo-500'
                  : 'border-slate-200 dark:border-slate-700'
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-semibold text-slate-800 dark:text-slate-200">{a.name}</p>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300">
                      {a.role === 'director' ? '학원장' : a.role === 'teacher' ? '선생님' : '학생'}
                    </span>
                    {activeAcademyId === a.id && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300">
                        활성
                      </span>
                    )}
                  </div>
                  {a.description && (
                    <p className="text-sm text-slate-500 mt-1">{a.description}</p>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {a.role === 'director' && (
                    <Link
                      to={`/academies/${a.id}/members`}
                      className="px-3 py-1.5 text-xs bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors"
                    >
                      멤버 관리
                    </Link>
                  )}
                  {activeAcademyId !== a.id && (
                    <button
                      onClick={() => setActiveAcademy(a.id)}
                      className="px-3 py-1.5 text-xs bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors"
                    >
                      활성화
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
