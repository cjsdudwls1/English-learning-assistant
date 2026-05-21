import { supabase } from '../supabaseClient';

export interface TeacherPerformance {
  userId: string;
  email: string;
  classCount: number;
  assignmentCount: number;
}

export async function fetchTeacherPerformances(academyId?: string | null): Promise<TeacherPerformance[]> {
  let teacherIds: string[] | null = null;
  if (academyId) {
    const { data: links, error: lErr } = await supabase
      .from('academy_teachers')
      .select('user_id')
      .eq('academy_id', academyId);
    if (lErr) throw lErr;
    teacherIds = Array.from(new Set((links || []).map(r => r.user_id)));
    if (teacherIds.length === 0) return [];
  }

  let profilesQuery = supabase
    .from('profiles')
    .select('user_id, email')
    .eq('role', 'teacher');
  if (teacherIds) profilesQuery = profilesQuery.in('user_id', teacherIds);

  const { data: teachers, error: tErr } = await profilesQuery;
  if (tErr) throw tErr;
  if (!teachers || teachers.length === 0) return [];

  const ids = teachers.map(t => t.user_id);

  let classesQuery = supabase.from('classes').select('created_by').in('created_by', ids);
  if (academyId) classesQuery = classesQuery.eq('academy_id', academyId);
  const { data: classes, error: cErr } = await classesQuery;
  if (cErr) throw cErr;

  let assignmentsQuery = supabase.from('shared_assignments').select('created_by').in('created_by', ids);
  if (academyId) assignmentsQuery = assignmentsQuery.eq('academy_id', academyId);
  const { data: assignments, error: aErr } = await assignmentsQuery;
  if (aErr) throw aErr;

  return teachers.map(t => ({
    userId: t.user_id,
    email: t.email ?? '',
    classCount: (classes || []).filter(c => c.created_by === t.user_id).length,
    assignmentCount: (assignments || []).filter(a => a.created_by === t.user_id).length,
  }));
}
