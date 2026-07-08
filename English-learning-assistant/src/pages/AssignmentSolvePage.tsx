import React, { useEffect, useState, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { fetchAssignmentProblems, submitAssignmentResponse, fetchAssignmentResponses, fetchAssignmentById } from '../services/db';
import { AnswerInput, checkAnswer } from '../components/assignment/AnswerInput';
import { AssignmentReviewItem } from '../components/assignment/AssignmentReviewItem';
import { useLanguage } from '../contexts/LanguageContext';
import { getTranslation } from '../utils/translations';
import { translateError } from '../utils/errorI18n';
import { isOverdue } from '../utils/assignmentDue';
import type { GeneratedProblem, AssignmentResponse, SharedAssignment } from '../types';

interface ProblemWithOrder {
  problem_id: string;
  order_index: number;
  problem?: GeneratedProblem;
}

export const AssignmentSolvePage: React.FC = () => {
  const { assignmentId } = useParams<{ assignmentId: string }>();
  const { language } = useLanguage();
  const t = getTranslation(language);
  const [problems, setProblems] = useState<ProblemWithOrder[]>([]);
  const [responses, setResponses] = useState<AssignmentResponse[]>([]);
  const [assignment, setAssignment] = useState<SharedAssignment | null>(null);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [selectedAnswer, setSelectedAnswer] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [startTime, setStartTime] = useState(Date.now());

  useEffect(() => {
    if (!assignmentId) return;
    const load = async () => {
      const [probs, resps, asgn] = await Promise.all([
        fetchAssignmentProblems(assignmentId),
        fetchAssignmentResponses(assignmentId),
        fetchAssignmentById(assignmentId),
      ]);
      setProblems(probs);
      setResponses(resps);
      setAssignment(asgn);
      // 이어풀기: 첫 미응답 문제로 이동(전부 응답이면 완료 화면이 뜨므로 0 유지)
      const firstUnanswered = probs.findIndex(
        (p) => !resps.some((r) => r.problem_id === p.problem_id)
      );
      if (firstUnanswered > 0) setCurrentIdx(firstUnanswered);
      setLoading(false);
      setStartTime(Date.now());
    };
    load().catch((e) => {
      setLoadError(translateError(e, language, t, t.assignments.loadError));
      setLoading(false);
    });
  }, [assignmentId]);

  const currentProblem = problems[currentIdx]?.problem;
  const isAnswered = useCallback((problemId: string) =>
    responses.some((r) => r.problem_id === problemId), [responses]);

  const overdue = isOverdue(assignment?.due_date);

  const handleSubmit = async () => {
    if (!assignmentId || !currentProblem || !selectedAnswer || overdue) return;
    setSubmitting(true);
    const timeSpent = Math.round((Date.now() - startTime) / 1000);
    const isCorrect = checkAnswer(currentProblem, selectedAnswer);

    try {
      await submitAssignmentResponse({
        assignmentId,
        problemId: currentProblem.id,
        answer: selectedAnswer,
        isCorrect,
        timeSpentSeconds: timeSpent,
      });
      setResponses((prev) => [...prev, {
        id: '', assignment_id: assignmentId, problem_id: currentProblem.id,
        student_id: '', answer: selectedAnswer, is_correct: isCorrect,
        time_spent_seconds: timeSpent, submitted_at: new Date().toISOString(),
      }]);
      setCurrentIdx((i) => Math.min(i + 1, problems.length));
      setSelectedAnswer('');
      setStartTime(Date.now());
    } catch {
      alert(t.assignments.submitFailed);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <div className="text-center py-20 text-slate-500">{t.common.loading}</div>;
  if (loadError) {
    return (
      <div className="max-w-3xl mx-auto text-center py-20 space-y-4">
        <p className="text-red-600 dark:text-red-400">{loadError}</p>
        <Link to="/assignments" className="inline-block px-4 py-2 bg-indigo-600 text-white rounded-xl text-sm">{t.assignments.backToList}</Link>
      </div>
    );
  }
  if (problems.length === 0) return <div className="text-center py-20 text-slate-400">{t.assignments.noProblems}</div>;

  const allDone = problems.every((p) => isAnswered(p.problem_id));

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex items-center gap-3 flex-wrap">
        <Link to="/assignments" className="text-indigo-600 dark:text-indigo-400 hover:underline text-sm">&larr; {t.assignments.assignmentList}</Link>
        <span className="text-sm text-slate-500">{Math.min(currentIdx + 1, problems.length)} / {problems.length}</span>
        {assignment?.due_date && (
          <span className="text-sm text-slate-500">
            {t.assignments.dueLabel.replace('{date}', new Date(assignment.due_date).toLocaleDateString())}
          </span>
        )}
        {overdue && (
          <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300">
            {t.assignments.overdue}
          </span>
        )}
      </div>

      {allDone ? (
        <div className="space-y-6">
          <div className="text-center py-10 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700">
            <p className="text-2xl font-bold text-green-600 mb-2">{t.assignments.allSolved}</p>
            <p className="text-slate-500">{t.assignments.correctCount.replace('{correct}', String(responses.filter((r) => r.is_correct === true).length)).replace('{total}', String(problems.length))}</p>
            {responses.some((r) => r.is_correct === null) && (
              <p className="text-sm text-amber-600 dark:text-amber-400 mt-1">
                {t.assignments.ungradedCount.replace('{count}', String(responses.filter((r) => r.is_correct === null).length))}
              </p>
            )}
            <Link to="/assignments" className="inline-block mt-4 px-4 py-2 bg-indigo-600 text-white rounded-xl text-sm">{t.assignments.backToList}</Link>
          </div>
          <div className="space-y-3">
            <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-200">{t.assignments.reviewHeading}</h2>
            {problems.map((p, i) =>
              p.problem ? (
                <AssignmentReviewItem
                  key={p.problem_id}
                  index={i}
                  problem={p.problem}
                  response={responses.find((r) => r.problem_id === p.problem_id)}
                />
              ) : null
            )}
          </div>
        </div>
      ) : currentProblem ? (
        <>
          {isAnswered(currentProblem.id) ? (
            <AssignmentReviewItem
              problem={currentProblem}
              response={responses.find((r) => r.problem_id === currentProblem.id)}
            />
          ) : (
            <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-6 space-y-4">
              <p className="text-lg font-medium text-slate-800 dark:text-slate-200">{currentProblem.stem}</p>
              {currentProblem.passage && (
                <div className="p-4 bg-slate-50 dark:bg-slate-900/40 border-l-4 border-indigo-400 dark:border-indigo-600 rounded-r-lg">
                  <div className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 mb-2 uppercase tracking-wide">
                    {t.assignments.passage}
                  </div>
                  <p className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed whitespace-pre-wrap">
                    {currentProblem.passage}
                  </p>
                </div>
              )}
              <AnswerInput problem={currentProblem} selectedAnswer={selectedAnswer} onSelect={setSelectedAnswer} />
              {overdue && (
                <p className="text-sm text-red-600 dark:text-red-400">{t.assignments.overdueNotice}</p>
              )}
              <button onClick={handleSubmit} disabled={!selectedAnswer || submitting || overdue}
                className="w-full py-3 bg-indigo-600 text-white rounded-xl font-medium hover:bg-indigo-700 disabled:opacity-50">
                {submitting ? t.assignments.submitting : t.assignments.submitAnswer}
              </button>
            </div>
          )}
          <div className="flex justify-between">
            <button onClick={() => { setCurrentIdx((i) => Math.max(0, i - 1)); setSelectedAnswer(''); setStartTime(Date.now()); }} disabled={currentIdx === 0} className="text-sm text-slate-500 hover:underline disabled:opacity-30">&larr; {t.assignments.previous}</button>
            <button onClick={() => { setCurrentIdx((i) => Math.min(problems.length - 1, i + 1)); setSelectedAnswer(''); setStartTime(Date.now()); }} disabled={currentIdx === problems.length - 1} className="text-sm text-slate-500 hover:underline disabled:opacity-30">{t.assignments.next} &rarr;</button>
          </div>
        </>
      ) : null}
    </div>
  );
};
