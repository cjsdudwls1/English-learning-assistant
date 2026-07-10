import React from 'react';
import type { TeacherPerformance } from '../../services/db';
import { useLanguage } from '../../contexts/LanguageContext';
import { getTranslation } from '../../utils/translations';

interface Props {
  teachers: TeacherPerformance[];
}

export const TeacherPerformanceCard: React.FC<Props> = ({ teachers }) => {
  const { language } = useLanguage();
  const t = getTranslation(language);
  if (teachers.length === 0) {
    return (
      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-5">
        <h2 className="text-lg font-bold text-slate-800 dark:text-slate-200 mb-4">{t.director.teacherPerformance}</h2>
        <p className="text-slate-600 dark:text-slate-400 text-sm text-center py-4">{t.director.noTeachersRegistered}</p>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-5">
      <h2 className="text-lg font-bold text-slate-800 dark:text-slate-200 mb-4">{t.director.teacherPerformance}</h2>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-slate-500 border-b border-slate-200 dark:border-slate-700">
              <th className="pb-2">{t.director.colName}</th>
              <th className="pb-2 text-center">{t.director.colClassCount}</th>
              <th className="pb-2 text-center">{t.director.colAssignmentCount}</th>
              <th className="pb-2 text-center">{t.director.colResponses}</th>
              <th className="pb-2 text-center">{t.director.colCorrectRate}</th>
              <th className="pb-2 text-center">{t.director.colUngraded}</th>
            </tr>
          </thead>
          <tbody>
            {teachers.map(tc => (
              <tr key={tc.userId} className="border-b border-slate-100 dark:border-slate-700/50">
                <td className="py-2 text-slate-700 dark:text-slate-300">
                  {tc.name || tc.email}
                  {tc.name && <span className="ml-1 text-xs text-slate-600 dark:text-slate-400">{tc.email}</span>}
                </td>
                <td className="py-2 text-center text-slate-600 dark:text-slate-400">{tc.classCount}</td>
                <td className="py-2 text-center text-slate-600 dark:text-slate-400">{tc.assignmentCount}</td>
                <td className="py-2 text-center text-slate-600 dark:text-slate-400">{tc.responseCount}</td>
                <td className="py-2 text-center text-slate-600 dark:text-slate-400">{tc.responseCount - tc.ungradedCount > 0 ? `${tc.gradedCorrectRate}%` : '-'}</td>
                <td className={`py-2 text-center ${tc.ungradedCount > 0 ? 'text-amber-600 dark:text-amber-400 font-medium' : 'text-slate-600 dark:text-slate-400'}`}>{tc.ungradedCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
