import { supabase } from '../supabaseClient';

// 동시 호출 병합(single-flight).
// supabase-js는 auth.getUser()가 토큰을 갱신할 수 있고 그때 navigator.locks로 직렬화하는데,
// 여러 호출이 겹치면 뒤늦은 쪽이 'steal'로 락을 뺏어 앞선 호출이
// "AbortError: Lock broken by another request with the 'steal' option"으로 실패한다.
// 교사 대시보드의 Promise.all([fetchMyClasses(), fetchMyAssignments()])처럼
// 서비스 함수를 동시에 부르는 화면에서 간헐적으로 로드가 통째로 실패했다.
// 진행 중인 요청을 공유해 auth 호출 자체를 1회로 접는다.
let inflight: Promise<string> | null = null;

export function getCurrentUserId(): Promise<string> {
  if (!inflight) {
    const pending = supabase.auth.getUser().then(({ data, error }) => {
      if (error || !data.user) {
        throw new Error('로그인이 필요합니다.');
      }
      return data.user.id;
    });
    inflight = pending;
    // 성공·실패 무관하게 캐시를 비운다 — 로그아웃·계정 전환 후 낡은 id가 남으면 안 된다.
    // catch를 따로 붙여, 아직 아무도 await하지 않은 순간에도 unhandled rejection이 나지 않게 한다.
    pending.catch(() => undefined).then(() => { if (inflight === pending) inflight = null; });
  }
  return inflight;
}
