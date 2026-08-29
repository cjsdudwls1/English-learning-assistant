-- 뷰는 RLS가 없어 Unrestricted로 보이는 것이 정상입니다.
-- 기반 테이블(labels 등)에 RLS가 적용되어 있어 실제 데이터는 사용자별로 필터됩니다.
-- 추가로 권한을 최소화하여 뷰 접근을 통제합니다.

-- 뷰 권한 초기화
revoke all on table public.vw_stats_by_type from public;
revoke all on table public.vw_stats_by_type from anon;
revoke all on table public.vw_stats_by_type from authenticated;
revoke all on table public.vw_stats_by_type from service_role;

-- 인증 사용자에게만 읽기 권한 부여 (필요 시 조정)
grant select on table public.vw_stats_by_type to authenticated;

-- 확인용: 기반 테이블 RLS 활성화 보장
alter table if exists public.labels enable row level security;
alter table if exists public.sessions enable row level security;
alter table if exists public.problems enable row level security;
alter table if exists public.profiles enable row level security;
alter table if exists public.problem_types enable row level security;
;
