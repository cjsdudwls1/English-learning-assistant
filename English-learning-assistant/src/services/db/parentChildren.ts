import { supabase } from '../supabaseClient';
import { getCurrentUserId } from './auth';

export interface ChildInfo {
  user_id: string;
  email: string;
  grade: string | null;
}

export async function linkChild(childEmail: string): Promise<void> {
  const parentId = await getCurrentUserId();
  const { data: profile, error: pErr } = await supabase
    .from('profiles')
    .select('user_id, role')
    .eq('email', childEmail)
    .maybeSingle();
  if (pErr) throw pErr;
  if (!profile) throw new Error('해당 이메일의 학생을 찾을 수 없습니다.');
  if (profile.role !== 'student') throw new Error('학생 계정만 자녀로 등록할 수 있습니다.');

  const { error } = await supabase
    .from('parent_children')
    .insert({ parent_id: parentId, child_id: profile.user_id });
  if (error) throw error;
}

export async function fetchMyChildren(): Promise<ChildInfo[]> {
  const parentId = await getCurrentUserId();
  const { data, error } = await supabase
    .from('parent_children')
    .select('child_id')
    .eq('parent_id', parentId);
  if (error) throw error;

  const childIds = (data || []).map(r => r.child_id);
  if (childIds.length === 0) return [];

  const { data: profiles, error: pErr } = await supabase
    .from('profiles')
    .select('user_id, email, grade')
    .in('user_id', childIds);
  if (pErr) throw pErr;

  return (profiles || []).map(p => ({
    user_id: p.user_id,
    email: p.email ?? '',
    grade: p.grade ?? null,
  }));
}

export async function unlinkChild(childId: string): Promise<void> {
  const parentId = await getCurrentUserId();
  const { error } = await supabase
    .from('parent_children')
    .delete()
    .eq('parent_id', parentId)
    .eq('child_id', childId);
  if (error) throw error;
}
