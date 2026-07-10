import React, { useState } from 'react';
import type { AcademyHierarchy, StudentDetail, TeacherDetail } from '../../types';
import { useLanguage } from '../../contexts/LanguageContext';
import { getTranslation } from '../../utils/translations';

interface Props {
  hierarchy: AcademyHierarchy;
  onSelectStudent?: (userId: string, email?: string) => void;
  selectedStudentId?: string | null;
}

const RatePill: React.FC<{ rate: number; total: number; graded: number }> = ({ rate, total, graded }) => {
  const { language } = useLanguage();
  const t = getTranslation(language);
  if (total === 0) {
    return <span className="text-[10px] text-slate-600 dark:text-slate-400">{t.charts.noData}</span>;
  }
  // 채점 계약: 정답률은 채점된 응답 기준 — 전부 미채점이면 정답률 대신 대기 건수 표시
  if (graded === 0) {
    return (
      <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium bg-slate-100 dark:bg-slate-700/50 text-slate-500 dark:text-slate-400">
        {language === 'ko' ? `미채점 ${total}건` : `${total} ungraded`}
      </span>
    );
  }
  const color =
    rate >= 80 ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300' :
    rate >= 60 ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300' :
                 'bg-rose-100 dark:bg-rose-900/30 text-rose-700 dark:text-rose-300';
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${color}`}>
      {language === 'ko'
        ? `정답률 ${rate}% (채점 ${graded}건)`
        : `Accuracy ${rate}% (${graded} graded)`}
    </span>
  );
};

const StudentRow: React.FC<{
  student: StudentDetail;
  onSelect?: (uid: string, email?: string) => void;
  selected?: boolean;
}> = ({ student, onSelect, selected }) => {
  const { language } = useLanguage();
  return (
  <div
    className={`flex items-start justify-between gap-2 py-1.5 px-2 rounded-md transition-colors ${
      selected ? 'bg-indigo-50 dark:bg-indigo-900/30 border border-indigo-200 dark:border-indigo-700' : 'hover:bg-slate-50 dark:hover:bg-slate-700/40'
    }`}
  >
    <button
      type="button"
      onClick={() => onSelect?.(student.user_id, student.email)}
      className="flex-1 text-left text-xs text-slate-700 dark:text-slate-300"
    >
      <div className="flex items-center flex-wrap gap-1.5">
        <span className="font-medium">{student.email || student.user_id.slice(0, 8)}</span>
        {student.grade && <span className="text-[10px] text-slate-600 dark:text-slate-400">{student.grade}</span>}
        <RatePill rate={student.correct_rate} total={student.total_count} graded={student.graded_count} />
      </div>
      {student.parents.length > 0 && (
        <div className="mt-0.5 text-[10px] text-slate-600 dark:text-slate-400">
          {language === 'ko' ? '학부모: ' : 'Parents: '}{student.parents.map(p => p.email || p.user_id.slice(0, 8)).join(', ')}
        </div>
      )}
      {student.parents.length === 0 && (
        <div className="mt-0.5 text-[10px] text-slate-600 dark:text-slate-400">{language === 'ko' ? '학부모 미등록' : 'No parent linked'}</div>
      )}
    </button>
  </div>
  );
};

const TeacherSection: React.FC<{
  teacher: TeacherDetail;
  studentsById: Map<string, StudentDetail>;
  onSelectStudent?: (uid: string, email?: string) => void;
  selectedStudentId?: string | null;
}> = ({ teacher, studentsById, onSelectStudent, selectedStudentId }) => {
  const [open, setOpen] = useState(true);
  const { language } = useLanguage();

  return (
    <div className="border border-slate-200 dark:border-slate-700 rounded-xl">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-slate-50 dark:hover:bg-slate-700/40 transition-colors"
      >
        <div className="flex items-center gap-2">
          <span aria-hidden="true" className="text-xs text-slate-600 dark:text-slate-400">{open ? '▼' : '▶'}</span>
          <span className="text-sm font-semibold text-slate-800 dark:text-slate-200">
            {teacher.email || teacher.user_id.slice(0, 8)}
          </span>
          <span className="text-[10px] text-slate-600 dark:text-slate-400">
            {language === 'ko'
              ? `학급 ${teacher.classes.length}개 · 학생 ${teacher.student_ids.length}명`
              : `${teacher.classes.length} classes · ${teacher.student_ids.length} students`}
          </span>
        </div>
        <RatePill rate={teacher.correct_rate} total={teacher.total_count} graded={teacher.graded_count} />
      </button>

      {open && (
        <div className="border-t border-slate-200 dark:border-slate-700 p-3 space-y-3">
          {teacher.classes.length === 0 && (
            <p className="text-xs text-slate-600 dark:text-slate-400 py-1">{language === 'ko' ? '담당 학급 없음' : 'No assigned classes'}</p>
          )}
          {teacher.classes.map(cls => {
            const sids = teacher.student_ids.filter(sid =>
              (studentsById.get(sid)?.class_ids ?? []).includes(cls.id)
            );
            return (
              <div key={cls.id} className="bg-slate-50 dark:bg-slate-700/30 rounded-lg p-2">
                <div className="flex items-center justify-between mb-1.5">
                  <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                    {cls.name}
                  </p>
                  <span className="text-[10px] text-slate-600 dark:text-slate-400">{language === 'ko' ? `${cls.student_count}명` : `${cls.student_count} students`}</span>
                </div>
                {sids.length === 0 ? (
                  <p className="text-[11px] text-slate-600 dark:text-slate-400 py-1 text-center">{language === 'ko' ? '학생 없음' : 'No students'}</p>
                ) : (
                  <div className="space-y-1">
                    {sids.map(sid => {
                      const s = studentsById.get(sid);
                      if (!s) return null;
                      return (
                        <StudentRow
                          key={sid}
                          student={s}
                          onSelect={onSelectStudent}
                          selected={selectedStudentId === sid}
                        />
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export const AcademyHierarchyCard: React.FC<Props> = ({ hierarchy, onSelectStudent, selectedStudentId }) => {
  const studentsById = new Map(hierarchy.students.map(s => [s.user_id, s]));
  const [showUnassigned, setShowUnassigned] = useState(true);
  const { language } = useLanguage();

  return (
    <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-slate-800 dark:text-slate-200">{language === 'ko' ? '학원 조직도' : 'Academy Org Chart'}</h2>
        <span className="text-xs text-slate-500">
          {language === 'ko'
            ? `선생 ${hierarchy.teachers.length}명 · 학생 ${hierarchy.students.length}명`
            : `${hierarchy.teachers.length} teachers · ${hierarchy.students.length} students`}
        </span>
      </div>

      {hierarchy.teachers.length === 0 ? (
        <p className="text-sm text-slate-600 dark:text-slate-400 py-4 text-center">{language === 'ko' ? '등록된 선생님이 없습니다.' : 'No teachers registered.'}</p>
      ) : (
        <div className="space-y-2">
          {hierarchy.teachers.map(t => (
            <TeacherSection
              key={t.user_id}
              teacher={t}
              studentsById={studentsById}
              onSelectStudent={onSelectStudent}
              selectedStudentId={selectedStudentId}
            />
          ))}
        </div>
      )}

      {hierarchy.unassigned_students.length > 0 && (
        <div className="border border-amber-200 dark:border-amber-800 rounded-xl">
          <button
            type="button"
            onClick={() => setShowUnassigned(!showUnassigned)}
            className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-amber-50 dark:hover:bg-amber-900/20 transition-colors"
          >
            <div className="flex items-center gap-2">
              <span aria-hidden="true" className="text-xs text-slate-600 dark:text-slate-400">{showUnassigned ? '▼' : '▶'}</span>
              <span className="text-sm font-semibold text-amber-700 dark:text-amber-300">
                {language === 'ko' ? '미배정 학생' : 'Unassigned Students'}
              </span>
              <span className="text-[10px] text-amber-700 dark:text-amber-400">
                {language === 'ko' ? `${hierarchy.unassigned_students.length}명` : `${hierarchy.unassigned_students.length} students`}
              </span>
            </div>
            <span className="text-[10px] text-amber-700 dark:text-amber-400">{language === 'ko' ? '선생/반 미배정' : 'No teacher or class'}</span>
          </button>
          {showUnassigned && (
            <div className="border-t border-amber-200 dark:border-amber-800 p-3 space-y-1">
              {hierarchy.unassigned_students.map(s => (
                <StudentRow
                  key={s.user_id}
                  student={s}
                  onSelect={onSelectStudent}
                  selected={selectedStudentId === s.user_id}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
