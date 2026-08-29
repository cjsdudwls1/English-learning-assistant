import { supabase } from '../supabaseClient';
import { getCurrentUserId } from './auth';
import { fetchByIdChunks, assertAffected } from './queryPage';
import type { SharedAssignment, AssignmentResponse, CreateAssignmentParams } from '../../types';

/** created_at 내림차순 — 청킹으로 나눠 받은 결과는 서버 .order()가 전체 정렬이 아니라 합친 뒤 다시 건다 */
function byCreatedAtDesc<T extends { created_at?: string | null }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
}

export async function createAssignment(params: CreateAssignmentParams): Promise<string> {
  const userId = await getCurrentUserId();
  const { title, description, classId, problemIds, studentIds, dueDate } = params;

  // 학급 소속 학원을 과제에 기록 — 원장 개요/교사 실적의 학원 필터가 academy_id를 참조
  let academyId: string | null = null;
  if (classId) {
    const { data: cls, error: clsError } = await supabase
      .from('classes')
      .select('academy_id')
      .eq('id', classId)
      .maybeSingle();
    if (clsError) throw clsError;
    academyId = cls?.academy_id ?? null;
  }

  const { data, error } = await supabase
    .from('shared_assignments')
    .insert({ title, description, created_by: userId, class_id: classId, due_date: dueDate ?? null, academy_id: academyId })
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
    .select(`
      id, title, description, created_by, class_id, due_date, created_at,
      assignment_problems(id),
      assignment_responses(id)
    `)
    .eq('created_by', userId)
    .order('created_at', { ascending: false });
  if (error) throw error;

  return (data || []).map((a: any) => ({
    id: a.id,
    title: a.title,
    description: a.description,
    created_by: a.created_by,
    class_id: a.class_id,
    due_date: a.due_date,
    created_at: a.created_at,
    problem_count: (a.assignment_problems || []).length,
    completed_count: (a.assignment_responses || []).length,
  }));
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

  // 배정 과제 id를 통째로 .in()에 실으면 414 — 청킹 후 합쳐서 다시 정렬한다.
  const assignments = byCreatedAtDesc(await fetchByIdChunks<any>(ids, (chunk) =>
    supabase
      .from('shared_assignments')
      .select(`
        id, title, description, created_by, class_id, due_date, created_at,
        assignment_problems(id),
        assignment_responses(id, student_id)
      `)
      .in('id', chunk)));

  return assignments.map((a: any) => ({
    id: a.id,
    title: a.title,
    description: a.description,
    created_by: a.created_by,
    class_id: a.class_id,
    due_date: a.due_date,
    created_at: a.created_at,
    problem_count: (a.assignment_problems || []).length,
    completed_count: (a.assignment_responses || []).filter((r: any) => r.student_id === userId).length,
  }));
}

/** 과제 단건 조회 — 풀이 화면의 제목/마감일 표시·마감 판정용. 없거나 권한 없으면 null */
export async function fetchAssignmentById(assignmentId: string): Promise<SharedAssignment | null> {
  const { data, error } = await supabase
    .from('shared_assignments')
    .select('id, title, description, created_by, class_id, due_date, created_at')
    .eq('id', assignmentId)
    .maybeSingle();
  if (error) throw error;
  return (data as SharedAssignment | null) ?? null;
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

/**
 * 학생 본인의 응답만 조회한다.
 *
 * 왜 별도 함수인가: RLS `ar_select`는 `student_id = auth.uid() OR can_view_assignment(...)`인데,
 * `can_view_assignment`는 **과제를 배정받은 학생 본인에게도 true**를 준다(assignment_targets 분기).
 * 그래서 `fetchAssignmentResponses`를 학생 화면에서 쓰면 **같은 반 친구들의 응답까지** 딸려온다.
 * 그 결과 풀지도 않은 문제가 "이미 푼 문제"로 보여 정답이 노출되고, 친구들이 다 풀면
 * 완료 화면이 떠 본인이 과제를 못 푸는 상태가 된다. 학생 화면은 반드시 이 함수를 쓸 것.
 */
export async function fetchMyAssignmentResponses(assignmentId: string): Promise<AssignmentResponse[]> {
  const userId = await getCurrentUserId();
  const { data, error } = await supabase
    .from('assignment_responses')
    .select('*')
    .eq('assignment_id', assignmentId)
    .eq('student_id', userId)
    .order('submitted_at', { ascending: true });
  if (error) throw error;
  return (data || []) as AssignmentResponse[];
}

/** 과제의 **모든** 응답(교사/원장/학부모 검토용). 학생 화면에서는 fetchMyAssignmentResponses를 쓸 것. */
export async function fetchAssignmentResponses(assignmentId: string): Promise<AssignmentResponse[]> {
  const { data, error } = await supabase
    .from('assignment_responses')
    .select('*')
    .eq('assignment_id', assignmentId)
    .order('submitted_at', { ascending: true });
  if (error) throw error;
  const responses = (data || []) as AssignmentResponse[];

  // 학생 이름/이메일 병합 — profiles와 FK 조인 관계가 없어 2-쿼리. 실패해도 응답 목록은 반환
  // (이름은 **장식**이다. 그것 때문에 채점 화면 전체를 못 열게 만들 이유가 없다).
  const studentIds = Array.from(new Set(responses.map((r) => r.student_id)));
  if (studentIds.length > 0) {
    try {
      const profiles = await fetchByIdChunks<any>(studentIds, (chunk) =>
        supabase.from('profiles').select('user_id, name, email').in('user_id', chunk));
      const byId = new Map(profiles.map((p: any) => [p.user_id, p]));
      for (const r of responses) {
        const p = byId.get(r.student_id);
        if (p) {
          r.student_name = p.name ?? null;
          r.student_email = p.email ?? null;
        }
      }
    } catch {
      // 이름 병합 실패는 무시 — 응답 목록 자체는 이미 확보돼 있다
    }
  }
  return responses;
}

/**
 * 과제 작성자의 수동 채점(서술형 확정 포함) — RLS "Assignment creators can grade responses"로 허용.
 *
 * 그 정책은 **과제 작성자만** 통과시킨다. 그런데 상세 화면은 원장·공동 담임에게도 열려 있어,
 * 그들이 O/X를 누르면 0행 UPDATE + error null이 돌아왔다. 화면만 바뀌고 저장은 안 돼
 * 새로고침하면 미채점으로 되돌아가고, 그 사이 정답률 통계는 영영 어긋난 채로 남는다.
 * `.select('id')`로 실제 갱신된 행을 받아 0행이면 던진다.
 */
export async function gradeAssignmentResponse(responseId: string, isCorrect: boolean): Promise<void> {
  const { data, error } = await supabase
    .from('assignment_responses')
    .update({ is_correct: isCorrect })
    .eq('id', responseId)
    .select('id');
  if (error) throw error;
  assertAffected(data, '채점을 저장하지 못했습니다. 과제를 만든 교사만 채점할 수 있습니다.');
}

/**
 * 과제 삭제.
 *
 * RLS `sa_delete`는 `created_by = auth.uid()`뿐이다. 상세 화면은 원장에게도 열려 있어
 * 원장이 삭제를 누르면 0행 삭제 + error null → 대시보드로 이동하지만 과제는 그대로 남았다.
 */
export async function deleteAssignment(assignmentId: string): Promise<void> {
  const { data, error } = await supabase
    .from('shared_assignments')
    .delete()
    .eq('id', assignmentId)
    .select('id');
  if (error) throw error;
  assertAffected(data, '과제를 삭제하지 못했습니다. 삭제 권한이 없거나 이미 삭제된 과제입니다.');
}

export async function fetchChildAssignments(childId: string): Promise<SharedAssignment[]> {
  const { data: targets, error: tErr } = await supabase
    .from('assignment_targets')
    .select('assignment_id')
    .eq('student_id', childId);
  if (tErr) throw tErr;

  const ids = Array.from(new Set((targets || []).map(t => t.assignment_id)));
  if (ids.length === 0) return [];

  // 세 조회 모두 과제 id 전량을 .in()에 싣던 자리 — 청킹한다.
  // 과제 목록은 청크별 .order()가 전체 정렬이 아니므로 합친 뒤 다시 정렬한다.
  const assignments = byCreatedAtDesc(await fetchByIdChunks<any>(ids, (chunk) =>
    supabase
      .from('shared_assignments')
      .select('id, title, description, created_by, class_id, due_date, created_at')
      .in('id', chunk)));

  const apRows = await fetchByIdChunks<{ assignment_id: string }>(ids, (chunk) =>
    supabase.from('assignment_problems').select('assignment_id').in('assignment_id', chunk));

  const arRows = await fetchByIdChunks<{ assignment_id: string; is_correct: boolean | null }>(ids, (chunk) =>
    supabase
      .from('assignment_responses')
      .select('assignment_id, is_correct')
      .in('assignment_id', chunk)
      .eq('student_id', childId));

  // 과제당 전체 순회(O(n*m))를 피해 assignment_id로 한 번만 그룹핑한다.
  const problemCounts = new Map<string, number>();
  for (const r of apRows) problemCounts.set(r.assignment_id, (problemCounts.get(r.assignment_id) ?? 0) + 1);
  const responsesByAssignment = new Map<string, Array<{ is_correct: boolean | null }>>();
  for (const r of arRows) {
    const arr = responsesByAssignment.get(r.assignment_id) ?? [];
    arr.push({ is_correct: r.is_correct });
    responsesByAssignment.set(r.assignment_id, arr);
  }

  return assignments.map(a => {
    const responses = responsesByAssignment.get(a.id) ?? [];
    return {
      ...a,
      problem_count: problemCounts.get(a.id) ?? 0,
      completed_count: responses.length,
      correct_count: responses.filter(r => r.is_correct === true).length,
      incorrect_count: responses.filter(r => r.is_correct === false).length,
      ungraded_count: responses.filter(r => r.is_correct === null).length,
    };
  });
}

export async function fetchAssignmentProblems(assignmentId: string) {
  const { data, error } = await supabase
    .from('assignment_problems')
    .select('id, assignment_id, problem_id, order_index, generated_problems(*)')
    .eq('assignment_id', assignmentId)
    .order('order_index', { ascending: true });
  if (error) throw error;

  return (data || []).map((ap: any) => ({
    id: ap.id,
    assignment_id: ap.assignment_id,
    problem_id: ap.problem_id,
    order_index: ap.order_index,
    problem: ap.generated_problems ?? undefined,
  }));
}
