import { supabase } from './supabaseClient';
import type { ProblemItem, SessionWithProblems } from '../types';
import { isCorrectFromMark, normalizeMark } from './marks';

export async function getCurrentUserId(): Promise<string> {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    throw new Error('로그인이 필요합니다.');
  }
  return data.user.id;
}

export async function uploadProblemImage(file: File): Promise<string> {
  const userId = await getCurrentUserId();
  const timestamp = Date.now();
  const safeName = file.name.replace(/[^a-zA-Z0-9_.-]/g, '_');
  
  // 사용자 이메일 가져오기
  const { data: userData } = await supabase.auth.getUser();
  const email = userData.user?.email || userId; // 이메일이 없으면 fallback to userId
  const emailLocal = email.split('@')[0].replace(/[^a-zA-Z0-9_-]/g, '_'); // @ 앞부분 추출 및 sanitize
  const path = `${emailLocal}/${timestamp}_${safeName}`;
  
  const { data, error } = await supabase.storage.from('problem-images').upload(path, file, {
    cacheControl: '3600',
    upsert: false,
  });
  if (error) throw error;
  const { data: urlData } = supabase.storage.from('problem-images').getPublicUrl(data.path);
  return urlData.publicUrl;
}

export async function createSession(imageUrl: string): Promise<string> {
  const userId = await getCurrentUserId();
  const { data, error } = await supabase.from('sessions').insert({ user_id: userId, image_url: imageUrl }).select('id').single();
  if (error) throw error;
  return data.id as string;
}

// 사용자의 세션 목록 조회 (최근순) - 라벨링이 완료된 세션만
export async function fetchUserSessions(): Promise<SessionWithProblems[]> {
  const userId = await getCurrentUserId();
  
  // sessions와 problems, labels를 조인하여 통계 계산
  const { data, error } = await supabase
    .from('sessions')
    .select(`
      id,
      created_at,
      image_url,
      problems (
        id,
        labels (
          user_mark
        )
      )
    `)
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  
  if (error) throw error;
  
  // 통계 계산 및 라벨링 완료된 세션만 필터링
  const sessions: SessionWithProblems[] = (data || [])
    .map((session: any) => {
      const problems = session.problems || [];
      const problem_count = problems.length;
      let correct_count = 0;
      let incorrect_count = 0;
      
      problems.forEach((problem: any) => {
        const labels = problem.labels || [];
        if (labels.length > 0) {
          const mark = normalizeMark(labels[0].user_mark);
          if (isCorrectFromMark(mark)) correct_count++; else incorrect_count++;
        }
      });
      
      return {
        id: session.id,
        created_at: session.created_at,
        image_url: session.image_url,
        problem_count,
        correct_count,
        incorrect_count,
      };
    })
    .filter((session) => {
      // 라벨링이 완료된 세션만: problem_count > 0 AND (correct_count + incorrect_count) === problem_count
      // 즉, 모든 문제에 대해 정답 또는 오답 라벨링이 완료된 경우
      return session.problem_count > 0 && 
             (session.correct_count + session.incorrect_count) === session.problem_count;
    });
  
  return sessions;
}

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
  
  // ProblemItem 형식으로 변환
  const items: ProblemItem[] = (problems || []).map((p: any) => {
    const label = p.labels?.[0] || {};
    const classification = label.classification || {};
    
    return {
      index: p.index_in_image,
      사용자가_직접_채점한_정오답: normalizeMark(label.user_mark),
      AI가_판단한_정오답: label.is_correct !== undefined && label.is_correct !== null
        ? (label.is_correct ? '정답' : '오답')
        : undefined,
      문제내용: {
        text: p.stem || '',
        confidence_score: 1.0,
      },
      문제_보기: (p.choices || []).map((c: any) => ({
        text: c.text || '',
        confidence_score: c.confidence || 1.0,
      })),
      사용자가_기술한_정답: {
        text: label.user_answer || '',
        confidence_score: 1.0,
        auto_corrected: false,
        alternate_interpretations: [],
      },
      문제_유형_분류: {
        '1Depth': classification['1Depth'] || '',
        '2Depth': classification['2Depth'] || '',
        '3Depth': classification['3Depth'] || '',
        '4Depth': classification['4Depth'] || '',
        '분류_신뢰도': classification['분류_신뢰도'] || '보통',
      },
      분류_근거: '',
    };
  });
  
  return items;
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
        choices: item.문제_보기.map(c => ({ text: c.text, confidence: c.confidence_score })),
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
}

// 세션 삭제
export async function deleteSession(sessionId: string): Promise<void> {
  const userId = await getCurrentUserId();
  
  // 세션 소유권 검증 후 삭제
  const { error } = await supabase
    .from('sessions')
    .delete()
    .eq('id', sessionId)
    .eq('user_id', userId);
  
  if (error) throw error;
}

// 세션 상태 조회
export async function getSessionStatus(sessionId: string): Promise<string> {
  const userId = await getCurrentUserId();
  
  // 세션 소유권 검증
  const { data: session, error: sessionError } = await supabase
    .from('sessions')
    .select('status, user_id')
    .eq('id', sessionId)
    .single();
  
  if (sessionError) throw sessionError;
  if (session.user_id !== userId) {
    throw new Error('이 세션에 접근할 권한이 없습니다.');
  }
  
  return session.status || 'pending';
}

// 사용자의 특정 상태의 세션 조회
export async function fetchSessionsByStatus(status: string): Promise<SessionWithProblems[]> {
  const userId = await getCurrentUserId();
  
  // sessions와 problems, labels를 조인하여 통계 계산
  const { data, error } = await supabase
    .from('sessions')
    .select(`
      id,
      created_at,
      image_url,
      status,
      problems (
        id,
        labels (
          user_mark
        )
      )
    `)
    .eq('user_id', userId)
    .eq('status', status)
    .order('created_at', { ascending: false });
  
  if (error) throw error;
  
  // 통계 계산
  const sessions: SessionWithProblems[] = (data || []).map((session: any) => {
    const problems = session.problems || [];
    const problem_count = problems.length;
    let correct_count = 0;
    let incorrect_count = 0;
    
    problems.forEach((problem: any) => {
      const labels = problem.labels || [];
      if (labels.length > 0) {
        const mark = normalizeMark(labels[0].user_mark);
        if (isCorrectFromMark(mark)) correct_count++; else incorrect_count++;
      }
    });
    
    return {
      id: session.id,
      created_at: session.created_at,
      image_url: session.image_url,
      problem_count,
      correct_count,
      incorrect_count,
    };
  });
  
  return sessions;
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
  
  const { data, error } = await query;
  
  if (error) throw error;
  
  // 데이터 포맷 변환
  return (data || []).map((item: any) => ({
    problem_id: item.problem_id,
    is_correct: item.is_correct,
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

// 분석 중인 세션 조회 (problem_count === 0)
export async function fetchAnalyzingSessions(): Promise<SessionWithProblems[]> {
  const userId = await getCurrentUserId();
  
  // sessions와 problems를 조인하여 problem_count 계산
  const { data, error } = await supabase
    .from('sessions')
    .select(`
      id,
      created_at,
      image_url,
      problems (
        id
      )
    `)
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  
  if (error) throw error;
  
  // problem_count === 0인 세션만 필터링
  const analyzingSessions: SessionWithProblems[] = (data || [])
    .map((session: any) => {
      const problems = session.problems || [];
      const problem_count = problems.length;
      
      return {
        id: session.id,
        created_at: session.created_at,
        image_url: session.image_url,
        problem_count,
        correct_count: 0,
        incorrect_count: 0,
      };
    })
    .filter((session) => session.problem_count === 0);
  
  return analyzingSessions;
}

// 라벨링이 필요한 세션 조회 (problem_count > 0 AND 모든 문제의 user_mark가 null)
export async function fetchPendingLabelingSessions(): Promise<SessionWithProblems[]> {
  const userId = await getCurrentUserId();
  
  // sessions와 problems, labels를 조인하여 통계 계산
  const { data, error } = await supabase
    .from('sessions')
    .select(`
      id,
      created_at,
      image_url,
      problems (
        id,
        labels (
          user_mark
        )
      )
    `)
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  
  if (error) throw error;
  
  // 라벨링이 필요한 세션 필터링: problem_count > 0 AND 모든 문제의 user_mark가 null
  const sessions: SessionWithProblems[] = (data || [])
    .map((session: any) => {
      const problems = session.problems || [];
      const problem_count = problems.length;
      
      // user_mark가 null인 문제 개수 세기
      let unlabeled_count = 0;
      let correct_count = 0;
      let incorrect_count = 0;
      
      problems.forEach((problem: any) => {
        const labels = problem.labels || [];
        if (labels.length > 0) {
          const userMark = labels[0].user_mark;
          if (userMark === null || userMark === undefined) {
            unlabeled_count++;
          } else {
            const mark = normalizeMark(userMark);
            if (isCorrectFromMark(mark)) correct_count++; else incorrect_count++;
          }
        } else {
          unlabeled_count++;
        }
      });
      
      return {
        id: session.id,
        created_at: session.created_at,
        image_url: session.image_url,
        problem_count,
        correct_count,
        incorrect_count,
        unlabeled_count,
      };
    })
    .filter((session: any) => {
      // 라벨링이 필요한 세션: problem_count > 0 AND 모든 문제의 user_mark가 null
      return session.problem_count > 0 && session.unlabeled_count === session.problem_count;
    })
    .map(({ unlabeled_count, ...session }) => session); // unlabeled_count 제거
  
  return sessions;
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

// 간단한 라벨링 업데이트 (정답/오답만)
export async function quickUpdateLabels(sessionId: string, problemId: string, mark: '정답' | '오답'): Promise<void> {
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
  
  // labels 테이블 업데이트
  const normalizedMark = normalizeMark(mark);
  const isCorrect = isCorrectFromMark(normalizedMark);
  
  const { error: labelUpdateError } = await supabase
    .from('labels')
    .update({
      user_mark: normalizedMark,
      is_correct: isCorrect,
    })
    .eq('problem_id', problemId);
  
  if (labelUpdateError) throw labelUpdateError;
}


