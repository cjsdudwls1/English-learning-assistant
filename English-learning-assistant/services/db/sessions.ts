import { supabase } from '../supabaseClient';
import type { SessionWithProblems } from '../../types';
import { getCurrentUserId } from './auth';
import { calculateSessionStats } from '../../utils/sessionStats';
import { isCorrectFromMark, normalizeMark } from '../marks';

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
      const stats = calculateSessionStats(session);
      return {
        id: session.id,
        created_at: session.created_at,
        image_url: session.image_url,
        ...stats,
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
    const stats = calculateSessionStats(session);
    return {
      id: session.id,
      created_at: session.created_at,
      image_url: session.image_url,
      ...stats,
    };
  });
  
  return sessions;
}

// 분석 중인 세션 조회 (problem_count === 0 또는 status === 'processing')
export async function fetchAnalyzingSessions(): Promise<SessionWithProblems[]> {
  const userId = await getCurrentUserId();
  
  // sessions와 problems를 조인하여 problem_count 계산
  const { data, error } = await supabase
    .from('sessions')
    .select(`
      id,
      created_at,
      image_url,
      status,
      problems (
        id
      )
    `)
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  
  if (error) throw error;
  
  // problem_count === 0이거나 status === 'processing'인 세션만 필터링
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
        status: session.status,
      };
    })
    .filter((session) => {
      const status = session.status ?? 'pending';
      const isActiveStatus = status === 'processing' || status === 'pending';
      // 분석 중으로 간주: 문제 데이터가 아직 없고, 상태가 진행 중일 때만
      return session.problem_count === 0 && isActiveStatus;
    });
  
  return analyzingSessions;
}

// 라벨링이 필요한 세션 조회 (problem_count > 0 AND 모든 문제의 user_mark가 null AND status === 'completed')
export async function fetchPendingLabelingSessions(): Promise<SessionWithProblems[]> {
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
    .eq('status', 'completed') // 분석이 완료된 세션만 (AnalyzingCard에서 제외하기 위해)
    .order('created_at', { ascending: false });
  
  if (error) throw error;
  
  // 통계 계산 및 라벨링 필요 여부 확인
  const sessions: SessionWithProblems[] = (data || [])
    .map((session: any) => {
      const problems = session.problems || [];
      const problem_count = problems.length;
      let correct_count = 0;
      let incorrect_count = 0;
      let allMarksNull = true; // 모든 문제의 user_mark가 null인지 확인
      
      problems.forEach((problem: any) => {
        const labels = problem.labels || [];
        if (labels.length > 0) {
          const userMark = labels[0].user_mark;
          // user_mark가 null이 아닌 경우만 카운트 (null이면 사용자 검수 전)
          if (userMark !== null && userMark !== undefined) {
            allMarksNull = false; // 하나라도 null이 아니면 false
            const mark = normalizeMark(userMark);
            if (isCorrectFromMark(mark)) correct_count++; else incorrect_count++;
          }
          // user_mark가 null이면 allMarksNull은 그대로 true 유지
        } else {
          // label이 없으면 라벨링이 필요하지만, allMarksNull은 이미 true로 시작했으므로 그대로 유지
          // (모든 문제의 user_mark가 null인 경우만 라벨링 필요로 간주)
        }
      });
      
      return {
        id: session.id,
        created_at: session.created_at,
        image_url: session.image_url,
        problem_count,
        correct_count,
        incorrect_count,
        status: session.status, // status 필드 추가
        allMarksNull, // 모든 user_mark가 null인지 여부
      };
    })
    .filter((session: any) => {
      // 라벨링이 필요한 세션: problem_count > 0 AND 모든 문제의 user_mark가 null
      return session.problem_count > 0 && session.allMarksNull === true;
    })
    .map((session: any) => {
      // allMarksNull 필드 제거 (반환 타입에 없음)
      const { allMarksNull, ...rest } = session;
      return rest;
    });
  
  return sessions;
}

