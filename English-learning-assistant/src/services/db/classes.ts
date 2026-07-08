import { supabase } from '../supabaseClient';
import { getCurrentUserId } from './auth';
import type { ClassInfo, ClassMember } from '../../types';

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
    .select('id, name, description, created_by, created_at')
    .order('created_at', { ascending: false });
  if (error) throw error;

  if (!data || data.length === 0) return [];

  const ids = data.map(c => c.id);
  const { data: members, error: mErr } = await supabase
    .from('class_members')
    .select('class_id, role')
    .in('class_id', ids);
  if (mErr) throw mErr;

  return data.map(cls => ({
    ...cls,
    member_count: (members || []).filter(m => m.class_id === cls.id).length,
    student_count: (members || []).filter(m => m.class_id === cls.id && m.role === 'student').length,
  }));
}

export async function fetchMyClasses(): Promise<ClassInfo[]> {
  const userId = await getCurrentUserId();
  
  const { data: myMembers } = await supabase
    .from('class_members')
    .select('class_id')
    .eq('user_id', userId);
    
  const joinedClassIds = myMembers?.map(m => m.class_id) || [];
  
  let query = supabase.from('classes').select('id, name, description, created_by, created_at');
  if (joinedClassIds.length > 0) {
    query = query.or(`created_by.eq.${userId},id.in.(${joinedClassIds.join(',')})`);
  } else {
    query = query.eq('created_by', userId);
  }

  const { data, error } = await query.order('created_at', { ascending: false });
  if (error) throw error;

  if (!data || data.length === 0) return [];

  const ids = data.map(c => c.id);
  const { data: members, error: mErr } = await supabase
    .from('class_members')
    .select('class_id, role')
    .in('class_id', ids);
  if (mErr) throw mErr;

  return data.map(cls => ({
    ...cls,
    member_count: (members || []).filter(m => m.class_id === cls.id).length,
    student_count: (members || []).filter(m => m.class_id === cls.id && m.role === 'student').length,
  }));
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

  // 프로필은 .in() 일괄 조회(멤버별 단건 N+1 제거). 조회 실패해도 멤버 목록은 반환.
  const userIds = Array.from(new Set(rows.map(m => m.user_id)));
  const { data: profiles } = await supabase
    .from('profiles')
    .select('user_id, email, name')
    .in('user_id', userIds);
  const byId = new Map((profiles || []).map(p => [p.user_id, p]));

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

export async function deleteClass(classId: string): Promise<void> {
  const { error } = await supabase
    .from('classes')
    .delete()
    .eq('id', classId);
  if (error) throw error;
}
