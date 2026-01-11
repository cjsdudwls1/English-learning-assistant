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
      status,
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
        status: session.status,
        ...stats,
      };
    })
    .filter((session) => {
      // ✅ "사용자 검수(라벨링) 완료" 기준을 status로 전환
      // - 분석 완료: status='completed' (검수 전)
      // - 사용자 저장 완료: status='labeled' (검수 완료)
      return session.status === 'labeled';
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

// 분석 실패 세션 조회 (status === 'failed')
export async function fetchFailedSessions(): Promise<SessionWithProblems[]> {
  const userId = await getCurrentUserId();

  const { data, error } = await supabase
    .from('sessions')
    .select(`
      id,
      created_at,
      image_url,
      status,
      failure_stage,
      failure_message
    `)
    .eq('user_id', userId)
    .eq('status', 'failed')
    .order('created_at', { ascending: false });

  if (error) throw error;

  return (data || []).map((session: any) => ({
    id: session.id,
    created_at: session.created_at,
    image_url: session.image_url,
    status: session.status,
    failure_stage: session.failure_stage ?? null,
    failure_message: session.failure_message ?? null,
    problem_count: 0,
    correct_count: 0,
    incorrect_count: 0,
  }));
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
      analysis_model,
      status,
      problems (
        id,
        labels (
          user_mark
        )
      )
    `)
    .eq('user_id', userId)
    // ✅ 분석이 완료되었지만 아직 사용자 검수가 끝나지 않은 세션만
    .eq('status', 'completed')
    .order('created_at', { ascending: false });
  
  if (error) throw error;
  
  // 통계 계산 및 라벨링 필요 여부 확인
  const sessions: SessionWithProblems[] = (data || [])
    .map((session: any) => {
      const problems = session.problems || [];
      const problem_count = problems.length;
      let correct_count = 0;
      let incorrect_count = 0;
      
      problems.forEach((problem: any) => {
        const labels = problem.labels || [];
        if (labels.length > 0) {
          const userMark = labels[0].user_mark;
          // 통계는 user_mark 기준으로 계산 (null이면 0으로 남김)
          if (userMark !== null && userMark !== undefined) {
            const mark = normalizeMark(userMark);
            if (isCorrectFromMark(mark)) correct_count++; else incorrect_count++;
          }
        } else {
          // label이 없으면 라벨링이 필요하지만, allMarksNull은 이미 true로 시작했으므로 그대로 유지
          // (모든 문제의 user_mark가 null인 경우만 라벨링 필요로 간주)
        }
      });
      
      return {
        id: session.id,
        created_at: session.created_at,
        image_url: session.image_url,
        analysis_model: session.analysis_model ?? null,
        problem_count,
        correct_count,
        incorrect_count,
        status: session.status, // status 필드 추가
      };
    })
    .filter((session: any) => {
      // ✅ 문제는 생성되었는데 아직 검수 전(status='completed')이면 표시
      return session.problem_count > 0;
    });
  
  return sessions;
}

