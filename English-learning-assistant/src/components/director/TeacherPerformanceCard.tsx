import React from 'react';
import type { TeacherPerformance } from '../../services/db';
import { useLanguage } from '../../contexts/LanguageContext';

interface Props {
  teachers: TeacherPerformance[];
}

export const TeacherPerformanceCard: React.FC<Props> = ({ teachers }) => {
  const { language } = useLanguage();
  if (teachers.length === 0) {
    return (
      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-5">
        <h2 className="text-lg font-bold text-slate-800 dark:text-slate-200 mb-4">{language === 'ko' ? '선생님 실적' : 'Teacher Performance'}</h2>
        <p className="text-slate-400 text-sm text-center py-4">{language === 'ko' ? '등록된 선생님이 없습니다.' : 'No teachers registered.'}</p>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-5">
      <h2 className="text-lg font-bold text-slate-800 dark:text-slate-200 mb-4">{language === 'ko' ? '선생님 실적' : 'Teacher Performance'}</h2>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-slate-500 border-b border-slate-200 dark:border-slate-700">
              <th className="pb-2">{language === 'ko' ? '이메일' : 'Email'}</th>
              <th className="pb-2 text-center">{language === 'ko' ? '학급 수' : 'Classes'}</th>
              <th className="pb-2 text-center">{language === 'ko' ? '과제 수' : 'Assignments'}</th>
            </tr>
          </thead>
          <tbody>
            {teachers.map(t => (
              <tr key={t.userId} className="border-b border-slate-100 dark:border-slate-700/50">
                <td className="py-2 text-slate-700 dark:text-slate-300">{t.email}</td>
                <td className="py-2 text-center text-slate-600 dark:text-slate-400">{t.classCount}</td>
                <td className="py-2 text-center text-slate-600 dark:text-slate-400">{t.assignmentCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
