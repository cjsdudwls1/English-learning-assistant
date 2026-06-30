-- 사용자 BYOK(Bring Your Own Key) API 키 저장 테이블
-- 평문 키는 절대 저장하지 않는다: encrypted_key = AES-256-GCM(cryptoKeys.ts) 암호문만 저장.
-- 접근은 manage-api-keys Edge Function(service_role)을 통해서만 → RLS는 anon/authenticated 전면 차단.

create table if not exists public.user_api_keys (
  user_id       uuid        not null references auth.users(id) on delete cascade,
  provider      text        not null check (provider in ('anthropic', 'openai')),
  encrypted_key text        not null,
  key_hint      text,                      -- 끝 4자리 등 표시용 힌트 (평문 키 아님)
  is_active     boolean     not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  primary key (user_id, provider)
);

comment on table public.user_api_keys is '사용자 BYOK API 키(암호문). manage-api-keys 함수만 접근.';
comment on column public.user_api_keys.encrypted_key is 'AES-256-GCM 암호문(base64). 평문 키 저장 금지.';
comment on column public.user_api_keys.is_active is 'user당 활성 키는 최대 1개. AI 호출 시 이 행의 provider 사용.';

-- updated_at 자동 갱신
create or replace function public.set_user_api_keys_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_user_api_keys_updated_at on public.user_api_keys;
create trigger trg_user_api_keys_updated_at
  before update on public.user_api_keys
  for each row execute function public.set_user_api_keys_updated_at();

-- RLS: 정책을 두지 않아 anon/authenticated의 직접 접근을 모두 차단.
-- service_role(Edge Function)은 RLS를 우회하므로 manage-api-keys만 읽고 쓴다.
alter table public.user_api_keys enable row level security;
