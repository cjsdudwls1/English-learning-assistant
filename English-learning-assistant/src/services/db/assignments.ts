import { supabase } from '../supabaseClient';
import { getCurrentUserId } from './auth';
import type { SharedAssignment, AssignmentResponse, CreateAssignmentParams } from '../../types';

export async function createAssignment(params: CreateAssignmentParams): Promise<string> {
  const userId = await getCurrentUserId();
  const { title, description, classId, problemIds, studentIds, dueDate } = params;

  const { data, error } = await supabase
    .from('shared_assignments')
    .insert({ title, description, created_by: userId, class_id: classId, due_date: dueDate ?? null })
    .select('id')
    .single();
  if (error) throw error;

  const assignmentId = data.id as string;

  if (problemIds.length > 0) {
    const rows = problemIds.map((pid, i) => ({
      assignment_id: assignmentId, problem_id: pid, order_index: i,
    }));
    const { error: apError } = await supabase.from('assignment_problems').insert(rows);
    if (apError) throw apError;
  }

  if (studentIds.length > 0) {
    const targets = studentIds.map((sid) => ({
      assignment_id: assignmentId, student_id: sid,
    }));
    const { error: atError } = await supabase.from('assignment_targets').insert(targets);
    if (atError) throw atError;
  }

  return assignmentId;
}

export async function fetchMyAssignments(): Promise<SharedAssignment[]> {
  const userId = await getCurrentUserId();
  const { data, error } = await supabase
    .from('shared_assignments')
    .select('id, title, description, created_by, class_id, due_date, created_at')
    .eq('created_by', userId)
    .order('created_at', { ascending: false });
  if (error) throw error;

  const assignments: SharedAssignment[] = [];
  for (const a of data || []) {
    const { count: pCount } = await supabase
      .from('assignment_problems')
      .select('*', { count: 'exact', head: true })
      .eq('assignment_id', a.id);
    const { count: rCount } = await supabase
      .from('assignment_responses')
      .select('*', { count: 'exact', head: true })
      .eq('assignment_id', a.id);
    assignments.push({ ...a, problem_count: pCount ?? 0, completed_count: rCount ?? 0 });
  }
  return assignments;
}

export async function fetchAssignedToMe(): Promise<SharedAssignment[]> {
  const userId = await getCurrentUserId();
  const { data, error } = await supabase
    .from('assignment_targets')
    .select('assignment_id')
    .eq('student_id', userId);
  if (error) throw error;

  const ids = (data || []).map((d) => d.assignment_id);
  if (ids.length === 0) return [];

  const { data: assignments, error: aError } = await supabase
    .from('shared_assignments')
    .select('id, title, description, created_by, class_id, due_date, created_at')
    .in('id', ids)
    .order('created_at', { ascending: false });
  if (aError) throw aError;

  const result: SharedAssignment[] = [];
  for (const a of assignments || []) {
    const { count: pCount } = await supabase
      .from('assignment_problems')
      .select('*', { count: 'exact', head: true })
      .eq('assignment_id', a.id);
    const { count: rCount } = await supabase
      .from('assignment_responses')
      .select('*', { count: 'exact', head: true })
      .eq('assignment_id', a.id)
      .eq('student_id', userId);
    result.push({ ...a, problem_count: pCount ?? 0, completed_count: rCount ?? 0 });
  }
  return result;
}

interface SubmitResponseParams {
  assignmentId: string;
  problemId: string;
  answer: string;
  isCorrect: boolean | null;
  timeSpentSeconds: number;
}

export async function submitAssignmentResponse(params: SubmitResponseParams): Promise<void> {
  const userId = await getCurrentUserId();
  const { assignmentId, problemId, answer, isCorrect, timeSpentSeconds } = params;
  const { error } = await supabase
    .from('assignment_responses')
    .upsert({
      assignment_id: assignmentId,
      problem_id: problemId,
      student_id: userId,
      answer,
      is_correct: isCorrect,
      time_spent_seconds: timeSpentSeconds,
      submitted_at: new Date().toISOString(),
    }, { onConflict: 'assignment_id,problem_id,student_id' });
  if (error) throw error;
}

export async function fetchAssignmentResponses(assignmentId: string): Promise<AssignmentResponse[]> {
  const { data, error } = await supabase
    .from('assignment_responses')
    .select('*')
    .eq('assignment_id', assignmentId)
    .order('submitted_at', { ascending: true });
  if (error) throw error;
  return (data || []) as AssignmentResponse[];
}

export async function deleteAssignment(assignmentId: string): Promise<void> {
  const { error } = await supabase
    .from('shared_assignments')
    .delete()
    .eq('id', assignmentId);
  if (error) throw error;
}

export async function fetchChildAssignments(childId: string): Promise<SharedAssignment[]> {
  const { data: targets, error: tErr } = await supabase
    .from('assignment_targets')
    .select('assignment_id')
    .eq('student_id', childId);
  if (tErr) throw tErr;

  const ids = (targets || []).map(t => t.assignment_id);
  if (ids.length === 0) return [];

  const { data: assignments, error: aErr } = await supabase
    .from('shared_assignments')
    .select('id, title, description, created_by, class_id, due_date, created_at')
    .in('id', ids)
    .order('created_at', { ascending: false });
  if (aErr) throw aErr;

  const { data: apRows, error: apErr } = await supabase
    .from('assignment_problems')
    .select('assignment_id')
    .in('assignment_id', ids);
  if (apErr) throw apErr;

  const { data: arRows, error: arErr } = await supabase
    .from('assignment_responses')
    .select('assignment_id')
    .in('assignment_id', ids)
    .eq('student_id', childId);
  if (arErr) throw arErr;

  return (assignments || []).map(a => ({
    ...a,
    problem_count: (apRows || []).filter(r => r.assignment_id === a.id).length,
    completed_count: (arRows || []).filter(r => r.assignment_id === a.id).length,
  }));
}

export async function fetchAssignmentProblems(assignmentId: string) {
  const { data, error } = await supabase
    .from('assignment_problems')
    .select('id, assignment_id, problem_id, order_index')
    .eq('assignment_id', assignmentId)
    .order('order_index', { ascending: true });
  if (error) throw error;

  const problems = [];
  for (const ap of data || []) {
    const { data: problem } = await supabase
      .from('generated_problems')
      .select('*')
      .eq('id', ap.problem_id)
      .maybeSingle();
    problems.push({ ...ap, problem: problem ?? undefined });
  }
  return problems;
}
