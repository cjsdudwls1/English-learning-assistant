import type { GeneratedProblem } from '../types';
import {
  fetchExistingProblemsByClassificationPriority,
  fetchExistingProblems
} from './db/generatedProblems';
import { supabase } from './supabaseClient';

export interface AIGenerationOptions {
  includePassage?: boolean;
  passageLength?: number;
  passageTopic?: { category: string; subfield: string };
  passageGenre?: string;
  difficultyLevel?: number;
  vocabLevel?: number;
}

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
  /** 부족한 문제 유형별 개수 (AI 생성 필요) */
  shortage: { [key: string]: number };
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
    shortage: {},
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

  // 2단계: 부족한 문제 집계 (AI 생성은 사용자 확인 후)
  const shortage: { [key: string]: number } = {};
  for (const problemType of problemTypes) {
    const requestedCount = problemCounts[problemType];
    if (requestedCount <= 0) continue;

    const existingCount = existingProblemsByType[problemType]?.length || 0;
    const neededCount = Math.max(0, requestedCount - existingCount);

    if (neededCount > 0) {
      shortage[problemType] = neededCount;
      console.log(`[LoadExisting] ${problemType}: 요청 ${requestedCount}개 중 ${existingCount}개만 DB에 존재 (${neededCount}개 부족)`);
    }
  }
  result.shortage = shortage;

  console.log(`[LoadExisting] 최종 결과: 총 ${result.problems.length}개 문제 (기존: ${result.stats.existing}개, 부족: ${JSON.stringify(shortage)})`);

  onProgress?.(3, '시험지 구성 완료!', {
    stage: 'complete',
    total: result.problems.length,
    existing: result.stats.existing,
    newlyGenerated: 0,
  });

  return result;
}

/**
 * 부족분 AI 생성 (사용자 확인 후 호출)
 */
export async function generateShortageProblems(
  shortage: { [key: string]: number },
  classification: ProblemLoadOptions['classification'],
  userId: string,
  language: 'ko' | 'en',
  onProgress?: (stage: number, message: string, details?: any) => void,
  aiOptions?: AIGenerationOptions,
): Promise<GeneratedProblem[]> {
  const allNew: GeneratedProblem[] = [];
  for (const [problemType, count] of Object.entries(shortage)) {
    const problems = await generateMissingProblems(
      problemType as any,
      count,
      classification,
      userId,
      language,
      onProgress,
      aiOptions,
    );
    allNew.push(...problems);
  }
  return allNew;
}

/**
 * 부족한 문제 생성 (Edge Function 호출) - 내부 함수
 */
async function generateMissingProblems(
  problemType: 'multiple_choice' | 'short_answer' | 'essay' | 'ox',
  count: number,
  classification: ProblemLoadOptions['classification'],
  userId: string,
  language: 'ko' | 'en',
  onProgress?: (stage: number, message: string, details?: any) => void,
  aiOptions?: AIGenerationOptions,
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
        ...(aiOptions || {}),
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


