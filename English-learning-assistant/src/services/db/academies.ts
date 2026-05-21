import { supabase } from '../supabaseClient';
import { getCurrentUserId } from './auth';
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

export async function fetchAcademyMembers(academyId: string): Promise<AcademyMember[]> {
  const [dirRes, tchRes, stuRes] = await Promise.all([
    supabase.from('academy_directors').select('user_id').eq('academy_id', academyId),
    supabase.from('academy_teachers').select('user_id').eq('academy_id', academyId),
    supabase.from('academy_students').select('user_id').eq('academy_id', academyId),
  ]);

  const rows: { user_id: string; role: 'director' | 'teacher' | 'student' }[] = [
    ...(dirRes.data || []).map(r => ({ user_id: r.user_id, role: 'director' as const })),
    ...(tchRes.data || []).map(r => ({ user_id: r.user_id, role: 'teacher' as const })),
    ...(stuRes.data || []).map(r => ({ user_id: r.user_id, role: 'student' as const })),
  ];

  if (rows.length === 0) return [];

  const userIds = Array.from(new Set(rows.map(r => r.user_id)));
  const { data: profiles, error } = await supabase
    .from('profiles')
    .select('user_id, email')
    .in('user_id', userIds);
  if (error) throw error;

  const emailMap = new Map<string, string>();
  for (const p of profiles || []) emailMap.set(p.user_id, p.email || '');

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

interface ResponseStat { total: number; correct: number }

async function fetchResponseStatsByStudent(studentIds: string[]): Promise<Map<string, ResponseStat>> {
  const stats = new Map<string, ResponseStat>();
  if (studentIds.length === 0) return stats;

  const [assignRes, solvingRes] = await Promise.all([
    supabase
      .from('assignment_responses')
      .select('student_id, is_correct')
      .in('student_id', studentIds),
    supabase
      .from('problem_solving_sessions')
      .select('user_id, is_correct')
      .in('user_id', studentIds)
      .not('completed_at', 'is', null),
  ]);
  if (assignRes.error) throw assignRes.error;
  if (solvingRes.error) throw solvingRes.error;

  const bump = (uid: string, ok: boolean | null) => {
    const e = stats.get(uid) ?? { total: 0, correct: 0 };
    e.total++;
    if (ok) e.correct++;
    stats.set(uid, e);
  };
  for (const r of assignRes.data || []) bump(r.student_id, r.is_correct);
  for (const r of solvingRes.data || []) bump(r.user_id, r.is_correct);

  return stats;
}

async function fetchParentsByStudent(studentIds: string[]): Promise<Map<string, ParentSummary[]>> {
  const result = new Map<string, ParentSummary[]>();
  if (studentIds.length === 0) return result;

  const { data: links, error } = await supabase
    .from('parent_children')
    .select('parent_id, child_id')
    .in('child_id', studentIds);
  if (error) throw error;

  const parentIds = Array.from(new Set((links || []).map(l => l.parent_id)));
  if (parentIds.length === 0) return result;

  const { data: profiles, error: pErr } = await supabase
    .from('profiles')
    .select('user_id, email')
    .in('user_id', parentIds);
  if (pErr) throw pErr;

  const emailMap = new Map<string, string>();
  for (const p of profiles || []) emailMap.set(p.user_id, p.email || '');

  for (const link of links || []) {
    const arr = result.get(link.child_id) ?? [];
    arr.push({ user_id: link.parent_id, email: emailMap.get(link.parent_id) || '' });
    result.set(link.child_id, arr);
  }
  return result;
}

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

  const [profilesRes, classesRes] = await Promise.all([
    allUserIds.length
      ? supabase.from('profiles').select('user_id, email, grade').in('user_id', allUserIds)
      : Promise.resolve({ data: [], error: null } as any),
    supabase.from('classes').select('id, name, created_by, academy_id').eq('academy_id', academyId),
  ]);
  if (profilesRes.error) throw profilesRes.error;
  if (classesRes.error) throw classesRes.error;

  const profileMap = new Map<string, { email: string; grade: string | null }>();
  for (const p of profilesRes.data || []) {
    profileMap.set(p.user_id, { email: p.email || '', grade: p.grade ?? null });
  }

  const classIds = (classesRes.data || []).map((c: any) => c.id);
  const { data: classMembers, error: cmErr } = classIds.length
    ? await supabase
        .from('class_members')
        .select('class_id, user_id, role')
        .in('class_id', classIds)
    : { data: [], error: null } as any;
  if (cmErr) throw cmErr;

  const [stats, parentsMap] = await Promise.all([
    fetchResponseStatsByStudent(studentIds),
    fetchParentsByStudent(studentIds),
  ]);

  const studentClassMap = new Map<string, string[]>();
  const classStudentMap = new Map<string, string[]>();
  const teacherClassMap = new Map<string, Set<string>>();
  for (const m of classMembers || []) {
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
  for (const c of classesRes.data || []) {
    const set = teacherClassMap.get((c as any).created_by) ?? new Set<string>();
    set.add((c as any).id);
    teacherClassMap.set((c as any).created_by, set);
  }

  const buildStudent = (uid: string): StudentDetail => {
    const prof = profileMap.get(uid) ?? { email: '', grade: null };
    const s = stats.get(uid) ?? { total: 0, correct: 0 };
    const rate = s.total > 0 ? Math.round((s.correct / s.total) * 100) : 0;
    return {
      user_id: uid,
      email: prof.email,
      grade: prof.grade,
      class_ids: studentClassMap.get(uid) ?? [],
      parents: parentsMap.get(uid) ?? [],
      total_count: s.total,
      correct_count: s.correct,
      correct_rate: rate,
    };
  };

  const students: StudentDetail[] = studentIds.map(buildStudent);

  const classNameMap = new Map<string, string>();
  for (const c of classesRes.data || []) classNameMap.set((c as any).id, (c as any).name);

  const teachers: TeacherDetail[] = teacherIds.map(tid => {
    const prof = profileMap.get(tid) ?? { email: '', grade: null };
    const tClassIds = Array.from(teacherClassMap.get(tid) ?? []);
    const tStudentIds = Array.from(new Set(
      tClassIds.flatMap(cid => classStudentMap.get(cid) ?? [])
    ));
    let total = 0, correct = 0;
    for (const sid of tStudentIds) {
      const s = stats.get(sid);
      if (s) { total += s.total; correct += s.correct; }
    }
    return {
      user_id: tid,
      email: prof.email,
      classes: tClassIds.map(cid => ({
        id: cid,
        name: classNameMap.get(cid) ?? '(이름 없음)',
        student_count: (classStudentMap.get(cid) ?? []).length,
      })),
      student_ids: tStudentIds,
      total_count: total,
      correct_count: correct,
      correct_rate: total > 0 ? Math.round((correct / total) * 100) : 0,
    };
  });

  const assignedSet = new Set(teachers.flatMap(t => t.student_ids));
  const unassigned_students = students.filter(s => !assignedSet.has(s.user_id));

  return { academy_id: academyId, teachers, students, unassigned_students };
}
