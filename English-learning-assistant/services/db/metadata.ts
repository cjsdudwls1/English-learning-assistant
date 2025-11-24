import { supabase } from '../supabaseClient';
import { getCurrentUserId } from './auth';

export interface ProblemMetadataItem {
  problem_id: string;
  metadata: {
    difficulty: '상' | '중' | '하' | 'high' | 'medium' | 'low';
    word_difficulty: number;
    problem_type: string;
    analysis: string;
  } | null;
  session: {
    id: string;
    created_at: string;
    image_url: string;
  };
  classification: any;
  is_correct: boolean;
}

export async function fetchProblemsMetadataByCorrectness(
  depth1?: string,
  depth2?: string,
  depth3?: string,
  depth4?: string,
  isCorrect: boolean | null = null
): Promise<ProblemMetadataItem[]> {
  const userId = await getCurrentUserId();
  
  let query = supabase
    .from('labels')
    .select(`
      problem_id,
      is_correct,
      classification,
      problems!inner (
        id,
        session_id,
        problem_metadata,
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
    query = query.eq('classification->>1Depth', depth1);
  }
  if (depth2) {
    query = query.eq('classification->>2Depth', depth2);
  }
  if (depth3) {
    query = query.eq('classification->>3Depth', depth3);
  }
  if (depth4) {
    query = query.eq('classification->>4Depth', depth4);
  }
  
  // 정답/오답 필터링
  if (isCorrect !== null) {
    query = query.eq('is_correct', isCorrect);
  }
  
  // Note: Supabase는 조인된 테이블의 컬럼으로 직접 정렬할 수 없으므로
  // 데이터를 가져온 후 클라이언트에서 정렬합니다.
  
  const { data, error } = await query;
  
  if (error) throw error;
  
  // 데이터 포맷 변환 및 정렬 (최신순)
  const items = (data || []).map((item: any) => ({
    problem_id: item.problem_id,
    metadata: item.problems.problem_metadata || null,
    session: {
      id: item.problems.session_id,
      created_at: item.problems.sessions.created_at,
      image_url: item.problems.sessions.image_url,
    },
    classification: item.classification || {},
    is_correct: item.is_correct,
  }));
  
  // 시간 순서: 최신순 (클라이언트에서 정렬)
  return items.sort((a, b) => {
    const dateA = new Date(a.session.created_at).getTime();
    const dateB = new Date(b.session.created_at).getTime();
    return dateB - dateA; // 내림차순 (최신순)
  });
}

