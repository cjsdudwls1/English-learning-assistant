ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS models_used jsonb DEFAULT NULL;;
