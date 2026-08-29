import { supabase } from '../supabaseClient';
import { getCurrentUserId } from './auth';
import { fetchByIdChunks, assertAffected } from './queryPage';
import type { ClassInfo, ClassMember } from '../../types';

const CLASS_COLUMNS = 'id, name, description, created_by, created_at, academy_id';

type ClassRow = Omit<ClassInfo, 'member_count' | 'student_count'>;

/** 학급 id 목록의 멤버를 청크로 나눠 조회 — 역할별 인원 집계용 */
async function fetchMemberRoles(classIds: string[]) {
  return fetchByIdChunks<{ class_id: string; role: string }>(classIds, (chunk) =>
    supabase.from('class_members').select('class_id, role').in('class_id', chunk));
}

/** 학급 행 + 멤버 행을 합쳐 ClassInfo로 — 멤버는 class_id로 한 번만 그룹핑(학급당 전체 순회 회피) */
function withMemberCounts(classes: ClassRow[], members: { class_id: string; role: string }[]): ClassInfo[] {
  const counts = new Map<string, { member: number; student: number }>();
  for (const m of members) {
    const e = counts.get(m.class_id) ?? { member: 0, student: 0 };
    e.member += 1;
    if (m.role === 'student') e.student += 1;
    counts.set(m.class_id, e);
  }
  return classes.map(cls => {
    const c = counts.get(cls.id) ?? { member: 0, student: 0 };
    return { ...cls, member_count: c.member, student_count: c.student };
  });
}

export async function createClass(name: string, description: string | null, academyId?: string | null): Promise<string> {
  const userId = await getCurrentUserId();
  const { data, error } = await supabase
    .from('classes')
    .insert({ name, description, created_by: userId, academy_id: academyId ?? null })
    .select('id')
    .single();
  if (error) throw error;

  const { error: memberError } = await supabase
    .from('class_members')
    .insert({ class_id: data.id, user_id: userId, role: 'teacher' });
  if (memberError) throw memberError;

  return data.id;
}

export async function fetchAllClasses(): Promise<ClassInfo[]> {
  const { data, error } = await supabase
    .from('classes')
    .select(CLASS_COLUMNS)
    .order('created_at', { ascending: false });
  if (error) throw error;

  if (!data || data.length === 0) return [];

  // 원장 화면은 플랫폼 전체 학급이 대상이라 id 수가 가장 크게 튀는 지점이다 — .in()을 청킹한다.
  const members = await fetchMemberRoles(data.map(c => c.id));
  return withMemberCounts(data as ClassRow[], members);
}

export async function fetchMyClasses(): Promise<ClassInfo[]> {
  const userId = await getCurrentUserId();

  const { data: myMembers, error: memErr } = await supabase
    .from('class_members')
    .select('class_id')
    .eq('user_id', userId);
  if (memErr) throw memErr;

  const joinedClassIds = Array.from(new Set((myMembers || []).map(m => m.class_id)));

  // 기존에는 `or(created_by.eq.X, id.in.(...))` 한 방이었다. 소속 학급 id가 전부 URL 쿼리스트링에
  // 실려 학급이 많은 계정에서 414로 목록이 통째로 안 떴다. 두 조건을 나눠 받고 합친다.
  // 정렬은 서버 .order()가 아니라 **합친 뒤** 다시 건다 — 청크별 정렬은 전체 정렬이 아니다.
  const { data: ownRows, error: ownErr } = await supabase
    .from('classes')
    .select(CLASS_COLUMNS)
    .eq('created_by', userId);
  if (ownErr) throw ownErr;

  const joinedRows = await fetchByIdChunks<ClassRow>(joinedClassIds, (chunk) =>
    supabase.from('classes').select(CLASS_COLUMNS).in('id', chunk));

  const byId = new Map<string, ClassRow>();
  for (const c of [...((ownRows || []) as ClassRow[]), ...joinedRows]) byId.set(c.id, c);
  const classes = Array.from(byId.values())
    .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));

  if (classes.length === 0) return [];

  const members = await fetchMemberRoles(classes.map(c => c.id));
  return withMemberCounts(classes, members);
}

export async function fetchClassMembers(classId: string): Promise<ClassMember[]> {
  const { data, error } = await supabase
    .from('class_members')
    .select('id, class_id, user_id, role, joined_at')
    .eq('class_id', classId)
    .order('joined_at', { ascending: true });
  if (error) throw error;

  const rows = data || [];
  if (rows.length === 0) return [];

  // 프로필은 .in() 일괄 조회(멤버별 단건 N+1 제거). 조회 실패해도 멤버 목록은 반환 —
  // 이름/이메일은 **장식**이고, 그것 하나 때문에 멤버 목록 전체를 못 보게 만들 이유가 없다.
  const userIds = Array.from(new Set(rows.map(m => m.user_id)));
  let profiles: Array<{ user_id: string; email: string | null; name: string | null }> = [];
  try {
    profiles = await fetchByIdChunks(userIds, (chunk) =>
      supabase.from('profiles').select('user_id, email, name').in('user_id', chunk));
  } catch {
    profiles = [];
  }
  const byId = new Map(profiles.map(p => [p.user_id, p]));

  return rows.map(m => {
    const p = byId.get(m.user_id);
    return { ...m, email: p?.email ?? '', name: p?.name ?? null };
  });
}

export async function addClassMember(classId: string, email: string, role: 'teacher' | 'student'): Promise<void> {
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('user_id')
    .eq('email', email)
    .maybeSingle();
  if (profileError) throw profileError;
  if (!profile) throw new Error('해당 이메일의 사용자를 찾을 수 없습니다.');

  const { error } = await supabase
    .from('class_members')
    .insert({ class_id: classId, user_id: profile.user_id, role });
  if (error) throw error;
}

export async function removeClassMember(classId: string, userId: string): Promise<void> {
  const { error } = await supabase
    .from('class_members')
    .delete()
    .eq('class_id', classId)
    .eq('user_id', userId);
  if (error) throw error;
}

/**
 * 학급 삭제.
 *
 * RLS `class_delete`는 `created_by = auth.uid() OR role = 'director'`만 허용한다.
 * 공동 담임(class_members role='teacher')이 누르면 **0행 삭제 + error null**이 돌아와
 * 예전에는 성공으로 통과했다 — 목록에서 사라졌다가 새로고침하면 학급이 되살아났다.
 * `.select('id')`로 실제 삭제된 행을 받아 0행이면 던진다.
 */
export async function deleteClass(classId: string): Promise<void> {
  const { data, error } = await supabase
    .from('classes')
    .delete()
    .eq('id', classId)
    .select('id');
  if (error) throw error;
  assertAffected(data, '학급을 삭제하지 못했습니다. 삭제 권한이 없거나 이미 삭제된 학급입니다.');
}
