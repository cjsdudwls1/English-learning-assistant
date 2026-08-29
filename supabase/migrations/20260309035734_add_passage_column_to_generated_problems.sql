ALTER TABLE public.generated_problems
ADD COLUMN IF NOT EXISTS passage TEXT DEFAULT NULL;

COMMENT ON COLUMN public.generated_problems.passage IS 'AI 생성 시 포함된 영어 지문 (700~2000자). includePassage 옵션이 켜진 경우에만 값이 존재.';;
