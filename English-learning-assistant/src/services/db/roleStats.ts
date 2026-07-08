import { supabase } from '../supabaseClient';
import { getCurrentUserId } from './auth';
import type { MonthlyStats, DailyStats } from '../../types';
import {
  fetchSessionsForUser,
  fetchSessionsForUsers,
  fetchProblemsForSessions,
  fetchLabelsForProblems,
} from '../stats';

// is_correct null = 자동 채점 불가(서술형 등 미채점) — 채점 계약상 오답으로 위조하지 않고
// 월별/일별 집계에서 제외한다(correct + incorrect === total 불변식 유지).
interface StatsRow { date: string; is_correct: boolean | null; time: number }

function aggregateByMonth(rows: StatsRow[]): MonthlyStats[] {
  const map = new Map<number, { total: number; correct: number; incorrect: number; totalTime: number }>();
  for (const r of rows) {
    if (typeof r.is_correct !== 'boolean') continue;
    const month = new Date(r.date).getMonth() + 1;
    const e = map.get(month) ?? { total: 0, correct: 0, incorrect: 0, totalTime: 0 };
    e.total++;
    if (r.is_correct) e.correct++; else e.incorrect++;
    e.totalTime += r.time;
    map.set(month, e);
  }
  return Array.from(map.entries()).map(([month, s]) => ({
    month,
    total_count: s.total,
    correct_count: s.correct,
    incorrect_count: s.incorrect,
    avg_time_seconds: s.total > 0 ? Math.round(s.totalTime / s.total) : 0,
  })).sort((a, b) => a.month - b.month);
}

function aggregateByDay(rows: StatsRow[]): DailyStats[] {
  const map = new Map<string, { total: number; correct: number; incorrect: number; totalTime: number }>();
  for (const r of rows) {
    if (typeof r.is_correct !== 'boolean') continue;
    const date = r.date.slice(0, 10);
    const e = map.get(date) ?? { total: 0, correct: 0, incorrect: 0, totalTime: 0 };
    e.total++;
    if (r.is_correct) e.correct++; else e.incorrect++;
    e.totalTime += r.time;
    map.set(date, e);
  }
  return Array.from(map.entries()).map(([date, s]) => ({
    date,
    total_count: s.total,
    correct_count: s.correct,
    incorrect_count: s.incorrect,
    avg_time_seconds: s.total > 0 ? Math.round(s.totalTime / s.total) : 0,
  })).sort((a, b) => a.date.localeCompare(b.date));
}

// labels를 단계별로 가져와 StatsRow[]로 변환 (1명 사용자)
async function fetchLabelStatsRowsForUser(targetId: string, startDate: string, endDate: string): Promise<StatsRow[]> {
  const sessions = await fetchSessionsForUser(targetId, new Date(startDate), new Date(endDate));
  if (sessions.length === 0) return [];
  const sessionDateMap = new Map<string, string>();
  for (const s of sessions) sessionDateMap.set(s.id, s.created_at);
  const problems = await fetchProblemsForSessions(sessions.map((s) => s.id));
  if (problems.length === 0) return [];
  const problemToSession = new Map<string, string>();
  for (const p of problems) problemToSession.set(p.id, p.session_id);
  const labels = await fetchLabelsForProblems(problems.map((p) => p.id));

  const rows: StatsRow[] = [];
  for (const l of labels) {
    const sid = problemToSession.get(l.problem_id);
    const created = sid ? sessionDateMap.get(sid) : undefined;
    if (created) rows.push({ date: created, is_correct: l.is_correct ?? null, time: 0 });
  }
  return rows;
}

// labels를 단계별로 가져와 StatsRow[]로 변환 (학생 다수)
async function fetchLabelStatsRowsForUsers(studentIds: string[], startDate: string, endDate: string): Promise<StatsRow[]> {
  const sessions = await fetchSessionsForUsers(studentIds, startDate, endDate);
  if (sessions.length === 0) return [];
  const sessionDateMap = new Map<string, string>();
  for (const s of sessions) sessionDateMap.set(s.id, s.created_at);
  const problems = await fetchProblemsForSessions(sessions.map((s) => s.id));
  if (problems.length === 0) return [];
  const problemToSession = new Map<string, string>();
  for (const p of problems) problemToSession.set(p.id, p.session_id);
  const labels = await fetchLabelsForProblems(problems.map((p) => p.id));

  const rows: StatsRow[] = [];
  for (const l of labels) {
    const sid = problemToSession.get(l.problem_id);
    const created = sid ? sessionDateMap.get(sid) : undefined;
    if (created) rows.push({ date: created, is_correct: l.is_correct ?? null, time: 0 });
  }
  return rows;
}

async function fetchAllStatsRows(targetId: string, startDate: string, endDate: string): Promise<StatsRow[]> {
  const [labelRows, solvingRes, assignmentRes] = await Promise.all([
    fetchLabelStatsRowsForUser(targetId, startDate, endDate),
    supabase
      .from('problem_solving_sessions')
      .select('is_correct, time_spent_seconds, completed_at')
      .eq('user_id', targetId)
      .not('completed_at', 'is', null)
      .gte('completed_at', startDate)
      .lte('completed_at', endDate),
    supabase
      .from('assignment_responses')
      .select('is_correct, time_spent_seconds, submitted_at')
      .eq('student_id', targetId)
      .gte('submitted_at', startDate)
      .lte('submitted_at', endDate),
  ]);
  if (solvingRes.error) throw solvingRes.error;
  if (assignmentRes.error) throw assignmentRes.error;

  const rows: StatsRow[] = [...labelRows];
  for (const r of solvingRes.data || []) {
    rows.push({ date: r.completed_at, is_correct: r.is_correct, time: r.time_spent_seconds ?? 0 });
  }
  for (const r of assignmentRes.data || []) {
    rows.push({ date: r.submitted_at, is_correct: r.is_correct, time: r.time_spent_seconds ?? 0 });
  }
  return rows;
}

export async function fetchMonthlySolvingStats(year: number, studentId?: string): Promise<MonthlyStats[]> {
  const targetId = studentId ?? await getCurrentUserId();
  const rows = await fetchAllStatsRows(targetId, `${year}-01-01T00:00:00Z`, `${year}-12-31T23:59:59Z`);
  return aggregateByMonth(rows);
}

export async function fetchDailySolvingStats(year: number, month: number, studentId?: string): Promise<DailyStats[]> {
  const targetId = studentId ?? await getCurrentUserId();
  const mm = String(month).padStart(2, '0');
  const lastDay = new Date(year, month, 0).getDate();
  const rows = await fetchAllStatsRows(targetId, `${year}-${mm}-01T00:00:00Z`, `${year}-${mm}-${lastDay}T23:59:59Z`);
  return aggregateByDay(rows);
}

export interface WeeklySolvingSummary {
  thisWeekCount: number;
  lastWeekCount: number;
  /** 이번 주 정답률(0-100). 채점된 문항(is_correct not null) 기준, 표본 없으면 0 */
  thisWeekCorrectRate: number;
  /** 이번 주 시작(월요일 00:00, 로컬) — 취약 카테고리 조회 등 동일 범위 재사용용 */
  weekStart: Date;
}

/** 이번 주(월요일 시작)와 지난주의 풀이량·정답률 비교 — 학부모 주간 요약용 */
export async function fetchWeeklySolvingSummary(studentId?: string): Promise<WeeklySolvingSummary> {
  const targetId = studentId ?? await getCurrentUserId();
  const now = new Date();
  const mondayOffset = (now.getDay() + 6) % 7;
  const thisWeekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - mondayOffset);
  const lastWeekStart = new Date(thisWeekStart);
  lastWeekStart.setDate(lastWeekStart.getDate() - 7);

  const [thisRows, lastRows] = await Promise.all([
    fetchAllStatsRows(targetId, thisWeekStart.toISOString(), now.toISOString()),
    fetchAllStatsRows(targetId, lastWeekStart.toISOString(), thisWeekStart.toISOString()),
  ]);
  // 풀이량(thisWeekCount)은 미채점 포함 전체, 정답률은 채점된 문항만 기준
  const graded = thisRows.filter((r) => typeof r.is_correct === 'boolean');
  const correct = graded.filter((r) => r.is_correct === true).length;
  return {
    thisWeekCount: thisRows.length,
    lastWeekCount: lastRows.length,
    thisWeekCorrectRate: graded.length > 0 ? Math.round((correct / graded.length) * 100) : 0,
    weekStart: thisWeekStart,
  };
}

export async function fetchClassAssignmentStats(classId: string, year: number, month?: number): Promise<MonthlyStats[]> {
  const { data: members, error: mErr } = await supabase
    .from('class_members')
    .select('user_id')
    .eq('class_id', classId)
    .eq('role', 'student');
  if (mErr) throw mErr;

  const studentIds = (members || []).map((m) => m.user_id);
  if (studentIds.length === 0) return [];

  const startDate = month
    ? `${year}-${String(month).padStart(2, '0')}-01T00:00:00Z`
    : `${year}-01-01T00:00:00Z`;
  const endDate = month
    ? `${year}-${String(month).padStart(2, '0')}-${new Date(year, month, 0).getDate()}T23:59:59Z`
    : `${year}-12-31T23:59:59Z`;

  const [labelRows, assignRes, solvingRes] = await Promise.all([
    fetchLabelStatsRowsForUsers(studentIds, startDate, endDate),
    supabase
      .from('assignment_responses')
      .select('is_correct, time_spent_seconds, submitted_at')
      .in('student_id', studentIds)
      .gte('submitted_at', startDate)
      .lte('submitted_at', endDate),
    supabase
      .from('problem_solving_sessions')
      .select('is_correct, time_spent_seconds, completed_at')
      .in('user_id', studentIds)
      .not('completed_at', 'is', null)
      .gte('completed_at', startDate)
      .lte('completed_at', endDate),
  ]);
  if (assignRes.error) throw assignRes.error;
  if (solvingRes.error) throw solvingRes.error;

  const rows: StatsRow[] = [...labelRows];
  for (const r of assignRes.data || []) {
    rows.push({ date: r.submitted_at, is_correct: r.is_correct, time: r.time_spent_seconds ?? 0 });
  }
  for (const r of solvingRes.data || []) {
    rows.push({ date: r.completed_at, is_correct: r.is_correct, time: r.time_spent_seconds ?? 0 });
  }
  return aggregateByMonth(rows);
}

export interface DirectorOverview {
  totalStudents: number;
  totalClasses: number;
  totalAssignments: number;
  totalResponses: number;
  /** 채점 대기(is_correct null) 응답 수 — 서술형 등 수동 확인 필요 */
  ungradedResponses: number;
  /** 채점된 응답(is_correct not null) 기준 정답률(0-100). 표본 없으면 0 */
  overallCorrectRate: number;
}

export async function fetchDirectorOverview(academyId?: string | null): Promise<DirectorOverview> {
  let classesQuery = supabase.from('classes').select('*', { count: 'exact', head: true });
  if (academyId) classesQuery = classesQuery.eq('academy_id', academyId);
  const { count: totalClasses } = await classesQuery;

  let studentsQuery = supabase.from('academy_students').select('*', { count: 'exact', head: true });
  if (academyId) studentsQuery = studentsQuery.eq('academy_id', academyId);
  const { count: totalStudents } = await studentsQuery;

  let assignmentsQuery = supabase.from('shared_assignments').select('*', { count: 'exact', head: true });
  if (academyId) assignmentsQuery = assignmentsQuery.eq('academy_id', academyId);
  const { count: totalAssignments } = await assignmentsQuery;

  // 응답 집계 — academyId가 있으면 해당 학원 과제의 응답만 카운트(타 학원/개인 과제 혼입 방지)
  let assignmentIds: string[] | null = null;
  if (academyId) {
    const { data: aRows, error: aErr } = await supabase
      .from('shared_assignments')
      .select('id')
      .eq('academy_id', academyId);
    if (aErr) throw aErr;
    assignmentIds = (aRows || []).map((r) => r.id);
  }

  const CHUNK = 500;
  const countResponses = async (filter: 'all' | 'graded' | 'correct'): Promise<number> => {
    const buildQuery = (ids?: string[]) => {
      let q = supabase.from('assignment_responses').select('*', { count: 'exact', head: true });
      if (ids) q = q.in('assignment_id', ids);
      if (filter === 'graded') q = q.not('is_correct', 'is', null);
      if (filter === 'correct') q = q.eq('is_correct', true);
      return q;
    };
    if (!assignmentIds) {
      const { count, error } = await buildQuery();
      if (error) throw error;
      return count ?? 0;
    }
    if (assignmentIds.length === 0) return 0;
    let total = 0;
    for (let i = 0; i < assignmentIds.length; i += CHUNK) {
      const { count, error } = await buildQuery(assignmentIds.slice(i, i + CHUNK));
      if (error) throw error;
      total += count ?? 0;
    }
    return total;
  };

  const [totalResponses, gradedCount, correctCount] = await Promise.all([
    countResponses('all'),
    countResponses('graded'),
    countResponses('correct'),
  ]);

  // 정답률은 채점된 응답 기준 — 미채점(null)을 오답으로 위조하지 않음
  const overallCorrectRate = gradedCount > 0
    ? Math.round((correctCount / gradedCount) * 100)
    : 0;

  return {
    totalStudents: totalStudents ?? 0,
    totalClasses: totalClasses ?? 0,
    totalAssignments: totalAssignments ?? 0,
    totalResponses,
    ungradedResponses: totalResponses - gradedCount,
    overallCorrectRate,
  };
}
