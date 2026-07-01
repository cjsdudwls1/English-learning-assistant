import { supabase } from './supabaseClient';
import { getCurrentUserId } from './db';
import { buildTaxonomyMaps, validateAndTranslateDepths } from '../utils/taxonomyMapping';

// labels 쿼리 결과 행의 로컬 타입 (problems 관계 포함)
interface LabelRowWithProblems {
  classification: Record<string, unknown> | null;
  is_correct: boolean | null;
  user_mark: string | null;
  problems: { session_id: string } | { session_id: string }[] | null;
}

// ===== 단계별 쿼리 헬퍼 (PostgREST nested filter 풀스캔 회피) =====
// 기존: labels !inner problems !inner sessions → labels 풀스캔으로 statement_timeout
// 변경: sessions(user_id) → problems(session_id IN) → labels(problem_id IN) 단계별 PK/FK 인덱스 활용

const ID_CHUNK = 500;

export async function fetchSessionsForUser(
  userId: string,
  startDate?: Date,
  endDate?: Date,
): Promise<Array<{ id: string; created_at: string }>> {
  let q = supabase.from('sessions').select('id, created_at').eq('user_id', userId);
  if (startDate) q = q.gte('created_at', startDate.toISOString());
  if (endDate) {
    const e = new Date(endDate);
    e.setHours(23, 59, 59, 999);
    q = q.lte('created_at', e.toISOString());
  }
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

export async function fetchSessionsForUsers(
  userIds: string[],
  startDateIso?: string,
  endDateIso?: string,
): Promise<Array<{ id: string; user_id: string; created_at: string }>> {
  if (userIds.length === 0) return [];
  const out: Array<{ id: string; user_id: string; created_at: string }> = [];
  for (let i = 0; i < userIds.length; i += ID_CHUNK) {
    const chunk = userIds.slice(i, i + ID_CHUNK);
    let q = supabase.from('sessions').select('id, user_id, created_at').in('user_id', chunk);
    if (startDateIso) q = q.gte('created_at', startDateIso);
    if (endDateIso) q = q.lte('created_at', endDateIso);
    const { data, error } = await q;
    if (error) throw error;
    out.push(...(data || []));
  }
  return out;
}

export async function fetchProblemsForSessions(
  sessionIds: string[],
): Promise<Array<{ id: string; session_id: string }>> {
  if (sessionIds.length === 0) return [];
  const out: Array<{ id: string; session_id: string }> = [];
  for (let i = 0; i < sessionIds.length; i += ID_CHUNK) {
    const chunk = sessionIds.slice(i, i + ID_CHUNK);
    const { data, error } = await supabase
      .from('problems')
      .select('id, session_id')
      .in('session_id', chunk);
    if (error) throw error;
    out.push(...(data || []));
  }
  return out;
}

export interface LabelRowFlat {
  problem_id: string;
  classification: Record<string, unknown> | null;
  is_correct: boolean | null;
  user_mark: string | null;
}

export async function fetchLabelsForProblems(
  problemIds: string[],
): Promise<LabelRowFlat[]> {
  if (problemIds.length === 0) return [];
  const out: LabelRowFlat[] = [];
  for (let i = 0; i < problemIds.length; i += ID_CHUNK) {
    const chunk = problemIds.slice(i, i + ID_CHUNK);
    const { data, error } = await supabase
      .from('labels')
      .select('problem_id, classification, is_correct, user_mark')
      .in('problem_id', chunk)
      .not('user_mark', 'is', null);
    if (error) throw error;
    out.push(...((data || []) as LabelRowFlat[]));
  }
  return out;
}

// ===== A+B: 생성문제 기반 풀이(과제 응답 + 완료된 생성문제 풀이) 합산 =====
// 유형별 정오답 통계를 월별/일별 풀이 통계와 정합시키기 위해, labels(이미지 분석 추출문제)
// 외에 generated_problems 기반 풀이도 동일 통계에 합산한다.
//  - 과제 응답(assignment_responses): student_id 기준. classification 없으면 "미분류" 버킷
//  - 완료된 생성문제 풀이(problem_solving_sessions): completed_at not null
// problem_id → generated_problems.classification 조인으로 유형 집계.
// (labels와 별개 테이블이므로 중복 카운트 없음)

export interface GenSolvedRow {
  is_correct: boolean | null;
  classification: Record<string, unknown> | null;
}

// generated_problems.id → classification 매핑 (청크 조회)
async function fetchGeneratedClassifications(
  problemIds: string[],
): Promise<Map<string, Record<string, unknown> | null>> {
  const map = new Map<string, Record<string, unknown> | null>();
  for (let i = 0; i < problemIds.length; i += ID_CHUNK) {
    const chunk = problemIds.slice(i, i + ID_CHUNK);
    const { data, error } = await supabase
      .from('generated_problems')
      .select('id, classification')
      .in('id', chunk);
    if (error) throw error;
    for (const r of data || []) {
      map.set(r.id, (r.classification ?? null) as Record<string, unknown> | null);
    }
  }
  return map;
}

// 사용자의 과제 응답 + 완료된 생성문제 풀이를 분류 정보와 함께 조회
export async function fetchGeneratedSolvedRowsForUser(
  userId: string,
  startDate?: Date,
  endDate?: Date,
): Promise<GenSolvedRow[]> {
  const startIso = startDate ? startDate.toISOString() : undefined;
  let endIso: string | undefined;
  if (endDate) {
    const e = new Date(endDate);
    e.setHours(23, 59, 59, 999);
    endIso = e.toISOString();
  }

  // 과제 응답 (student_id, submitted_at 기간)
  let aq = supabase
    .from('assignment_responses')
    .select('problem_id, is_correct, submitted_at')
    .eq('student_id', userId);
  if (startIso) aq = aq.gte('submitted_at', startIso);
  if (endIso) aq = aq.lte('submitted_at', endIso);

  // 완료된 생성문제 풀이 (user_id, completed_at not null & 기간)
  let sq = supabase
    .from('problem_solving_sessions')
    .select('problem_id, is_correct, completed_at')
    .eq('user_id', userId)
    .not('completed_at', 'is', null);
  if (startIso) sq = sq.gte('completed_at', startIso);
  if (endIso) sq = sq.lte('completed_at', endIso);

  const [aRes, sRes] = await Promise.all([aq, sq]);
  if (aRes.error) throw aRes.error;
  if (sRes.error) throw sRes.error;

  const raw: Array<{ problem_id: string; is_correct: boolean | null }> = [];
  for (const r of (aRes.data || []) as Array<{ problem_id: string | null; is_correct: boolean | null }>) {
    if (r.problem_id) raw.push({ problem_id: r.problem_id, is_correct: r.is_correct });
  }
  for (const r of (sRes.data || []) as Array<{ problem_id: string | null; is_correct: boolean | null }>) {
    if (r.problem_id) raw.push({ problem_id: r.problem_id, is_correct: r.is_correct });
  }
  if (raw.length === 0) return [];

  const problemIds = Array.from(new Set(raw.map((r) => r.problem_id)));
  const clsMap = await fetchGeneratedClassifications(problemIds);

  return raw.map((r) => ({
    is_correct: r.is_correct,
    classification: clsMap.get(r.problem_id) ?? null,
  }));
}

// statsMap에 단일 row의 집계를 누적하는 헬퍼
function addToStatsMap(
  statsMap: Map<string, StatsNode>,
  row: LabelRowWithProblems,
  key: string,
  d1: string,
  d2?: string,
  d3?: string,
  d4?: string,
): void {
  if (!key || !d1) return;
  if (!statsMap.has(key)) {
    statsMap.set(key, {
      depth1: d1,
      ...(d2 && { depth2: d2 }),
      ...(d3 && { depth3: d3 }),
      ...(d4 && { depth4: d4 }),
      correct_count: 0,
      incorrect_count: 0,
      total_count: 0,
      children: [],
      sessionIds: [],
    });
  }
  const s = statsMap.get(key)!;
  if (row.user_mark !== null && row.user_mark !== undefined) {
    s.total_count++;
    if (row.is_correct) s.correct_count++; else s.incorrect_count++;
    const p = Array.isArray(row.problems) ? row.problems[0] : row.problems;
    const sid = p?.session_id;
    if (sid && !s.sessionIds?.includes(sid)) s.sessionIds?.push(sid);
  }
}

// flat label row를 LabelRowWithProblems 형태로 감싸기 (addToStatsMap 호환)
function wrapLabelRow(row: LabelRowFlat, problemToSession: Map<string, string>): LabelRowWithProblems {
  return {
    classification: row.classification,
    is_correct: row.is_correct,
    user_mark: row.user_mark,
    problems: { session_id: problemToSession.get(row.problem_id) || '' },
  };
}

// statsMap을 계층 트리(rootNodes)로 변환하는 헬퍼
function buildHierarchyFromMap(statsMap: Map<string, StatsNode>): StatsNode[] {
  const rootNodes: StatsNode[] = [];
  const nodeMap = new Map<string, StatsNode>();
  for (const [key, node] of statsMap) nodeMap.set(key, node);

  for (const [key, node] of statsMap) {
    if (key.includes('_')) {
      const parts = key.split('_');
      const parentKey = parts.slice(0, parts.length - 1).join('_');
      const parent = nodeMap.get(parentKey);
      if (parent) {
        if (!parent.children) parent.children = [];
        parent.children.push(node);
      }
    } else {
      rootNodes.push(node);
    }
  }
  return rootNodes;
}

export interface TypeStatsRow {
  depth1: string | null;
  depth2: string | null;
  depth3: string | null;
  depth4: string | null;
  correct_count: number;
  incorrect_count: number;
  total_count: number;
}

export interface StatsNode {
  depth1: string;
  depth2?: string;
  depth3?: string;
  depth4?: string;
  correct_count: number;
  incorrect_count: number;
  total_count: number;
  children?: StatsNode[];
  sessionIds?: string[]; // 해당 카테고리의 세션 ID들
}

export async function fetchStatsByType(startDate?: Date, endDate?: Date, language: 'ko' | 'en' = 'ko'): Promise<TypeStatsRow[]> {
  const userId = await getCurrentUserId();

  const maps = await buildTaxonomyMaps();
  const statsMap = new Map<string, TypeStatsRow>();

  // 단일 분류행을 유형별 맵에 누적 (depth 없으면 "미분류" 버킷으로 key='___')
  const accumulate = (classification: Record<string, unknown>, isCorrect: boolean | null) => {
    const { depth1, depth2, depth3, depth4 } = validateAndTranslateDepths(classification, maps, language);
    const key = `${(depth1 || '')}_${(depth2 || '')}_${(depth3 || '')}_${(depth4 || '')}`;
    if (!statsMap.has(key)) {
      statsMap.set(key, {
        depth1: depth1 || null,
        depth2: depth2 || null,
        depth3: depth3 || null,
        depth4: depth4 || null,
        correct_count: 0,
        incorrect_count: 0,
        total_count: 0,
      });
    }
    const stats = statsMap.get(key)!;
    stats.total_count++;
    if (isCorrect) stats.correct_count++;
    else stats.incorrect_count++;
  };

  // (1) 이미지 분석 추출문제(labels)
  const sessions = await fetchSessionsForUser(userId, startDate, endDate);
  if (sessions.length > 0) {
    const problems = await fetchProblemsForSessions(sessions.map((s) => s.id));
    if (problems.length > 0) {
      const labels = await fetchLabelsForProblems(problems.map((p) => p.id));
      for (const row of labels) {
        if (row.user_mark === null || row.user_mark === undefined) continue;
        accumulate(row.classification || {}, row.is_correct);
      }
    }
  }

  // (2) 생성문제 기반 풀이(과제 응답 + 완료된 생성문제 풀이) — 월별/일별 통계와 정합
  const genRows = await fetchGeneratedSolvedRowsForUser(userId, startDate, endDate);
  for (const row of genRows) {
    accumulate(row.classification || {}, row.is_correct);
  }

  return Array.from(statsMap.values());
}

// 계층 구조 통계 집계 (모든 depth 레벨)
// studentId를 전달하면 해당 학생의 통계를 조회 (선생님/학부모/학원장용)
export async function fetchHierarchicalStats(startDate?: Date, endDate?: Date, language: 'ko' | 'en' = 'ko', studentId?: string): Promise<StatsNode[]> {
  const userId = studentId ?? await getCurrentUserId();

  const maps = await buildTaxonomyMaps();
  const statsMap = new Map<string, StatsNode>();

  // 분류행을 4개 depth 레벨에 누적. 미분류(depth1 없음)는 '미분류' 루트 노드로 집계 →
  // 도넛/바(fetchStatsByType)와 총계 일치(표에서 미분류가 빠져 합계 불일치하던 버그 수정).
  const accumulate = (wrapped: LabelRowWithProblems, classification: Record<string, unknown>) => {
    const { koDepth1, koDepth2, koDepth3, koDepth4, depth1, depth2, depth3, depth4 } = validateAndTranslateDepths(classification, maps, language);
    if (!depth1) {
      const uncKey = 'UNCLASSIFIED'; // 언더스코어 없음 → buildHierarchyFromMap에서 루트 노드로 처리
      const uncLabel = language === 'en' ? 'Unclassified' : '미분류';
      if (!statsMap.has(uncKey)) {
        statsMap.set(uncKey, { depth1: uncLabel, correct_count: 0, incorrect_count: 0, total_count: 0, children: [], sessionIds: [] });
      }
      const s = statsMap.get(uncKey)!;
      if (wrapped.user_mark !== null && wrapped.user_mark !== undefined) {
        s.total_count++;
        if (wrapped.is_correct) s.correct_count++; else s.incorrect_count++;
        const p = Array.isArray(wrapped.problems) ? wrapped.problems[0] : wrapped.problems;
        const sid = p?.session_id;
        if (sid && !s.sessionIds?.includes(sid)) s.sessionIds?.push(sid);
      }
      return;
    }
    const key1 = koDepth1;
    const key2 = koDepth1 && koDepth2 ? `${koDepth1}_${koDepth2}` : '';
    const key3 = koDepth1 && koDepth2 && koDepth3 ? `${koDepth1}_${koDepth2}_${koDepth3}` : '';
    const key4 = koDepth1 && koDepth2 && koDepth3 && koDepth4 ? `${koDepth1}_${koDepth2}_${koDepth3}_${koDepth4}` : '';
    if (depth1) addToStatsMap(statsMap, wrapped, key1, depth1);
    if (depth1 && depth2) addToStatsMap(statsMap, wrapped, key2, depth1, depth2);
    if (depth1 && depth2 && depth3) addToStatsMap(statsMap, wrapped, key3, depth1, depth2, depth3);
    if (depth1 && depth2 && depth3 && depth4) addToStatsMap(statsMap, wrapped, key4, depth1, depth2, depth3, depth4);
  };

  // (1) 이미지 분석 추출문제(labels)
  const sessions = await fetchSessionsForUser(userId, startDate, endDate);
  if (sessions.length > 0) {
    const problems = await fetchProblemsForSessions(sessions.map((s) => s.id));
    if (problems.length > 0) {
      const problemToSession = new Map<string, string>();
      for (const p of problems) problemToSession.set(p.id, p.session_id);
      const labels = await fetchLabelsForProblems(problems.map((p) => p.id));
      for (const flat of labels) {
        accumulate(wrapLabelRow(flat, problemToSession), flat.classification || {});
      }
    }
  }

  // (2) 생성문제 기반 풀이 — 분류 가능한 것만 계층에 반영(미분류는 자동 제외)
  const genRows = await fetchGeneratedSolvedRowsForUser(userId, startDate, endDate);
  for (const row of genRows) {
    const wrapped: LabelRowWithProblems = {
      classification: row.classification,
      is_correct: row.is_correct,
      user_mark: 'solved',
      problems: null,
    };
    accumulate(wrapped, row.classification || {});
  }

  return buildHierarchyFromMap(statsMap);
}

// 학급 전체 학생 대상 택사노미 계층 통계
export async function fetchClassHierarchicalStats(classId: string, language: 'ko' | 'en' = 'ko'): Promise<StatsNode[]> {
  // 학급 학생 ID 조회
  const { data: members, error: mErr } = await supabase
    .from('class_members')
    .select('user_id')
    .eq('class_id', classId)
    .eq('role', 'student');
  if (mErr) throw mErr;

  const studentIds = (members || []).map((m) => m.user_id);
  if (studentIds.length === 0) return [];

  const maps = await buildTaxonomyMaps();

  const sessions = await fetchSessionsForUsers(studentIds);
  if (sessions.length === 0) return [];
  const problems = await fetchProblemsForSessions(sessions.map((s) => s.id));
  if (problems.length === 0) return [];
  const problemToSession = new Map<string, string>();
  for (const p of problems) problemToSession.set(p.id, p.session_id);
  const labels = await fetchLabelsForProblems(problems.map((p) => p.id));

  const statsMap = new Map<string, StatsNode>();

  for (const flat of labels) {
    const wrapped = wrapLabelRow(flat, problemToSession);
    const classification = flat.classification || {};
    const { koDepth1, koDepth2, koDepth3, koDepth4, depth1, depth2, depth3, depth4 } = validateAndTranslateDepths(classification, maps, language);

    const key1 = koDepth1;
    const key2 = koDepth1 && koDepth2 ? `${koDepth1}_${koDepth2}` : '';
    const key3 = koDepth1 && koDepth2 && koDepth3 ? `${koDepth1}_${koDepth2}_${koDepth3}` : '';
    const key4 = koDepth1 && koDepth2 && koDepth3 && koDepth4 ? `${koDepth1}_${koDepth2}_${koDepth3}_${koDepth4}` : '';

    if (depth1) addToStatsMap(statsMap, wrapped, key1, depth1);
    if (depth1 && depth2) addToStatsMap(statsMap, wrapped, key2, depth1, depth2);
    if (depth1 && depth2 && depth3) addToStatsMap(statsMap, wrapped, key3, depth1, depth2, depth3);
    if (depth1 && depth2 && depth3 && depth4) addToStatsMap(statsMap, wrapped, key4, depth1, depth2, depth3, depth4);
  }

  return buildHierarchyFromMap(statsMap);
}
