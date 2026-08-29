import { supabase } from '../supabaseClient';
import { fetchAllPages, fetchByIdChunks, fetchByIdChunksPaged } from './queryPage';

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

interface ClassRow { id: string; created_by: string }
interface AssignmentRow { id: string; created_by: string; class_id: string | null; academy_id: string | null }

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

  // 교사 id를 통째로 .in()에 실으면 큰 학원에서 URL이 414로 죽는다 — 청킹한다.
  // 학원 지정이 없을 때는 플랫폼 전체 교사라 max_rows(1000) 절단을 피해 페이지네이션한다.
  type ProfileRow = { user_id: string; email: string | null; name: string | null };
  const teachers: ProfileRow[] = teacherIds
    ? await fetchByIdChunks<ProfileRow>(teacherIds, (chunk) =>
        supabase.from('profiles').select('user_id, email, name').eq('role', 'teacher').in('user_id', chunk))
    : await fetchAllPages<ProfileRow>((from, to) =>
        supabase.from('profiles').select('user_id, email, name').eq('role', 'teacher').order('user_id').range(from, to));
  if (teachers.length === 0) return [];

  const ids = teachers.map(t => t.user_id);
  const teacherIdSet = new Set(ids);

  // 교사가 "담당"하는 학급의 정의는 DB 헬퍼 is_class_admin과 같아야 한다:
  //   classes.created_by = 교사  ∪  class_members(role='teacher')에 그 교사가 있음.
  // 예전에는 created_by만 셌다 — 공동 담임으로만 들어간 학급이 0으로 나와,
  // 같은 학원을 보는 academies.ts의 학급 수와 숫자가 서로 어긋났다.
  const teacherMemberships = await fetchByIdChunksPaged<{ class_id: string; user_id: string }>(
    ids,
    (chunk, from, to) => supabase
      .from('class_members')
      .select('class_id, user_id')
      .eq('role', 'teacher')
      .in('user_id', chunk)
      .order('id').range(from, to),
  );

  // academyId가 있으면 학원 소속 전체 학급을 조회(과제 class_id 매칭용),
  // 없으면 담당 교사가 만들었거나(created_by) 공동 담임으로 들어간 학급을 합쳐 조회.
  let classes: ClassRow[];
  if (academyId) {
    classes = await fetchAllPages<ClassRow>((from, to) =>
      supabase.from('classes').select('id, created_by').eq('academy_id', academyId).order('id').range(from, to));
  } else {
    const memberClassIds = Array.from(new Set(teacherMemberships.map(m => m.class_id)));
    const own = await fetchByIdChunksPaged<ClassRow>(ids, (chunk, from, to) =>
      supabase.from('classes').select('id, created_by').in('created_by', chunk).order('id').range(from, to));
    const joined = await fetchByIdChunks<ClassRow>(memberClassIds, (chunk) =>
      supabase.from('classes').select('id, created_by').in('id', chunk));
    const byId = new Map<string, ClassRow>();
    for (const c of [...own, ...joined]) byId.set(c.id, c);
    classes = Array.from(byId.values());
  }
  const academyClassIds = new Set(classes.map(c => c.id));

  // 교사별 담당 학급 집합(개설 ∪ 공동 담임). 집합이라 두 조건에 다 걸려도 한 번만 센다.
  const classesByTeacher = new Map<string, Set<string>>();
  const addClass = (userId: string, classId: string) => {
    if (!teacherIdSet.has(userId)) return;
    const s = classesByTeacher.get(userId) ?? new Set<string>();
    s.add(classId);
    classesByTeacher.set(userId, s);
  };
  for (const c of classes) addClass(c.created_by, c.id);
  // 학원 화면에서는 다른 학원 학급의 공동 담임까지 세지 않도록 조회 범위 안의 학급만 인정한다.
  for (const m of teacherMemberships) if (academyClassIds.has(m.class_id)) addClass(m.user_id, m.class_id);

  // 과제의 academy_id는 과거 데이터에 비어 있을 수 있어 학원 학급(class_id) 매칭으로 보강
  const allAssignments = await fetchByIdChunksPaged<AssignmentRow>(ids, (chunk, from, to) =>
    supabase
      .from('shared_assignments')
      .select('id, created_by, class_id, academy_id')
      .in('created_by', chunk)
      .order('id').range(from, to));
  const assignments = academyId
    ? allAssignments.filter(a => a.academy_id === academyId || academyClassIds.has(a.class_id as string))
    : allAssignments;

  // 과제 → 담당 교사 매핑 후 응답을 교사별로 집계
  const assignmentOwner = new Map<string, string>(assignments.map(a => [a.id, a.created_by]));
  const assignmentIds = Array.from(assignmentOwner.keys());

  const assignmentCounts = new Map<string, number>();
  for (const a of assignments) assignmentCounts.set(a.created_by, (assignmentCounts.get(a.created_by) ?? 0) + 1);

  // 과제 id는 500개씩 청킹(414 회피), 응답 행은 청크마다 .range()로 전량(max_rows 절단 회피).
  // 과제 500건이면 응답은 수천 행이라 청킹만으로는 1000행 절단을 못 막는다.
  const responses = await fetchByIdChunksPaged<{ assignment_id: string; is_correct: boolean | null }>(
    assignmentIds,
    (chunk, from, to) => supabase
      .from('assignment_responses')
      .select('assignment_id, is_correct')
      .in('assignment_id', chunk)
      .order('id').range(from, to),
  );

  interface Acc { total: number; correct: number; graded: number }
  const perTeacher = new Map<string, Acc>();
  for (const r of responses) {
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

  return teachers.map(t => {
    const acc = perTeacher.get(t.user_id) ?? { total: 0, correct: 0, graded: 0 };
    return {
      userId: t.user_id,
      email: t.email ?? '',
      name: t.name ?? null,
      classCount: classesByTeacher.get(t.user_id)?.size ?? 0,
      assignmentCount: assignmentCounts.get(t.user_id) ?? 0,
      responseCount: acc.total,
      gradedCorrectRate: acc.graded > 0 ? Math.round((acc.correct / acc.graded) * 100) : 0,
      ungradedCount: acc.total - acc.graded,
    };
  });
}
