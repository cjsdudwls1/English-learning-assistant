import { supabase } from '../supabaseClient';
import type { GeneratedProblem } from '../../types';

export interface FetchExistingProblemsOptions {
  problemType: 'multiple_choice' | 'short_answer' | 'essay' | 'ox';
  language?: 'ko' | 'en';
  classification?: {
    depth1?: string;
    depth2?: string;
    depth3?: string;
    depth4?: string;
  };
  excludeSolved?: boolean; // 이미 풀이한 문제 제외
  excludeRecentDays?: number; // 최근 N일 내 출제된 문제 제외
  userId?: string; // 현재 사용자 ID (풀이 이력 확인용)
  limit?: number; // 최대 조회 개수
  exactMatchOnly?: boolean; // 정확히 일치하는 분류만
}

/**
 * generated_problems 테이블에서 기존 문제 조회
 * 모든 사용자의 문제를 조회 (데이터 격리 불필요)
 */
export async function fetchExistingProblems(
  options: FetchExistingProblemsOptions
): Promise<GeneratedProblem[]> {
  const {
    problemType,
    language,
    classification,
    excludeSolved = false,
    excludeRecentDays,
    userId,
    limit,
    exactMatchOnly = false,
  } = options;

  let query = supabase
    .from('generated_problems')
    .select('*')
    .eq('problem_type', problemType);

  // 언어 필터링
  // TODO: generated_problems 테이블에 language 컬럼이 있는지 확인 필요
  // 현재는 classification에서 추론하거나, 일단 스킵

  // 분류 필터링 - JSONB 필드 접근 방식: classification->>depth1
  // 분류가 제공되지 않으면 필터링하지 않고 문제 유형만으로 조회
  // exactMatchOnly가 false이고 classification이 있으면 depth1만 필터링 (더 관대하게)
  if (classification && classification.depth1) {
    if (exactMatchOnly) {
      // 완전 일치 (depth1~4 모두 일치)
      if (classification.depth1) {
        query = query.eq('classification->>depth1', classification.depth1);
      }
      if (classification.depth2) {
        query = query.eq('classification->>depth2', classification.depth2);
      }
      if (classification.depth3) {
        query = query.eq('classification->>depth3', classification.depth3);
      }
      if (classification.depth4) {
        query = query.eq('classification->>depth4', classification.depth4);
      }
    } else {
      // 유사 분류 포함 - depth1만 필터링 (더 관대하게, 더 많은 문제 찾기)
      query = query.eq('classification->>depth1', classification.depth1);
    }
  }
  // classification이 없거나 depth1이 없으면 분류 필터링 없이 문제 유형만으로 조회

  // 최신순 정렬 후 조회
  query = query.order('created_at', { ascending: false });

  // 개수 제한
  if (limit) {
    query = query.limit(limit * 3); // 풀이 이력 필터링을 위해 여유있게 조회
  }

  const { data, error } = await query;

  if (error) {
    console.error('Error fetching existing problems:', error);
    throw error;
  }

  let problems = (data || []) as GeneratedProblem[];
  
  console.log(`[fetchExistingProblems] ${problemType}: DB에서 조회된 문제 수 = ${problems.length}개 (분류 필터: ${classification?.depth1 || '없음'})`);

  // 이미 풀이한 문제 제외 (클라이언트 측 필터링)
  if (excludeSolved && userId && problems.length > 0) {
    const { data: solvedProblems } = await supabase
      .from('problem_solving_sessions')
      .select('problem_id')
      .eq('user_id', userId);
    
    if (solvedProblems && solvedProblems.length > 0) {
      const solvedProblemIds = new Set(solvedProblems.map(p => p.problem_id));
      problems = problems.filter(p => !solvedProblemIds.has(p.id));
    }
  }

  // 최근 N일 내 출제된 문제 제외 (클라이언트 측 필터링)
  if (excludeRecentDays && userId && problems.length > 0) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - excludeRecentDays);
    
    const { data: recentProblems } = await supabase
      .from('problem_solving_sessions')
      .select('problem_id')
      .eq('user_id', userId)
      .gte('created_at', cutoffDate.toISOString());
    
    if (recentProblems && recentProblems.length > 0) {
      const recentProblemIds = new Set(recentProblems.map(p => p.problem_id));
      problems = problems.filter(p => !recentProblemIds.has(p.id));
    }
  }

  // 최종 개수 제한
  if (limit) {
    problems = problems.slice(0, limit);
  }

  return problems;
}

/**
 * 문제 유형별로 기존 문제 개수 조회
 */
export async function countExistingProblemsByType(
  problemType: 'multiple_choice' | 'short_answer' | 'essay' | 'ox',
  classification?: {
    depth1?: string;
    depth2?: string;
    depth3?: string;
    depth4?: string;
  },
  excludeSolved?: boolean,
  excludeRecentDays?: number,
  userId?: string
): Promise<number> {
  const problems = await fetchExistingProblems({
    problemType,
    classification,
    excludeSolved,
    excludeRecentDays,
    userId,
  });
  return problems.length;
}

/**
 * 분류 매칭 우선순위에 따라 기존 문제 조회
 * 1. 완전 일치 (depth1~4 모두 일치)
 * 2. 부분 일치 (depth1~3 일치)
 * 3. 유사 분류 (depth1~2 일치)
 */
export async function fetchExistingProblemsByClassificationPriority(
  problemType: 'multiple_choice' | 'short_answer' | 'essay' | 'ox',
  classification: {
    depth1: string;
    depth2?: string;
    depth3?: string;
    depth4?: string;
  },
  limit: number,
  excludeSolved?: boolean,
  excludeRecentDays?: number,
  userId?: string
): Promise<GeneratedProblem[]> {
  // 1순위: 완전 일치
  let problems = await fetchExistingProblems({
    problemType,
    classification,
    exactMatchOnly: true,
    limit,
    excludeSolved,
    excludeRecentDays,
    userId,
  });

  // 필요한 개수가 모자라면 부분 일치 추가
  if (problems.length < limit && classification.depth3) {
    const remaining = limit - problems.length;
    const partialMatch = await fetchExistingProblems({
      problemType,
      classification: {
        depth1: classification.depth1,
        depth2: classification.depth2,
        depth3: classification.depth3,
      },
      exactMatchOnly: true,
      limit: remaining,
      excludeSolved,
      excludeRecentDays,
      userId,
    });
    
    // 중복 제거
    const existingIds = new Set(problems.map(p => p.id));
    const newProblems = partialMatch.filter(p => !existingIds.has(p.id));
    problems = [...problems, ...newProblems];
  }

  // 여전히 모자라면 유사 분류 추가
  if (problems.length < limit && classification.depth2) {
    const remaining = limit - problems.length;
    const similarMatch = await fetchExistingProblems({
      problemType,
      classification: {
        depth1: classification.depth1,
        depth2: classification.depth2,
      },
      exactMatchOnly: true,
      limit: remaining,
      excludeSolved,
      excludeRecentDays,
      userId,
    });
    
    // 중복 제거
    const existingIds = new Set(problems.map(p => p.id));
    const newProblems = similarMatch.filter(p => !existingIds.has(p.id));
    problems = [...problems, ...newProblems];
  }

  return problems.slice(0, limit);
}

