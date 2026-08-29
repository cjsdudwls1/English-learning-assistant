-- vw_stats_by_type는 일반 뷰이므로 RLS를 직접 활성화할 수 없습니다.
-- 대신 기반 테이블(labels)의 RLS가 자동으로 적용되며, 뷰에 대한 권한(GRANT)으로 추가 제어합니다.

-- 1) 뷰 권한 재설정: public과 anon 접근 차단, authenticated만 허용
revoke all on table public.vw_stats_by_type from public;
revoke all on table public.vw_stats_by_type from anon;
grant select on table public.vw_stats_by_type to authenticated;

-- 2) 기반 테이블 RLS 재확인
alter table public.labels enable row level security;
alter table public.problems enable row level security;
alter table public.sessions enable row level security;

-- 3) 뷰 정의 주석 추가 (보안 설명)
comment on view public.vw_stats_by_type is 
'사용자별 문제 유형 통계 뷰. RLS는 기반 테이블(labels)에서 적용되어 현재 로그인 사용자의 데이터만 집계됩니다.';
;
