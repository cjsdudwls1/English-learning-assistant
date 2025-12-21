import { supabase } from '../supabaseClient';
import type { ProblemItem } from '../../types';
import { getCurrentUserId } from './auth';
import { isCorrectFromMark, normalizeMark } from '../marks';
import { transformToProblemItem, transformFromLabelJoin } from '../../utils/problemTransform';

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
      stem,
      choices,
      labels (
        user_answer,
        user_mark,
        is_correct,
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

  // labels 기준으로 조인하여 소유자 필터링 및 문제 데이터 수집
  const { data, error } = await supabase
    .from('labels')
    .select(`
      problem_id,
      user_answer,
      user_mark,
      is_correct,
      classification,
      problems!inner (
        id,
        index_in_image,
        stem,
        choices,
        session_id,
        sessions!inner (
          user_id
        )
      )
    `)
    .in('problem_id', problemIds)
    .eq('problems.sessions.user_id', userId);

  if (error) throw error;

  return (data || []).map((row: any) => transformFromLabelJoin(row));
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
  
  let query = supabase
    .from('labels')
    .select(`
      problem_id,
      is_correct,
      classification,
      user_answer,
      problems!inner (
        id,
        session_id,
        index_in_image,
        stem,
        choices,
        sessions!inner (
          user_id,
          created_at,
          image_url
        )
      )
    `)
    .eq('problems.sessions.user_id', userId);
  
  // 분류 필터링
  if (depth1) {
    query = query.eq('classification->>depth1', depth1);
  }
  if (depth2) {
    query = query.eq('classification->>depth2', depth2);
  }
  if (depth3) {
    query = query.eq('classification->>depth3', depth3);
  }
  if (depth4) {
    query = query.eq('classification->>depth4', depth4);
  }
  
  // 정답/오답 필터링
  if (isCorrect !== null) {
    query = query.eq('is_correct', isCorrect);
  }
  
  const { data, error } = await query;
  
  if (error) throw error;
  
  // 데이터 포맷 변환
  return (data || []).map((item: any) => ({
    problem_id: item.problem_id,
    is_correct: item.is_correct,
    classification: item.classification || {},
    user_answer: item.user_answer || '',
    problem: {
      id: item.problems.id,
      session_id: item.problems.session_id,
      index_in_image: item.problems.index_in_image,
      stem: item.problems.stem,
      choices: item.problems.choices,
      session: {
        id: item.problems.session_id,
        created_at: item.problems.sessions.created_at,
        image_url: item.problems.sessions.image_url,
      },
    },
  }));
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
    .select('id, index_in_image')
    .eq('session_id', sessionId);
  
  if (fetchError) throw fetchError;
  
  const idByIndex = new Map<number, string>();
  for (const row of problems || []) {
    idByIndex.set(row.index_in_image, row.id);
  }
  
  // 각 문제에 대해 업데이트
  for (const item of items) {
    const problemId = idByIndex.get(item.index);
    if (!problemId) continue;
    
    // problems 테이블 업데이트
    const { error: problemUpdateError } = await supabase
      .from('problems')
      .update({
        stem: item.문제내용.text,
        choices: item.문제_보기.map(c => ({ text: c.text })),
      })
      .eq('id', problemId);
    
    if (problemUpdateError) throw problemUpdateError;
    
    // labels 테이블 업데이트
    const { error: labelUpdateError } = await supabase
      .from('labels')
      .update({
        user_answer: item.사용자가_기술한_정답.text,
        user_mark: normalizeMark(item.사용자가_직접_채점한_정오답),
        is_correct: isCorrectFromMark(item.사용자가_직접_채점한_정오답),
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

