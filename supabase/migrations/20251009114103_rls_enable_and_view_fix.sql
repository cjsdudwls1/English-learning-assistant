-- 1) RLS 활성화 (profiles, problem_types)
alter table if exists public.profiles enable row level security;
alter table if exists public.problem_types enable row level security;

-- 2) profiles 정책: 본인 레코드만 접근/수정
drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles
  for select using (auth.uid() = user_id);

drop policy if exists profiles_modify_own on public.profiles;
create policy profiles_modify_own on public.profiles
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- 3) problem_types 정책: 인증 사용자 모두 읽기 허용, 쓰기는 제한
drop policy if exists problem_types_select_all on public.problem_types;
create policy problem_types_select_all on public.problem_types
  for select using (auth.role() = 'authenticated');

-- 4) 머티리얼라이즈드 뷰 제거 후, RLS가 적용되는 일반 뷰로 대체
drop materialized view if exists public.mv_stats_by_type;
create or replace view public.vw_stats_by_type as
select 
  (classification->>'1Depth') as depth1,
  (classification->>'2Depth') as depth2,
  (classification->>'3Depth') as depth3,
  (classification->>'4Depth') as depth4,
  count(*) filter (where is_correct is true) as correct_count,
  count(*) filter (where is_correct is false) as incorrect_count,
  count(*) as total_count
from public.labels
-- labels 테이블의 RLS에 의해 현재 사용자 소유 데이터만 집계됨
group by 1,2,3,4;;
