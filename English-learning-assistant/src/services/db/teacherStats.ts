import { supabase } from '../supabaseClient';

export interface TeacherPerformance {
  userId: string;
  email: string;
  classCount: number;
  assignmentCount: number;
}

export async function fetchTeacherPerformances(): Promise<TeacherPerformance[]> {
  const { data: teachers, error: tErr } = await supabase
    .from('profiles')
    .select('user_id, email')
    .eq('role', 'teacher');
  if (tErr) throw tErr;
  if (!teachers || teachers.length === 0) return [];

  const teacherIds = teachers.map(t => t.user_id);

  const { data: classes, error: cErr } = await supabase
    .from('classes')
    .select('created_by')
    .in('created_by', teacherIds);
  if (cErr) throw cErr;

  const { data: assignments, error: aErr } = await supabase
    .from('shared_assignments')
    .select('created_by')
    .in('created_by', teacherIds);
  if (aErr) throw aErr;

  return teachers.map(t => ({
    userId: t.user_id,
    email: t.email ?? '',
    classCount: (classes || []).filter(c => c.created_by === t.user_id).length,
    assignmentCount: (assignments || []).filter(a => a.created_by === t.user_id).length,
  }));
}
