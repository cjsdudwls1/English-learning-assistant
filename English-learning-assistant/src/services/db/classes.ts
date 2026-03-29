import { supabase } from '../supabaseClient';
import { getCurrentUserId } from './auth';
import type { ClassInfo, ClassMember } from '../../types';

export async function createClass(name: string, description: string | null): Promise<string> {
  const userId = await getCurrentUserId();
  const { data, error } = await supabase
    .from('classes')
    .insert({ name, description, created_by: userId })
    .select('id')
    .single();
  if (error) throw error;

  const { error: memberError } = await supabase
    .from('class_members')
    .insert({ class_id: data.id, user_id: userId, role: 'teacher' });
  if (memberError) throw memberError;

  return data.id;
}

export async function fetchMyClasses(): Promise<ClassInfo[]> {
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

export async function fetchClassMembers(classId: string): Promise<ClassMember[]> {
  const { data, error } = await supabase
    .from('class_members')
    .select('id, class_id, user_id, role, joined_at')
    .eq('class_id', classId)
    .order('joined_at', { ascending: true });
  if (error) throw error;

  const members: ClassMember[] = [];
  for (const m of data || []) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('email')
      .eq('user_id', m.user_id)
      .maybeSingle();
    members.push({ ...m, email: profile?.email ?? '' });
  }
  return members;
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
