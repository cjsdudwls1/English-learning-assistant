import { supabase } from '../supabaseClient';
import type { SessionWithProblems } from '../../types';
import { getCurrentUserId } from './auth';
import { calculateSessionStats } from '../../utils/sessionStats';
import { isCorrectFromMark, normalizeMark } from '../marks';
import { resolveImageUrls } from '../../utils/imageUrl';

// 사용자의 세션 목록 조회 (최근순) - 라벨링이 완료된 세션만
export async function fetchUserSessions(): Promise<SessionWithProblems[]> {
  const userId = await getCurrentUserId();

  // sessions와 problems, labels를 조인하여 통계 계산
  const { data, error } = await supabase
    .from('sessions')
    .select(`
      id,
      created_at,
      image_urls,
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
  const sessionsRaw: SessionWithProblems[] = await Promise.all((data || [])
    .map(async (session: any) => {
      const stats = calculateSessionStats(session);
      const urls = await resolveImageUrls(session.image_urls);
      return {
        id: session.id,
        created_at: session.created_at,
        image_url: urls[0] || '',
        image_urls: urls,
        status: session.status,
        ...stats,
      };
    }));
  const sessions: SessionWithProblems[] = sessionsRaw.filter((session) => session.status === 'labeled');

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

// 세션 분석 진행 상황 상세 조회 (모델 정보 포함)
export async function getSessionProgress(sessionId: string): Promise<{ status: string; analysisModel: string | null }> {
  const userId = await getCurrentUserId();

  const { data: session, error: sessionError } = await supabase
    .from('sessions')
    .select('status, analysis_model, user_id')
    .eq('id', sessionId)
    .single();

  if (sessionError) throw sessionError;
  if (session.user_id !== userId) {
    throw new Error('이 세션에 접근할 권한이 없습니다.');
  }

  return {
    status: session.status || 'pending',
    analysisModel: session.analysis_model || null
  };
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
      image_urls,
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
  const sessions: SessionWithProblems[] = await Promise.all((data || []).map(async (session: any) => {
    const stats = calculateSessionStats(session);
    const urls = await resolveImageUrls(session.image_urls);
    return {
      id: session.id,
      created_at: session.created_at,
      image_url: urls[0] || '',
      image_urls: urls,
      ...stats,
    };
  }));

  return sessions;
}

// 분석 중인 세션 조회 (status === 'processing' | 'pending' | 'extracting')
// Edge Function 실패 시 markSessionFailed()가 DB에 직접 'failed'를 기록하므로
// 프론트엔드에서 별도 타임아웃 판정은 하지 않는다.
export async function fetchAnalyzingSessions(): Promise<SessionWithProblems[]> {
  const userId = await getCurrentUserId();

  // sessions와 problems를 조인하여 problem_count 계산
  const { data, error } = await supabase
    .from('sessions')
    .select(`
      id,
      created_at,
      image_urls,
      status,
      analysis_model,
      models_used,
      problems (
        id
      )
    `)
    .eq('user_id', userId)
    .in('status', ['processing', 'pending', 'extracting'])
    .order('created_at', { ascending: false });

  if (error) throw error;

  // 활성 분석 세션 반환
  const analyzingSessions: SessionWithProblems[] = await Promise.all((data || []).map(async (session: any) => {
    const problems = session.problems || [];
    const problem_count = problems.length;
    const urls = await resolveImageUrls(session.image_urls);
    return {
      id: session.id,
      created_at: session.created_at,
      image_url: urls[0] || '',
      image_urls: urls,
      problem_count,
      correct_count: 0,
      incorrect_count: 0,
      status: session.status,
      analysis_model: session.analysis_model,
      models_used: session.models_used || null,
    };
  }));

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
      image_urls,
      status,
      failure_stage,
      failure_message
    `)
    .eq('user_id', userId)
    .eq('status', 'failed')
    .order('created_at', { ascending: false });

  if (error) throw error;

  return Promise.all((data || []).map(async (session: any) => {
    const urls = await resolveImageUrls(session.image_urls);
    return {
      id: session.id,
      created_at: session.created_at,
      image_url: urls[0] || '',
      image_urls: urls,
      status: session.status,
      failure_stage: session.failure_stage ?? null,
      failure_message: session.failure_message ?? null,
      problem_count: 0,
      correct_count: 0,
      incorrect_count: 0,
    };
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
      image_urls,
      analysis_model,
      models_used,
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
  const sessionsRaw: SessionWithProblems[] = await Promise.all((data || [])
    .map(async (session: any) => {
      const problems = session.problems || [];
      const problem_count = problems.length;
      let correct_count = 0;
      let incorrect_count = 0;

      problems.forEach((problem: any) => {
        const labels = problem.labels || [];
        if (labels.length > 0) {
          const userMark = labels[0].user_mark;
          if (userMark !== null && userMark !== undefined) {
            const mark = normalizeMark(userMark);
            if (isCorrectFromMark(mark)) correct_count++; else incorrect_count++;
          }
        }
      });

      const urls = await resolveImageUrls(session.image_urls);
      return {
        id: session.id,
        created_at: session.created_at,
        image_url: urls[0] || '',
        image_urls: urls,
        analysis_model: session.analysis_model ?? null,
        models_used: session.models_used || null,
        problem_count,
        correct_count,
        incorrect_count,
        status: session.status,
      };
    }));
  const sessions: SessionWithProblems[] = sessionsRaw.filter((session: any) => session.problem_count > 0);

  return sessions;
}

