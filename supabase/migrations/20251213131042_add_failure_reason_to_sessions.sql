alter table public.sessions
  add column if not exists failure_stage text,
  add column if not exists failure_message text;;
