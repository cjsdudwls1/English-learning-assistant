import React, { useEffect, useState, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { fetchAssignmentProblems, submitAssignmentResponse, fetchAssignmentResponses } from '../services/db';
import { AnswerInput, checkAnswer } from '../components/assignment/AnswerInput';
import type { GeneratedProblem, AssignmentResponse } from '../types';

interface ProblemWithOrder {
  problem_id: string;
  order_index: number;
  problem?: GeneratedProblem;
}

export const AssignmentSolvePage: React.FC = () => {
  const { assignmentId } = useParams<{ assignmentId: string }>();
  const [problems, setProblems] = useState<ProblemWithOrder[]>([]);
  const [responses, setResponses] = useState<AssignmentResponse[]>([]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [selectedAnswer, setSelectedAnswer] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [startTime, setStartTime] = useState(Date.now());

  useEffect(() => {
    if (!assignmentId) return;
    const load = async () => {
      const [probs, resps] = await Promise.all([
        fetchAssignmentProblems(assignmentId),
        fetchAssignmentResponses(assignmentId),
      ]);
      setProblems(probs);
      setResponses(resps);
      setLoading(false);
      setStartTime(Date.now());
    };
    load().catch(() => setLoading(false));
  }, [assignmentId]);

  const currentProblem = problems[currentIdx]?.problem;
  const isAnswered = useCallback((problemId: string) =>
    responses.some((r) => r.problem_id === problemId), [responses]);

  const handleSubmit = async () => {
    if (!assignmentId || !currentProblem || !selectedAnswer) return;
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
      alert('응답 제출에 실패했습니다.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <div className="text-center py-20 text-slate-500">불러오는 중...</div>;
  if (problems.length === 0) return <div className="text-center py-20 text-slate-400">문제가 없습니다.</div>;

  const allDone = problems.every((p) => isAnswered(p.problem_id));

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Link to="/assignments" className="text-indigo-600 dark:text-indigo-400 hover:underline text-sm">&larr; 과제 목록</Link>
        <span className="text-sm text-slate-500">{currentIdx + 1} / {problems.length}</span>
      </div>

      {allDone ? (
        <div className="text-center py-16 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700">
          <p className="text-2xl font-bold text-green-600 mb-2">모든 문제를 풀었습니다!</p>
          <p className="text-slate-500">정답: {responses.filter((r) => r.is_correct).length} / {problems.length}</p>
          <Link to="/assignments" className="inline-block mt-4 px-4 py-2 bg-indigo-600 text-white rounded-xl text-sm">과제 목록으로</Link>
        </div>
      ) : currentProblem ? (
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-6 space-y-4">
          <p className="text-lg font-medium text-slate-800 dark:text-slate-200">{currentProblem.stem}</p>
          {currentProblem.passage && (
            <div className="p-4 bg-slate-50 dark:bg-slate-900/40 border-l-4 border-indigo-400 dark:border-indigo-600 rounded-r-lg">
              <div className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 mb-2 uppercase tracking-wide">
                지문 (Passage)
              </div>
              <p className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed whitespace-pre-wrap">
                {currentProblem.passage}
              </p>
            </div>
          )}
          {isAnswered(currentProblem.id) ? (
            <div className="p-4 rounded-xl bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 text-sm">이미 답변한 문제입니다.</div>
          ) : (
            <>
              <AnswerInput problem={currentProblem} selectedAnswer={selectedAnswer} onSelect={setSelectedAnswer} />
              <button onClick={handleSubmit} disabled={!selectedAnswer || submitting}
                className="w-full py-3 bg-indigo-600 text-white rounded-xl font-medium hover:bg-indigo-700 disabled:opacity-50">
                {submitting ? '제출 중...' : '답변 제출'}
              </button>
            </>
          )}
          <div className="flex justify-between">
            <button onClick={() => { setCurrentIdx((i) => Math.max(0, i - 1)); setSelectedAnswer(''); }} disabled={currentIdx === 0} className="text-sm text-slate-500 hover:underline disabled:opacity-30">&larr; 이전</button>
            <button onClick={() => { setCurrentIdx((i) => Math.min(problems.length - 1, i + 1)); setSelectedAnswer(''); setStartTime(Date.now()); }} disabled={currentIdx === problems.length - 1} className="text-sm text-slate-500 hover:underline disabled:opacity-30">다음 &rarr;</button>
          </div>
        </div>
      ) : null}
    </div>
  );
};
