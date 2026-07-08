import { supabase } from '../supabaseClient';

export interface TeacherPerformance {
  userId: string;
  email: string;
  name: string | null;
  classCount: number;
  assignmentCount: number;
  /** 담당 과제에 달린 학생 응답 수(미채점 포함) */
  responseCount: number;
  /** 채점 완료(is_correct boolean) 응답 기준 정답률(%). 채점된 응답 없으면 0 */
  gradedCorrectRate: number;
  /** 미채점(is_correct null) 응답 수 — 서술형 수동 채점 대기 등 */
  ungradedCount: number;
}

const CHUNK = 500;

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
    .select('user_id, email, name')
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

  let assignmentsQuery = supabase.from('shared_assignments').select('id, created_by').in('created_by', ids);
  if (academyId) assignmentsQuery = assignmentsQuery.eq('academy_id', academyId);
  const { data: assignments, error: aErr } = await assignmentsQuery;
  if (aErr) throw aErr;

  // 과제 → 담당 교사 매핑 후 응답을 교사별로 집계(과제 id .in() 500 청크)
  const assignmentOwner = new Map<string, string>((assignments || []).map(a => [a.id as string, a.created_by as string]));
  const assignmentIds = Array.from(assignmentOwner.keys());

  interface Acc { total: number; correct: number; graded: number }
  const perTeacher = new Map<string, Acc>();
  for (let i = 0; i < assignmentIds.length; i += CHUNK) {
    const chunk = assignmentIds.slice(i, i + CHUNK);
    const { data: rows, error: rErr } = await supabase
      .from('assignment_responses')
      .select('assignment_id, is_correct')
      .in('assignment_id', chunk);
    if (rErr) throw rErr;
    for (const r of rows || []) {
      const owner = assignmentOwner.get(r.assignment_id);
      if (!owner) continue;
      const acc = perTeacher.get(owner) ?? { total: 0, correct: 0, graded: 0 };
      acc.total++;
      // 채점 계약: is_correct null(미채점)은 정답률 분모에서 제외
      if (typeof r.is_correct === 'boolean') {
        acc.graded++;
        if (r.is_correct === true) acc.correct++;
      }
      perTeacher.set(owner, acc);
    }
  }

  return teachers.map(t => {
    const acc = perTeacher.get(t.user_id) ?? { total: 0, correct: 0, graded: 0 };
    return {
      userId: t.user_id,
      email: t.email ?? '',
      name: t.name ?? null,
      classCount: (classes || []).filter(c => c.created_by === t.user_id).length,
      assignmentCount: (assignments || []).filter(a => a.created_by === t.user_id).length,
      responseCount: acc.total,
      gradedCorrectRate: acc.graded > 0 ? Math.round((acc.correct / acc.graded) * 100) : 0,
      ungradedCount: acc.total - acc.graded,
    };
  });
}
