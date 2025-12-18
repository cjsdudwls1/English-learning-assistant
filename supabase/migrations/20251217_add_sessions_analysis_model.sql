-- Track which AI model processed the session
-- Stores the model name used for the initial extraction/OCR

ALTER TABLE public.sessions
  ADD COLUMN IF NOT EXISTS analysis_model text;

COMMENT ON COLUMN public.sessions.analysis_model IS 'AI model used for analysis (e.g., gemini-2.5-flash, gemma-3-27b-it)';
