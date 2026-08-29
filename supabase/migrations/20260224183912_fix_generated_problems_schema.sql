
-- choices를 NULL 허용으로 변경 (ox, essay, short_answer는 choices 없음)
ALTER TABLE public.generated_problems ALTER COLUMN choices DROP NOT NULL;

-- classification도 NULL 허용으로 변경 (분류 없이 생성 가능)
ALTER TABLE public.generated_problems ALTER COLUMN classification DROP NOT NULL;

-- short_answer용 컬럼 추가
ALTER TABLE public.generated_problems ADD COLUMN IF NOT EXISTS acceptable_answers jsonb DEFAULT '[]'::jsonb;

-- essay용 컬럼 추가
ALTER TABLE public.generated_problems ADD COLUMN IF NOT EXISTS sample_answer text;
ALTER TABLE public.generated_problems ADD COLUMN IF NOT EXISTS grading_criteria jsonb DEFAULT '[]'::jsonb;
;
