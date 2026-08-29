import { supabase } from '../supabaseClient';
import { getCurrentUserId } from './auth';
import { fetchAllPages, fetchByIdChunks, fetchByIdChunksPaged } from './queryPage';
import type { AcademyHierarchy, StudentDetail, TeacherDetail, ParentSummary } from '../../types';

export interface AcademyMembership {
  id: string;
  name: string;
  description: string | null;
  parent_academy_id: string | null;
  owner_id: string | null;
  created_at: string;
  role: 'director' | 'teacher' | 'student';
}

export interface AcademyMember {
  user_id: string;
  email: string;
  role: 'director' | 'teacher' | 'student';
}

/**
 * 내가 속한 학원 목록.
 *
 * 세 조회의 에러를 **삼키지 않는다**. 이 목록은 화면 전체의 범위를 정하는 1차 데이터다.
 * 원장 갈래만 조용히 실패하면 학원이 없는 계정처럼 보여 "학원 미선택" 상태로 떨어지고,
 * 교사 갈래만 실패하면 같은 사람이 학생으로만 보인다 — 둘 다 "데이터 없음"과 구별되지 않는다.
 * (RLS로 안 보이는 행은 에러가 아니라 0행으로 오므로, 여기서 던져도 정상 케이스는 안 깨진다.)
 */
export async function fetchMyAcademies(userId: string): Promise<AcademyMembership[]> {
  const [dirRes, tchRes, stuRes] = await Promise.all([
    supabase
      .from('academy_directors')
      .select('academy_id, academies(id, name, description, parent_academy_id, owner_id, created_at)')
      .eq('user_id', userId),
    supabase
      .from('academy_teachers')
      .select('academy_id, academies(id, name, description, parent_academy_id, owner_id, created_at)')
      .eq('user_id', userId),
    supabase
      .from('academy_students')
      .select('academy_id, academies(id, name, description, parent_academy_id, owner_id, created_at)')
      .eq('user_id', userId),
  ]);
  if (dirRes.error) throw dirRes.error;
  if (tchRes.error) throw tchRes.error;
  if (stuRes.error) throw stuRes.error;

  const result: AcademyMembership[] = [];
  const seen = new Set<string>();

  for (const row of dirRes.data || []) {
    const a = row.academies as any;
    if (!a || seen.has(a.id)) continue;
    seen.add(a.id);
    result.push({ ...a, role: 'director' });
  }
  for (const row of tchRes.data || []) {
    const a = row.academies as any;
    if (!a || seen.has(a.id)) continue;
    seen.add(a.id);
    result.push({ ...a, role: 'teacher' });
  }
  for (const row of stuRes.data || []) {
    const a = row.academies as any;
    if (!a || seen.has(a.id)) continue;
    seen.add(a.id);
    result.push({ ...a, role: 'student' });
  }

  return result;
}

export async function fetchAcademyById(academyId: string): Promise<AcademyMembership | null> {
  const userId = await getCurrentUserId();
  const academies = await fetchMyAcademies(userId);
  return academies.find(a => a.id === academyId) ?? null;
}

export async function createAcademy(
  name: string,
  description?: string,
  parentAcademyId?: string,
): Promise<string> {
  const userId = await getCurrentUserId();

  const { data, error } = await supabase
    .from('academies')
    .insert({
      name,
      description: description ?? null,
      parent_academy_id: parentAcademyId ?? null,
      owner_id: userId,
    })
    .select('id')
    .single();
  if (error) throw error;

  const { error: dirError } = await supabase
    .from('academy_directors')
    .insert({ academy_id: data.id, user_id: userId });
  if (dirError) throw dirError;

  return data.id;
}

export async function searchUserByEmail(email: string): Promise<{ user_id: string; email: string; role: string | null } | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('user_id, email, role')
    .eq('email', email.trim())
    .maybeSingle();
  if (error) throw error;
  return data;
}

/**
 * 학원 구성원 목록.
 *
 * 세 역할 조회의 에러를 던진다 — 학생 갈래만 실패하면 "학생이 하나도 없는 학원"으로 보이고,
 * 원장이 그 상태로 멤버를 추가/삭제하는 판단을 하게 된다. 이메일 조회 실패도 마찬가지로 던진다
 * (이 화면은 이메일로 사람을 식별하므로 이메일 없는 목록은 쓸 수 없다).
 */
export async function fetchAcademyMembers(academyId: string): Promise<AcademyMember[]> {
  const [dirRes, tchRes, stuRes] = await Promise.all([
    supabase.from('academy_directors').select('user_id').eq('academy_id', academyId),
    supabase.from('academy_teachers').select('user_id').eq('academy_id', academyId),
    supabase.from('academy_students').select('user_id').eq('academy_id', academyId),
  ]);
  if (dirRes.error) throw dirRes.error;
  if (tchRes.error) throw tchRes.error;
  if (stuRes.error) throw stuRes.error;

  const rows: { user_id: string; role: 'director' | 'teacher' | 'student' }[] = [
    ...(dirRes.data || []).map(r => ({ user_id: r.user_id, role: 'director' as const })),
    ...(tchRes.data || []).map(r => ({ user_id: r.user_id, role: 'teacher' as const })),
    ...(stuRes.data || []).map(r => ({ user_id: r.user_id, role: 'student' as const })),
  ];

  if (rows.length === 0) return [];

  // 큰 학원은 구성원이 수백~수천 명이라 .in()을 통째로 실으면 414로 목록이 통째로 안 뜬다.
  const userIds = Array.from(new Set(rows.map(r => r.user_id)));
  const profiles = await fetchByIdChunks<{ user_id: string; email: string | null }>(userIds, (chunk) =>
    supabase.from('profiles').select('user_id, email').in('user_id', chunk));

  const emailMap = new Map<string, string>();
  for (const p of profiles) emailMap.set(p.user_id, p.email || '');

  return rows.map(r => ({
    user_id: r.user_id,
    email: emailMap.get(r.user_id) || '',
    role: r.role,
  }));
}

export async function addAcademyMember(
  academyId: string,
  userId: string,
  role: 'director' | 'teacher' | 'student',
): Promise<void> {
  const table =
    role === 'director' ? 'academy_directors' :
    role === 'teacher' ? 'academy_teachers' :
    'academy_students';
  const { error } = await supabase
    .from(table)
    .insert({ academy_id: academyId, user_id: userId });
  if (error) throw error;
}

export async function removeAcademyMember(
  academyId: string,
  userId: string,
  role: 'director' | 'teacher' | 'student',
): Promise<void> {
  const table =
    role === 'director' ? 'academy_directors' :
    role === 'teacher' ? 'academy_teachers' :
    'academy_students';
  const { error } = await supabase
    .from(table)
    .delete()
    .eq('academy_id', academyId)
    .eq('user_id', userId);
  if (error) throw error;
}

export interface AcademyAssignmentRow { id: string; created_by: string }

/** 학원에 속한 학급 id — 원장 개요·학원 상세가 같은 학급 집합을 보게 하는 단일 출처 */
export async function fetchAcademyClassIds(academyId: string): Promise<string[]> {
  const rows = await fetchAllPages<{ id: string }>((from, to) =>
    supabase.from('classes').select('id').eq('academy_id', academyId).order('id').range(from, to));
  return rows.map(r => r.id);
}

/**
 * 학원에 속한 과제 목록.
 *
 * 소속 판정: `academy_id` 직접 매칭 ∪ 학원 학급(`class_id`) 매칭.
 * 과거 데이터는 `academy_id`가 비어 있어 class_id로만 학원에 이어지는 과제가 있다.
 *
 * 이 규칙을 한 곳에 둔 이유: 원장 대시보드의 '학원 개요'(roleStats.fetchDirectorOverview)와
 * 그 아래 '학원 상세'(fetchAcademyHierarchy)가 **같은 모집단**을 세야 한다. 규칙이 두 벌이면
 * 같은 화면에서 같은 라벨의 숫자가 서로 어긋난다.
 */
export async function fetchAcademyAssignments(
  academyId: string,
  classIds?: string[],
): Promise<AcademyAssignmentRow[]> {
  const ids = classIds ?? await fetchAcademyClassIds(academyId);

  const byId = new Map<string, AcademyAssignmentRow>();
  const byAcademy = await fetchAllPages<AcademyAssignmentRow>((from, to) =>
    supabase.from('shared_assignments').select('id, created_by').eq('academy_id', academyId).order('id').range(from, to));
  for (const r of byAcademy) byId.set(r.id, r);

  // 학급 id를 통째로 .in()에 실으면 학급 많은 학원에서 414 — 청킹하고, 학급당 과제가
  // 1000행을 넘길 수 있으므로 청크마다 .range()로 전량을 받는다.
  const byClass = await fetchByIdChunksPaged<AcademyAssignmentRow>(ids, (chunk, from, to) =>
    supabase.from('shared_assignments').select('id, created_by').in('class_id', chunk).order('id').range(from, to));
  for (const r of byClass) byId.set(r.id, r);

  return Array.from(byId.values());
}

interface ResponseStat { total: number; graded: number; correct: number }

interface AcademyResponseRow {
  assignment_id: string;
  student_id: string;
  is_correct: boolean | null;
}

/** 학원 과제에 달린 응답 전량 — 학생별·교사별 집계를 **같은 행 집합**에서 뽑기 위해 한 번만 읽는다 */
async function fetchResponsesForAssignments(assignmentIds: string[]): Promise<AcademyResponseRow[]> {
  if (assignmentIds.length === 0) return [];
  // 과제 500건이면 응답은 수천 행이다 — 청킹(414 회피)만으로는 max_rows(1000) 절단을 못 막아
  // 청크마다 .range()로 전량을 받는다.
  return fetchByIdChunksPaged<AcademyResponseRow>(assignmentIds, (chunk, from, to) =>
    supabase
      .from('assignment_responses')
      .select('assignment_id, student_id, is_correct')
      .in('assignment_id', chunk)
      .order('id').range(from, to));
}

function accumulate(stats: Map<string, ResponseStat>, key: string, ok: boolean | null): void {
  const e = stats.get(key) ?? { total: 0, graded: 0, correct: 0 };
  e.total++;
  // 채점 계약: is_correct null(미채점)은 정답률 분모에서 제외
  if (typeof ok === 'boolean') {
    e.graded++;
    if (ok) e.correct++;
  }
  stats.set(key, e);
}

async function fetchParentsByStudent(studentIds: string[]): Promise<Map<string, ParentSummary[]>> {
  const result = new Map<string, ParentSummary[]>();
  if (studentIds.length === 0) return result;

  const links = await fetchByIdChunksPaged<{ parent_id: string; child_id: string }>(studentIds, (chunk, from, to) =>
    supabase.from('parent_children').select('parent_id, child_id').in('child_id', chunk).order('id').range(from, to));

  const parentIds = Array.from(new Set(links.map(l => l.parent_id)));
  if (parentIds.length === 0) return result;

  const profiles = await fetchByIdChunks<{ user_id: string; email: string | null }>(parentIds, (chunk) =>
    supabase.from('profiles').select('user_id, email').in('user_id', chunk));

  const emailMap = new Map<string, string>();
  for (const p of profiles) emailMap.set(p.user_id, p.email || '');

  for (const link of links) {
    const arr = result.get(link.child_id) ?? [];
    arr.push({ user_id: link.parent_id, email: emailMap.get(link.parent_id) || '' });
    result.set(link.child_id, arr);
  }
  return result;
}

/**
 * 학원 상세(교사 → 학급 → 학생) 트리와 집계.
 *
 * 집계 모집단 = **이 학원 과제에 달린 응답**(fetchAcademyAssignments 규칙).
 * 예전에는 학생별 집계가 학원과 무관한 전체 응답 + 자습(problem_solving_sessions)까지 더했다.
 * 그래서 (a) 다른 학원에서 푼 것까지 이 학원 화면에 섞이고, (b) 상단 '학원 개요'의 전체 응답
 * (= 학원 과제 응답 수)보다 아래 표의 합이 커졌다.
 *
 * 자습은 학원 과제가 아니므로 여기서 뺀다. 학생 개인의 전체 학습량은 학생을 눌렀을 때 열리는
 * 개인 통계(fetchMonthlySolvingStats)가 자습까지 포함해 보여준다.
 *
 * 교사 집계는 **그 교사가 만든 과제에 달린 응답** 기준이다. 예전에는 담당 학급 학생들의 통계를
 * 통째로 더해서, 학생이 두 교사의 학급에 걸치면 두 교사에게 각각 전부 더해졌다(중복 계산).
 * 응답 한 건은 과제 하나에, 과제 하나는 만든 교사 한 명에 속하므로 지금은 중복이 원천적으로 없다.
 */
export async function fetchAcademyHierarchy(academyId: string): Promise<AcademyHierarchy> {
  const [tchLinks, stuLinks] = await Promise.all([
    supabase.from('academy_teachers').select('user_id').eq('academy_id', academyId),
    supabase.from('academy_students').select('user_id').eq('academy_id', academyId),
  ]);
  if (tchLinks.error) throw tchLinks.error;
  if (stuLinks.error) throw stuLinks.error;

  const teacherIds = Array.from(new Set((tchLinks.data || []).map(r => r.user_id)));
  const studentIds = Array.from(new Set((stuLinks.data || []).map(r => r.user_id)));
  const allUserIds = Array.from(new Set([...teacherIds, ...studentIds]));

  // 구성원 수백~수천 명이면 .in()이 414 — 청킹. 학급은 max_rows 절단을 피해 페이지네이션.
  const [profileRows, classRows] = await Promise.all([
    fetchByIdChunks<{ user_id: string; email: string | null; grade: string | null }>(allUserIds, (chunk) =>
      supabase.from('profiles').select('user_id, email, grade').in('user_id', chunk)),
    fetchAllPages<{ id: string; name: string; created_by: string; academy_id: string }>((from, to) =>
      supabase.from('classes').select('id, name, created_by, academy_id').eq('academy_id', academyId).order('id').range(from, to)),
  ]);

  const profileMap = new Map<string, { email: string; grade: string | null }>();
  for (const p of profileRows) {
    profileMap.set(p.user_id, { email: p.email || '', grade: p.grade ?? null });
  }

  const classIds = classRows.map(c => c.id);
  // 학급이 많으면 멤버 행은 쉽게 1000행을 넘는다 — 청킹 + 페이지네이션 둘 다 필요하다.
  const classMembers = await fetchByIdChunksPaged<{ class_id: string; user_id: string; role: string }>(
    classIds,
    (chunk, from, to) => supabase.from('class_members').select('class_id, user_id, role').in('class_id', chunk).order('id').range(from, to),
  );

  const assignments = await fetchAcademyAssignments(academyId, classIds);
  const assignmentOwner = new Map<string, string>(assignments.map(a => [a.id, a.created_by]));
  const responses = await fetchResponsesForAssignments(assignments.map(a => a.id));

  const parentsMap = await fetchParentsByStudent(studentIds);

  const studentSet = new Set(studentIds);
  const stats = new Map<string, ResponseStat>();        // 학생별
  const teacherStats = new Map<string, ResponseStat>(); // 과제 작성 교사별
  for (const r of responses) {
    if (studentSet.has(r.student_id)) accumulate(stats, r.student_id, r.is_correct);
    const owner = assignmentOwner.get(r.assignment_id);
    if (owner) accumulate(teacherStats, owner, r.is_correct);
  }

  const studentClassMap = new Map<string, string[]>();
  const classStudentMap = new Map<string, string[]>();
  const teacherClassMap = new Map<string, Set<string>>();
  for (const m of classMembers) {
    if (m.role === 'student') {
      const arr = studentClassMap.get(m.user_id) ?? [];
      arr.push(m.class_id);
      studentClassMap.set(m.user_id, arr);
      const sArr = classStudentMap.get(m.class_id) ?? [];
      sArr.push(m.user_id);
      classStudentMap.set(m.class_id, sArr);
    } else if (m.role === 'teacher') {
      const set = teacherClassMap.get(m.user_id) ?? new Set<string>();
      set.add(m.class_id);
      teacherClassMap.set(m.user_id, set);
    }
  }
  // 담당 학급 = 개설(created_by) ∪ 공동 담임(class_members role='teacher') — DB 헬퍼 is_class_admin과 같은 정의
  for (const c of classRows) {
    const set = teacherClassMap.get(c.created_by) ?? new Set<string>();
    set.add(c.id);
    teacherClassMap.set(c.created_by, set);
  }

  const buildStudent = (uid: string): StudentDetail => {
    const prof = profileMap.get(uid) ?? { email: '', grade: null };
    const s = stats.get(uid) ?? { total: 0, graded: 0, correct: 0 };
    // 정답률은 채점된 응답 기준 — 미채점(null)을 오답으로 위조하지 않음
    const rate = s.graded > 0 ? Math.round((s.correct / s.graded) * 100) : 0;
    return {
      user_id: uid,
      email: prof.email,
      grade: prof.grade,
      class_ids: studentClassMap.get(uid) ?? [],
      parents: parentsMap.get(uid) ?? [],
      total_count: s.total,
      graded_count: s.graded,
      correct_count: s.correct,
      correct_rate: rate,
    };
  };

  const students: StudentDetail[] = studentIds.map(buildStudent);

  const classNameMap = new Map<string, string>();
  for (const c of classRows) classNameMap.set(c.id, c.name);

  const teachers: TeacherDetail[] = teacherIds.map(tid => {
    const prof = profileMap.get(tid) ?? { email: '', grade: null };
    const tClassIds = Array.from(teacherClassMap.get(tid) ?? []);
    const tStudentIds = Array.from(new Set(
      tClassIds.flatMap(cid => classStudentMap.get(cid) ?? [])
    ));
    const s = teacherStats.get(tid) ?? { total: 0, graded: 0, correct: 0 };
    return {
      user_id: tid,
      email: prof.email,
      classes: tClassIds.map(cid => ({
        id: cid,
        name: classNameMap.get(cid) ?? '(이름 없음)',
        student_count: (classStudentMap.get(cid) ?? []).length,
      })),
      student_ids: tStudentIds,
      total_count: s.total,
      graded_count: s.graded,
      correct_count: s.correct,
      correct_rate: s.graded > 0 ? Math.round((s.correct / s.graded) * 100) : 0,
    };
  });

  const assignedSet = new Set(teachers.flatMap(t => t.student_ids));
  const unassigned_students = students.filter(s => !assignedSet.has(s.user_id));

  return { academy_id: academyId, teachers, students, unassigned_students };
}
