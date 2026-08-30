import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { MonthlyStatsSelector } from '../stats/MonthlyStatsSelector';
import { AssignmentStatsDisplay } from '../stats/AssignmentStatsDisplay';
import type { ClassInfo, MonthlyStats } from '../../types';
import { useLanguage } from '../../contexts/LanguageContext';
import { getTranslation } from '../../utils/translations';

interface Props {
  classes: ClassInfo[];
  selectedClassId: string | null;
  classStats: MonthlyStats[];
  year: number;
  onSelectClass: (id: string) => void;
  onYearChange: (year: number) => void;
  onDeleteClass?: (id: string) => void;
}

export const DirectorClassStatsCard: React.FC<Props> = ({ classes, selectedClassId, classStats, year, onSelectClass, onYearChange, onDeleteClass }) => {
  const [selectedMonth, setSelectedMonth] = useState<number | null>(null);
  const { language } = useLanguage();
  const t = getTranslation(language);

  const selectedMonthStats = selectedMonth
    ? classStats.find((s) => s.month === selectedMonth)
    : null;

  const totals = classStats.reduce(
    (acc, s) => ({
      total: acc.total + s.total_count,
      correct: acc.correct + s.correct_count,
      incorrect: acc.incorrect + s.incorrect_count,
      time: acc.time + s.avg_time_seconds * s.timed_count,
      timed: acc.timed + s.timed_count,
    }),
    { total: 0, correct: 0, incorrect: 0, time: 0, timed: 0 }
  );

  return (
    <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-3 sm:p-5 space-y-3 sm:space-y-4">
      <h2 className="text-base sm:text-lg font-bold text-slate-800 dark:text-slate-200">{language === 'ko' ? '학급별 통계' : 'Statistics by Class'}</h2>

      <div className="flex flex-wrap gap-2">
        {classes.map((cls) => (
          <button
            key={cls.id}
            onClick={() => { onSelectClass(cls.id); setSelectedMonth(null); }}
            className={`min-h-[40px] sm:min-h-0 px-3 sm:px-4 py-2 rounded-xl text-sm font-medium transition-colors ${selectedClassId === cls.id ? 'bg-indigo-600 text-white' : 'bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-200'}`}
          >
            {cls.name} ({cls.student_count ?? 0}{language === 'ko' ? '명' : ' students'})
          </button>
        ))}
      </div>

      {selectedClassId && (
        <>
          {/* 위쪽 학급 칩은 '통계 대상 선택'이라 링크로 바꿀 수 없다(선택 기능이 사라진다).
              선택된 학급의 상세로 가는 길을 여기서 연다 — 원장은 이 경로가 RoleGate상
              허용돼 있는데도 주소창에 직접 치는 것 말고는 도달할 방법이 없었다.
              삭제 버튼과는 반대쪽 끝에 둔다(오조작 방지). */}
          <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
            <Link
              to={`/teacher/classes/${selectedClassId}`}
              className="inline-flex min-h-[40px] sm:min-h-0 items-center px-3 py-1.5 bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600 rounded-lg text-sm font-medium transition-colors"
            >
              {t.teacher.classDetail}
            </Link>
            {onDeleteClass && (
              <button
                onClick={() => {
                  if (window.confirm(language === 'ko'
                    ? '정말로 이 학급을 삭제하시겠습니까? 학급에 포함된 모든 과제 및 기록이 함께 삭제됩니다.'
                    : 'Are you sure you want to delete this class? All assignments and records in this class will be deleted as well.')) {
                    onDeleteClass(selectedClassId);
                  }
                }}
                className="relative px-3 py-1.5 bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-800/50 rounded-lg text-sm font-medium transition-colors before:absolute before:content-[''] before:-inset-x-1 before:-inset-y-1"
              >
                {language === 'ko' ? '현재 학급 삭제' : 'Delete Current Class'}
              </button>
            )}
          </div>

          <AssignmentStatsDisplay
            totalCount={totals.total}
            correctCount={totals.correct}
            incorrectCount={totals.incorrect}
            avgTimeSeconds={totals.timed > 0 ? Math.round(totals.time / totals.timed) : 0}
            label={t.stats.yearTotalLabel.replace('{year}', String(year))}
          />

          <MonthlyStatsSelector
            year={year}
            monthlyData={classStats}
            selectedMonth={selectedMonth}
            onSelectMonth={setSelectedMonth}
            onYearChange={onYearChange}
          />

          {selectedMonthStats && (
            <AssignmentStatsDisplay
              totalCount={selectedMonthStats.total_count}
              correctCount={selectedMonthStats.correct_count}
              incorrectCount={selectedMonthStats.incorrect_count}
              avgTimeSeconds={selectedMonthStats.avg_time_seconds}
              label={t.stats.monthStatsLabel.replace('{month}', String(selectedMonth))}
            />
          )}
        </>
      )}

      {classes.length === 0 && (
        <p className="text-slate-600 dark:text-slate-400 text-sm py-4 text-center">{language === 'ko' ? '등록된 학급이 없습니다.' : 'No classes registered.'}</p>
      )}
    </div>
  );
};
