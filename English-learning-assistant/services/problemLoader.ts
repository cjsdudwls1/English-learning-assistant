import type { GeneratedProblem } from '../types';
import { 
  fetchExistingProblemsByClassificationPriority,
  fetchExistingProblems 
} from './db/generatedProblems';
import { supabase } from './supabaseClient';

export interface ProblemLoadOptions {
  problemCounts: {
    multiple_choice: number;
    short_answer: number;
    essay: number;
    ox: number;
  };
  classification?: {
    depth1?: string;
    depth2?: string;
    depth3?: string;
    depth4?: string;
  };
  language?: 'ko' | 'en';
  excludeSolved?: boolean;
  excludeRecentDays?: number;
  userId?: string;
  exactMatchOnly?: boolean;
}

export interface ProblemLoadResult {
  problems: GeneratedProblem[];
  stats: {
    existing: number;
    newlyGenerated: number;
    byType: {
      [key: string]: {
        existing: number;
        newlyGenerated: number;
      };
    };
  };
}

/**
 * 기존 문제 조회 + 부족한 문제만 생성하는 통합 로직
 * 
 * @param options 문제 로드 옵션
 * @param onProgress 진행 상태 콜백 (선택)
 * @returns 문제 목록 및 통계
 */
export async function loadProblemsWithExisting(
  options: ProblemLoadOptions,
  onProgress?: (stage: number, message: string, details?: any) => void
): Promise<ProblemLoadResult> {
  const {
    problemCounts,
    classification,
    language,
    excludeSolved,
    excludeRecentDays,
    userId,
    exactMatchOnly = false,
  } = options;

  const result: ProblemLoadResult = {
    problems: [],
    stats: {
      existing: 0,
      newlyGenerated: 0,
      byType: {},
    },
  };

  const problemTypes: Array<'multiple_choice' | 'short_answer' | 'essay' | 'ox'> = [
    'multiple_choice',
    'short_answer',
    'essay',
    'ox',
  ];

  // 1단계: 기존 문제 검색
  onProgress?.(1, '기존 문제 검색 중...', { stage: 'searching' });

  const existingProblemsByType: { [key: string]: GeneratedProblem[] } = {};

  for (const problemType of problemTypes) {
    const requestedCount = problemCounts[problemType];
    if (requestedCount <= 0) continue;

    onProgress?.(1, `기존 문제 검색 중... (${problemType})`, {
      stage: 'searching',
      problemType,
      requestedCount,
    });

    try {
      let existingProblems: GeneratedProblem[] = [];

      if (classification?.depth1 && !exactMatchOnly) {
        // 분류 우선순위 매칭
        existingProblems = await fetchExistingProblemsByClassificationPriority(
          problemType,
          {
            depth1: classification.depth1,
            depth2: classification.depth2,
            depth3: classification.depth3,
            depth4: classification.depth4,
          },
          requestedCount,
          excludeSolved,
          excludeRecentDays,
          userId
        );
      } else {
        // 기본 조회 - classification이 없으면 분류 필터링 없이 조회
        existingProblems = await fetchExistingProblems({
          problemType,
          classification: classification && (classification.depth1 || classification.depth2) ? classification : undefined,
          limit: requestedCount,
          excludeSolved,
          excludeRecentDays,
          userId,
          exactMatchOnly: false, // 더 많은 문제를 찾기 위해 완화
        });
      }
      
      // 디버깅: 실제로 찾은 문제 수 확인
      console.log(`[LoadExisting] ${problemType}: 요청=${requestedCount}, 발견=${existingProblems.length}`);

      // 기존 문제에 출처 정보 추가
      const existingProblemsWithSource = existingProblems.map(p => ({
        ...p,
        _source: 'existing' as const,
      }));

      existingProblemsByType[problemType] = existingProblemsWithSource;
      result.stats.byType[problemType] = {
        existing: existingProblemsWithSource.length,
        newlyGenerated: 0,
      };

      console.log(`[LoadExisting] ${problemType}: 기존 문제 ${existingProblemsWithSource.length}개 발견 (요청: ${requestedCount}개), 출처 정보 추가 완료`);
      onProgress?.(1, `기존 문제 검색 완료: ${problemType} ${existingProblemsWithSource.length}개 발견`, {
        stage: 'searching',
        problemType,
        found: existingProblemsWithSource.length,
      });
    } catch (error) {
      console.error(`Error fetching existing problems for ${problemType}:`, error);
      existingProblemsByType[problemType] = [];
      result.stats.byType[problemType] = {
        existing: 0,
        newlyGenerated: 0,
      };
    }
  }

  // 기존 문제 합계
  result.stats.existing = Object.values(existingProblemsByType).reduce(
    (sum, problems) => sum + problems.length,
    0
  );

  // 기존 문제를 결과에 추가 (출처 정보는 이미 추가됨)
  for (const problems of Object.values(existingProblemsByType)) {
    if (problems && problems.length > 0) {
      // 출처 정보가 이미 추가되어 있으므로 그대로 사용
      console.log(`[LoadExisting] 기존 문제 ${problems.length}개 추가 (출처 정보 확인):`, problems.map(p => ({ id: p.id, _source: (p as any)._source })));
      result.problems.push(...problems);
    }
  }
  
  console.log(`[LoadExisting] 총 기존 문제 ${result.problems.length}개 준비 완료 (모두 _source='existing' 포함)`);

  // 2단계: 부족한 문제 계산 및 생성
  onProgress?.(2, '부족한 문제 계산 중...', { stage: 'calculating' });

  const problemsToGenerate: { [key: string]: number } = {};

  for (const problemType of problemTypes) {
    const requestedCount = problemCounts[problemType];
    if (requestedCount <= 0) continue;

    const existingCount = existingProblemsByType[problemType]?.length || 0;
    const neededCount = Math.max(0, requestedCount - existingCount);

    if (neededCount > 0) {
      problemsToGenerate[problemType] = neededCount;
    }
  }

  // 3단계: 부족한 문제 생성
  if (Object.keys(problemsToGenerate).length > 0) {
    onProgress?.(3, '새 문제 생성 중...', {
      stage: 'generating',
      problemsToGenerate,
    });

    // Edge Function을 통해 문제 생성
    // 기존 generate-problems-by-type Edge Function 사용
    const generationPromises: Promise<void>[] = [];

    for (const [problemType, count] of Object.entries(problemsToGenerate)) {
      const promise = generateMissingProblems(
        problemType as 'multiple_choice' | 'short_answer' | 'essay' | 'ox',
        count,
        classification,
        userId || '',
        language || 'ko',
        onProgress
      ).then((newProblems) => {
        // 새로 생성된 문제에 출처 정보 추가
        const newProblemsWithSource = newProblems.map(p => ({
          ...p,
          _source: 'new' as const, // 출처 표시용 메타데이터
        }));
        console.log(`[LoadExisting] 새로 생성된 문제 ${newProblems.length}개에 출처 정보 추가:`, newProblemsWithSource.map(p => ({ id: p.id, _source: p._source })));
        result.problems.push(...newProblemsWithSource);
        result.stats.byType[problemType].newlyGenerated = newProblems.length;
        result.stats.newlyGenerated += newProblems.length;
      });

      generationPromises.push(promise);
    }

    await Promise.all(generationPromises);
  }

  console.log(`[LoadExisting] 최종 결과: 총 ${result.problems.length}개 문제 (기존: ${result.stats.existing}개, 새로 생성: ${result.stats.newlyGenerated}개)`);
  console.log(`[LoadExisting] 문제 출처 정보:`, result.problems.map(p => ({ id: p.id, _source: (p as any)._source })));
  
  onProgress?.(3, '시험지 구성 완료!', {
    stage: 'complete',
    total: result.problems.length,
    existing: result.stats.existing,
    newlyGenerated: result.stats.newlyGenerated,
  });

  return result;
}

/**
 * 부족한 문제 생성 (Edge Function 호출)
 */
async function generateMissingProblems(
  problemType: 'multiple_choice' | 'short_answer' | 'essay' | 'ox',
  count: number,
  classification: ProblemLoadOptions['classification'],
  userId: string,
  language: 'ko' | 'en',
  onProgress?: (stage: number, message: string, details?: any) => void
): Promise<GeneratedProblem[]> {
  try {
    const functionUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-problems-by-type`;
    
    const { data: session } = await supabase.auth.getSession();
    if (!session?.session) {
      throw new Error('Not authenticated');
    }

    onProgress?.(3, `${problemType} 문제 생성 중... (${count}개)`, {
      stage: 'generating',
      problemType,
      count,
    });

    const response = await fetch(functionUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.session.access_token}`,
      },
      body: JSON.stringify({
        problemType,
        problemCount: count,
        userId,
        language,
        classification,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP error! status: ${response.status}, ${errorText}`);
    }

    const result = await response.json();

    if (!result.success) {
      throw new Error(result.error || '문제 생성 실패');
    }

    // 생성된 문제를 폴링으로 기다림
    const generatedProblems = await pollForGeneratedProblems(
      userId,
      problemType,
      count,
      onProgress
    );

    return generatedProblems;
  } catch (error) {
    console.error(`Error generating problems for ${problemType}:`, error);
    onProgress?.(3, `${problemType} 문제 생성 실패: ${error instanceof Error ? error.message : 'Unknown error'}`, {
      stage: 'error',
      problemType,
      error,
    });
    return [];
  }
}

/**
 * 생성된 문제를 폴링으로 기다림
 */
async function pollForGeneratedProblems(
  userId: string,
  problemType: 'multiple_choice' | 'short_answer' | 'essay' | 'ox',
  expectedCount: number,
  onProgress?: (stage: number, message: string, details?: any) => void,
  maxAttempts = 30,
  intervalMs = 2000
): Promise<GeneratedProblem[]> {
  const startTime = Date.now();
  const queryStartTime = new Date(startTime - 2000).toISOString();

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const { data: problems, error } = await supabase
        .from('generated_problems')
        .select('*')
        .eq('user_id', userId)
        .eq('problem_type', problemType)
        .gte('created_at', queryStartTime)
        .order('created_at', { ascending: false })
        .limit(expectedCount);

      if (error) {
        console.error('[Polling] Error:', error);
        await new Promise(resolve => setTimeout(resolve, intervalMs));
        continue;
      }

      const foundProblems = (problems || []) as GeneratedProblem[];

      if (foundProblems.length >= expectedCount) {
        onProgress?.(3, `${problemType} 문제 생성 완료 (${foundProblems.length}개)`, {
          stage: 'generating',
          problemType,
          count: foundProblems.length,
        });
        return foundProblems.slice(0, expectedCount);
      }

      onProgress?.(3, `${problemType} 문제 생성 중... (${foundProblems.length}/${expectedCount})`, {
        stage: 'generating',
        problemType,
        current: foundProblems.length,
        expected: expectedCount,
      });

      await new Promise(resolve => setTimeout(resolve, intervalMs));
    } catch (error) {
      console.error('[Polling] Error:', error);
      await new Promise(resolve => setTimeout(resolve, intervalMs));
    }
  }

  // 타임아웃 시 현재까지 생성된 문제 반환
  const { data: problems } = await supabase
    .from('generated_problems')
    .select('*')
    .eq('user_id', userId)
    .eq('problem_type', problemType)
    .gte('created_at', queryStartTime)
    .order('created_at', { ascending: false })
    .limit(expectedCount);

  return (problems || []) as GeneratedProblem[];
}


