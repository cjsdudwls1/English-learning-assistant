import { supabase } from '../supabaseClient';
import type { GeneratedProblem } from '../../types';

export interface FetchExistingProblemsOptions {
  problemType: 'multiple_choice' | 'short_answer' | 'essay' | 'ox';
  language?: 'ko' | 'en'; // 미사용 — generated_problems에 language 컬럼 없음(스키마 확인), 호출부 호환용으로 유지
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
    .eq('problem_type', problemType)
    .neq('stem', '__GENERATION_ERROR__')
    .neq('stem', '__TIMEOUT_ERROR__');

  // 언어 필터링 없음: generated_problems에 language 컬럼이 없음 — 언어 구분은 classification 필터에 의존

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

/**
 * id 목록으로 생성 문제를 읽는다. **요청한 순서를 그대로 유지한다.**
 *
 * 학습 계획은 "1일차 → 2일차" 순서 자체가 내용이다. DB가 돌려주는 순서를 그대로 쓰면
 * 계획의 날짜 구분이 무너진 시험지가 나온다.
 *
 * 없는 id는 조용히 빠진다 — 계획이 참조하는 문제가 그 사이 지워졌을 수 있고, 그 한 건 때문에
 * 나머지를 못 풀게 만들 이유가 없다. 몇 개가 빠졌는지는 호출부가 길이 비교로 알 수 있다.
 *
 * uuid 모양이 아닌 값은 아예 안 물어본다. id는 uuid 컬럼이라 형식이 어긋나면 PostgREST가
 * 22P02로 400을 내고, 그러면 **한 건 때문에 요청 전체가 죽어** 멀쩡한 문제까지 못 연다.
 * 서버(planner)가 이미 걸러 보내지만, 이 함수는 그 경로만 쓰는 게 아니다.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function fetchGeneratedProblemsByIds(ids: string[]): Promise<GeneratedProblem[]> {
  const queryable = ids.filter((id) => UUID_RE.test(id));
  if (queryable.length === 0) return [];

  const { data, error } = await supabase
    .from('generated_problems')
    .select('*')
    .in('id', queryable);

  if (error) {
    console.error('Error fetching generated problems by ids:', error);
    throw error;
  }

  const byId = new Map((data || []).map((p) => [p.id as string, p as GeneratedProblem]));
  return ids.map((id) => byId.get(id)).filter((p): p is GeneratedProblem => !!p);
}

