-- extensions
create extension if not exists pgcrypto;

-- profiles: mirror auth.users
create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text,
  created_at timestamptz not null default now()
);

-- problem types master
create table if not exists public.problem_types (
  id bigserial primary key,
  depth1 text not null,
  depth2 text not null,
  depth3 text not null,
  depth4 text not null
);

-- analysis session per image
create table if not exists public.sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  image_url text not null,
  created_at timestamptz not null default now()
);

-- extracted problems per image
create table if not exists public.problems (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  index_in_image int not null,
  stem text,
  choices jsonb,
  created_at timestamptz not null default now()
);

-- user labeling per problem
create table if not exists public.labels (
  id uuid primary key default gen_random_uuid(),
  problem_id uuid not null references public.problems(id) on delete cascade,
  user_answer text,
  user_mark text,
  is_correct boolean,
  classification jsonb,
  confidence jsonb,
  created_at timestamptz not null default now()
);

-- recreate materialized view
drop materialized view if exists public.mv_stats_by_type;
create materialized view public.mv_stats_by_type as
select 
  (classification->>'1Depth') as depth1,
  (classification->>'2Depth') as depth2,
  (classification->>'3Depth') as depth3,
  (classification->>'4Depth') as depth4,
  count(*) filter (where is_correct is true) as correct_count,
  count(*) filter (where is_correct is false) as incorrect_count,
  count(*) as total_count
from public.labels
group by 1,2,3,4;

-- enable RLS
alter table public.sessions enable row level security;
alter table public.problems enable row level security;
alter table public.labels enable row level security;

-- policies (owner-only by user_id via sessions)
drop policy if exists sessions_select_own on public.sessions;
create policy sessions_select_own on public.sessions
  for select using (auth.uid() = user_id);

drop policy if exists sessions_modify_own on public.sessions;
create policy sessions_modify_own on public.sessions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- problems
drop policy if exists problems_via_session on public.problems;
create policy problems_via_session on public.problems
  for all using (
    exists(select 1 from public.sessions s where s.id = problems.session_id and s.user_id = auth.uid())
  ) with check (
    exists(select 1 from public.sessions s where s.id = problems.session_id and s.user_id = auth.uid())
  );

-- labels
drop policy if exists labels_via_problem on public.labels;
create policy labels_via_problem on public.labels
  for all using (
    exists(
      select 1 from public.problems p
      join public.sessions s on s.id = p.session_id
      where p.id = labels.problem_id and s.user_id = auth.uid()
    )
  ) with check (
    exists(
      select 1 from public.problems p
      join public.sessions s on s.id = p.session_id
      where p.id = labels.problem_id and s.user_id = auth.uid()
    )
  );

-- storage bucket creation (insert if not exists)
insert into storage.buckets (id, name, public)
values ('problem-images', 'problem-images', true)
on conflict (id) do nothing;

-- storage policies (idempotent)
drop policy if exists storage_read_public on storage.objects;
create policy storage_read_public on storage.objects for select using ( bucket_id = 'problem-images');

drop policy if exists storage_write_own on storage.objects;
create policy storage_write_own on storage.objects for insert with check (
  bucket_id = 'problem-images' and (auth.role() = 'authenticated')
);

drop policy if exists storage_update_own on storage.objects;
create policy storage_update_own on storage.objects for update using (
  bucket_id = 'problem-images' and (auth.role() = 'authenticated')
) with check (
  bucket_id = 'problem-images' and (auth.role() = 'authenticated')
);
;
