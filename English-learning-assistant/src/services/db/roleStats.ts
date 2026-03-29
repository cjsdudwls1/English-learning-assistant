import { supabase } from '../supabaseClient';
import { getCurrentUserId } from './auth';
import type { MonthlyStats, DailyStats } from '../../types';

interface StatsRow { date: string; is_correct: boolean; time: number }

function aggregateByMonth(rows: StatsRow[]): MonthlyStats[] {
  const map = new Map<number, { total: number; correct: number; incorrect: number; totalTime: number }>();
  for (const r of rows) {
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

function extractLabelRows(data: any[]): StatsRow[] {
  const rows: StatsRow[] = [];
  for (const r of data) {
    const problems = (r as any).problems;
    const sessions = Array.isArray(problems) ? problems[0]?.sessions : problems?.sessions;
    if (sessions?.created_at) {
      rows.push({ date: sessions.created_at, is_correct: r.is_correct ?? false, time: 0 });
    }
  }
  return rows;
}

async function fetchAllStatsRows(targetId: string, startDate: string, endDate: string): Promise<StatsRow[]> {
  const [labelsRes, solvingRes, assignmentRes] = await Promise.all([
    supabase
      .from('labels')
      .select('is_correct, user_mark, problems!inner(sessions!inner(user_id, created_at))')
      .eq('problems.sessions.user_id', targetId)
      .not('user_mark', 'is', null)
      .gte('problems.sessions.created_at', startDate)
      .lte('problems.sessions.created_at', endDate),
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
  if (labelsRes.error) throw labelsRes.error;
  if (solvingRes.error) throw solvingRes.error;
  if (assignmentRes.error) throw assignmentRes.error;

  const rows: StatsRow[] = extractLabelRows(labelsRes.data || []);
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

  const [labelsRes, assignRes, solvingRes] = await Promise.all([
    supabase
      .from('labels')
      .select('is_correct, user_mark, problems!inner(sessions!inner(user_id, created_at))')
      .in('problems.sessions.user_id', studentIds)
      .not('user_mark', 'is', null)
      .gte('problems.sessions.created_at', startDate)
      .lte('problems.sessions.created_at', endDate),
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
  if (labelsRes.error) throw labelsRes.error;
  if (assignRes.error) throw assignRes.error;
  if (solvingRes.error) throw solvingRes.error;

  const rows: StatsRow[] = extractLabelRows(labelsRes.data || []);
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
  overallCorrectRate: number;
}

export async function fetchDirectorOverview(): Promise<DirectorOverview> {
  const { count: totalClasses } = await supabase
    .from('classes')
    .select('*', { count: 'exact', head: true });

  const { count: totalStudents } = await supabase
    .from('class_members')
    .select('*', { count: 'exact', head: true })
    .eq('role', 'student');

  const { count: totalAssignments } = await supabase
    .from('shared_assignments')
    .select('*', { count: 'exact', head: true });

  const { count: totalResponses, error: trErr } = await supabase
    .from('assignment_responses')
    .select('*', { count: 'exact', head: true });
  if (trErr) throw trErr;

  const { count: correctCount, error: ccErr } = await supabase
    .from('assignment_responses')
    .select('*', { count: 'exact', head: true })
    .eq('is_correct', true);
  if (ccErr) throw ccErr;

  const total = totalResponses ?? 0;
  const correct = correctCount ?? 0;
  const overallCorrectRate = total > 0
    ? Math.round((correct / total) * 100)
    : 0;

  return {
    totalStudents: totalStudents ?? 0,
    totalClasses: totalClasses ?? 0,
    totalAssignments: totalAssignments ?? 0,
    totalResponses: total,
    overallCorrectRate,
  };
}
