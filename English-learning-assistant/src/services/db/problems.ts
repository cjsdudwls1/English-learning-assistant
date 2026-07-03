import { supabase } from '../supabaseClient';
import type { ProblemItem } from '../../types';
import { getCurrentUserId } from './auth';
import { isCorrectFromMark, normalizeMark } from '../marks';
import { transformToProblemItem, transformFromLabelJoin } from '../../utils/problemTransform';
import { eqSet } from '../../utils/gradingSafety';
import { resolveImageUrls } from '../../utils/imageUrl';

const ID_CHUNK = 500;

// 특정 세션의 문제 조회
export async function fetchSessionProblems(sessionId: string): Promise<ProblemItem[]> {
  const userId = await getCurrentUserId();

  // 세션 소유권 검증
  const { data: session, error: sessionError } = await supabase
    .from('sessions')
    .select('user_id')
    .eq('id', sessionId)
    .single();

  if (sessionError) throw sessionError;
  if (session.user_id !== userId) {
    throw new Error('이 세션에 접근할 권한이 없습니다.');
  }

  // problems와 labels 조회
  const { data: problems, error: problemsError } = await supabase
    .from('problems')
    .select(`
      id,
      index_in_image,
      content,
      labels (
        user_answer,
        user_mark,
        is_correct,
        correct_answer,
        classification
      )
    `)
    .eq('session_id', sessionId)
    .order('index_in_image', { ascending: true });

  if (problemsError) throw problemsError;

  // ProblemItem 형식으로 변환 (AI 분석 결과 포함)
  const items: ProblemItem[] = (problems || []).map((p: any) => {
    const label = p.labels?.[0] || {};
    return transformToProblemItem(p, label);
  });

  return items;
}

// 문제 ID 배열로 문제 조회 (사용자 소유 검증 포함)
export async function fetchProblemsByIds(problemIds: string[]): Promise<ProblemItem[]> {
  const userId = await getCurrentUserId();

  if (!problemIds || problemIds.length === 0) return [];

  // 1) problems (id IN problemIds) → session_id 확보
  const problemsRows: any[] = [];
  for (let i = 0; i < problemIds.length; i += ID_CHUNK) {
    const chunk = problemIds.slice(i, i + ID_CHUNK);
    const { data, error } = await supabase
      .from('problems')
      .select('id, index_in_image, content, session_id')
      .in('id', chunk);
    if (error) throw error;
    problemsRows.push(...(data || []));
  }
  if (problemsRows.length === 0) return [];

  // 2) sessions (id IN session_ids, user_id 일치) → 소유 검증
  const sessionIds = Array.from(new Set(problemsRows.map((p) => p.session_id)));
  const ownedSessionIds = new Set<string>();
  for (let i = 0; i < sessionIds.length; i += ID_CHUNK) {
    const chunk = sessionIds.slice(i, i + ID_CHUNK);
    const { data, error } = await supabase
      .from('sessions')
      .select('id')
      .in('id', chunk)
      .eq('user_id', userId);
    if (error) throw error;
    for (const s of data || []) ownedSessionIds.add(s.id);
  }

  const ownedProblems = problemsRows.filter((p) => ownedSessionIds.has(p.session_id));
  if (ownedProblems.length === 0) return [];
  const problemMap = new Map<string, any>();
  for (const p of ownedProblems) problemMap.set(p.id, p);
  const ownedProblemIds = ownedProblems.map((p) => p.id);

  // 3) labels (problem_id IN owned)
  const labelsRows: any[] = [];
  for (let i = 0; i < ownedProblemIds.length; i += ID_CHUNK) {
    const chunk = ownedProblemIds.slice(i, i + ID_CHUNK);
    const { data, error } = await supabase
      .from('labels')
      .select('problem_id, user_answer, user_mark, is_correct, correct_answer, classification')
      .in('problem_id', chunk);
    if (error) throw error;
    labelsRows.push(...(data || []));
  }

  // transformFromLabelJoin 호환 형태로 wrapping
  const result: ProblemItem[] = [];
  for (const l of labelsRows) {
    const p = problemMap.get(l.problem_id);
    if (!p) continue;
    result.push(
      transformFromLabelJoin({
        problem_id: l.problem_id,
        user_answer: l.user_answer,
        user_mark: l.user_mark,
        is_correct: l.is_correct,
        correct_answer: l.correct_answer,
        classification: l.classification,
        problems: {
          id: p.id,
          index_in_image: p.index_in_image,
          content: p.content,
          session_id: p.session_id,
        },
      }),
    );
  }
  return result;
}

// 분류별 문제 조회 (정답/오답 필터링 포함)
export async function fetchProblemsByClassification(
  depth1: string,
  depth2: string,
  depth3: string,
  depth4: string,
  isCorrect: boolean | null
): Promise<any[]> {
  const userId = await getCurrentUserId();

  // 1) sessions (user_id)
  const { data: sessions, error: sErr } = await supabase
    .from('sessions')
    .select('id, created_at, image_urls')
    .eq('user_id', userId);
  if (sErr) throw sErr;
  if (!sessions || sessions.length === 0) return [];
  const sessionMap = new Map<string, { id: string; created_at: string; image_urls: string[] | null }>();
  await Promise.all(sessions.map(async (s) => {
    const urls = await resolveImageUrls(s.image_urls);
    sessionMap.set(s.id, { id: s.id, created_at: s.created_at, image_urls: urls });
  }));

  // 2) problems (session_id IN)
  const sessionIds = sessions.map((s) => s.id);
  const problemsRows: any[] = [];
  for (let i = 0; i < sessionIds.length; i += ID_CHUNK) {
    const chunk = sessionIds.slice(i, i + ID_CHUNK);
    const { data, error } = await supabase
      .from('problems')
      .select('id, session_id, index_in_image, content')
      .in('session_id', chunk);
    if (error) throw error;
    problemsRows.push(...(data || []));
  }
  if (problemsRows.length === 0) return [];
  const problemMap = new Map<string, any>();
  for (const p of problemsRows) problemMap.set(p.id, p);
  const problemIds = problemsRows.map((p) => p.id);

  // 3) labels (problem_id IN, classification/is_correct 필터)
  const labelsRows: any[] = [];
  for (let i = 0; i < problemIds.length; i += ID_CHUNK) {
    const chunk = problemIds.slice(i, i + ID_CHUNK);
    let q = supabase
      .from('labels')
      .select('problem_id, is_correct, classification, user_answer')
      .in('problem_id', chunk);
    if (depth1) q = q.eq('classification->>depth1', depth1);
    if (depth2) q = q.eq('classification->>depth2', depth2);
    if (depth3) q = q.eq('classification->>depth3', depth3);
    if (depth4) q = q.eq('classification->>depth4', depth4);
    if (isCorrect !== null) q = q.eq('is_correct', isCorrect);
    const { data, error } = await q;
    if (error) throw error;
    labelsRows.push(...(data || []));
  }

  const result: any[] = [];
  for (const l of labelsRows) {
    const p = problemMap.get(l.problem_id);
    if (!p) continue;
    const session = sessionMap.get(p.session_id);
    result.push({
      problem_id: l.problem_id,
      is_correct: l.is_correct,
      classification: l.classification || {},
      user_answer: l.user_answer || '',
      problem: {
        id: p.id,
        session_id: p.session_id,
        index_in_image: p.index_in_image,
        stem: p.content?.stem,
        choices: p.content?.choices,
        session: {
          id: p.session_id,
          created_at: session?.created_at || '',
          image_url: session?.image_urls?.[0] || '',
        },
      },
    });
  }
  return result;
}

// 문제별 라벨링 정보 조회 (라벨링 UI용) - AI 분석 결과 포함
export async function fetchProblemsForLabeling(sessionId: string): Promise<{ id: string; index_in_image: number; ai_is_correct: boolean | null }[]> {
  const userId = await getCurrentUserId();

  // 세션 소유권 검증
  const { data: session, error: sessionError } = await supabase
    .from('sessions')
    .select('user_id')
    .eq('id', sessionId)
    .single();

  if (sessionError) throw sessionError;
  if (session.user_id !== userId) {
    throw new Error('이 세션에 접근할 권한이 없습니다.');
  }

  // problems와 labels 조회 (AI 분석 결과 포함)
  const { data: problems, error: problemsError } = await supabase
    .from('problems')
    .select(`
      id,
      index_in_image,
      labels (
        is_correct
      )
    `)
    .eq('session_id', sessionId)
    .order('index_in_image', { ascending: true });

  if (problemsError) throw problemsError;

  return (problems || []).map((p: any) => ({
    id: p.id,
    index_in_image: p.index_in_image,
    ai_is_correct: p.labels?.[0]?.is_correct ?? null,
  }));
}

// 문제 수정
export async function updateProblemLabels(sessionId: string, items: ProblemItem[]): Promise<void> {
  // 먼저 해당 세션의 문제 ID들을 가져옴
  const { data: problems, error: fetchError } = await supabase
    .from('problems')
    .select('id, index_in_image, content')
    .eq('session_id', sessionId);

  if (fetchError) throw fetchError;

  const idByIndex = new Map<number, string>();
  for (const row of problems || []) {
    idByIndex.set(row.index_in_image, row.id);
  }

  // content 맵핑 (업데이트 시 기존 content 유지 위함)
  const contentById = new Map<string, any>();
  for (const row of problems || []) {
    contentById.set(row.id, row.content || {});
  }

  // 각 문제에 대해 업데이트
  for (const item of items) {
    const problemId = idByIndex.get(item.index);
    if (!problemId) continue;

    // 다중정답 객관식(multi_answer_contract v1) — 번호 집합이 확신 추출됐으면 eqSet 완전일치로 채점
    // 게이트는 백엔드 computeIsCorrect와 1:1 정합: 정답 2개 이상 + 사용자 선택이 정답 수 이상일 때만 신뢰
    const isMulti = item.answerFormat === 'multi';
    const hasConfidentSets = isMulti
      && Array.isArray(item.correctAnswers) && item.correctAnswers.length >= 2
      && Array.isArray(item.userAnswers) && item.userAnswers.length >= item.correctAnswers.length;

    // problems 테이블 업데이트 (content JSONB)
    const currentContent = contentById.get(problemId) || {};
    const updatedContent = {
      ...currentContent,
      stem: item.문제내용.text,
      choices: item.문제_보기.map(c => ({ text: c.text })),
      ...(isMulti && {
        answer_format: item.answerFormat,
        correct_answers: item.correctAnswers ?? [],
        user_answers: item.userAnswers ?? [],
      }),
    };

    const { error: problemUpdateError } = await supabase
      .from('problems')
      .update({
        content: updatedContent,
      })
      .eq('id', problemId);

    if (problemUpdateError) throw problemUpdateError;

    // labels 테이블 업데이트 (사용자 답안, 정답, 채점 정보)
    // is_correct: 다중정답이 확신 추출됐으면 eqSet 완전일치를 우선 신뢰(precision-first), 그 외 기존 수동 마크 기반 유지
    const isCorrect = hasConfidentSets
      ? eqSet(new Set(item.correctAnswers), new Set(item.userAnswers))
      : isCorrectFromMark(item.사용자가_직접_채점한_정오답);

    const { error: labelUpdateError } = await supabase
      .from('labels')
      .update({
        user_answer: item.사용자가_기술한_정답.text,
        user_mark: normalizeMark(item.사용자가_직접_채점한_정오답),
        is_correct: isCorrect,
        correct_answer: item.correct_answer || null,
        classification: item.문제_유형_분류,
      })
      .eq('problem_id', problemId);

    if (labelUpdateError) throw labelUpdateError;
  }

  // ✅ 사용자 검수(라벨링) 완료로 세션 상태 업데이트
  // QuickLabelingCard 노출 기준: status='completed' (검수 전)
  // 검수 완료 후: status='labeled'
  const { error: sessionUpdateError } = await supabase
    .from('sessions')
    .update({ status: 'labeled' })
    .eq('id', sessionId);
  if (sessionUpdateError) throw sessionUpdateError;
}

// 선택된 문제 삭제 (RLS가 소유자 검증 수행, labels는 CASCADE 삭제)
export async function deleteProblems(problemIds: string[]): Promise<number> {
  if (!problemIds || problemIds.length === 0) return 0;

  const { data, error } = await supabase
    .from('problems')
    .delete()
    .in('id', problemIds)
    .select('id');

  if (error) throw error;

  return data?.length ?? 0;
}
