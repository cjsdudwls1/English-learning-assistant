import { supabase } from '../supabaseClient';
import type { SessionWithProblems } from '../../types';
import { getCurrentUserId } from './auth';
import { calculateSessionStats } from '../../utils/sessionStats';
import { unwrapEmbedded } from '../../utils/postgrestEmbed';
import { isCorrectFromMark, normalizeMark } from '../marks';
import { resolveImageUrls } from '../../utils/imageUrl';

// PostgREST는 .in() 목록을 URL 쿼리스트링에 싣는다. 이 파일의 다른 모듈(problems.ts)과 같은 상한.
const SESSION_ID_CHUNK = 500;

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

/**
 * 세션 **여러 건**을 한 번에 삭제한다. 부분 실패를 남기지 않으려고 만든 함수다.
 *
 * 예전엔 화면(RecentProblemsPage)이 `Promise.all(ids.map(deleteSession))`으로 돌렸다.
 * 문제가 셋이었다:
 *  (1) 건마다 getCurrentUserId + DELETE = **요청 2N개**. 전체 선택하면 수백 개가 동시에 나간다.
 *  (2) Promise.all은 **첫 실패에서 즉시 reject**한다. 나머지 삭제는 이미 날아간 뒤라 일부만 지워진다.
 *  (3) 그 reject가 catch로 가면서 목록 새로고침(loadData)이 건너뛰어져,
 *      **실제로는 지워진 세션이 화면에 그대로 남는다.** 사용자는 다시 삭제를 누른다.
 * 청크 삭제는 요청 수를 1/500로 줄인다.
 *
 * 반환값은 **성공했을 때의 삭제 건수**다. 중간 청크가 실패하면 그대로 던지므로 그때까지 지운
 * 건수는 전달되지 않는다 — "어디까지 지워졌는지"는 반환값이 아니라 **목록 재조회**로 확인할 것.
 * (호출부 RecentProblemsPage가 catch에서 loadData를 다시 부르는 이유가 이것이다. 개수를 굳이
 *  살려 던지지 않는 건, 부분 성공 뒤 화면을 갱신하고 나면 그 숫자로 할 수 있는 일이 없어서다.)
 *
 * 소유권 검증은 단건 삭제와 동일하게 user_id를 조건에 건다(RLS와 이중 방어).
 * 남의 세션 id가 섞여 와도 그 건만 조용히 빠지고 나머지는 정상 삭제된다.
 */
export async function deleteSessions(sessionIds: string[]): Promise<number> {
  if (!sessionIds || sessionIds.length === 0) return 0;
  const userId = await getCurrentUserId();

  let deleted = 0;
  for (let i = 0; i < sessionIds.length; i += SESSION_ID_CHUNK) {
    const chunk = sessionIds.slice(i, i + SESSION_ID_CHUNK);
    const { data, error } = await supabase
      .from('sessions')
      .delete()
      .in('id', chunk)
      .eq('user_id', userId)
      .select('id');

    if (error) throw error;
    deleted += data?.length ?? 0;
  }

  return deleted;
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
        // labels 임베드는 관계 cardinality에 따라 배열/객체로 모양이 갈린다 — unwrapEmbedded 참고.
        const label = unwrapEmbedded<any>(problem.labels);
        const userMark = label?.user_mark;
        if (userMark !== null && userMark !== undefined) {
          const mark = normalizeMark(userMark);
          if (isCorrectFromMark(mark)) correct_count++; else incorrect_count++;
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

