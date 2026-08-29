-- problems 테이블에 content JSONB 컬럼 추가
-- 새로운 구조화된 데이터 (passage, instruction, visual_context, question_body, choices 등)를 저장

ALTER TABLE public.problems
ADD COLUMN IF NOT EXISTS content jsonb DEFAULT NULL;

-- content 컬럼에 대한 주석 추가
COMMENT ON COLUMN public.problems.content IS '구조화된 문제 내용 (passage, instruction, visual_context, question_body, choices, shared_passage_ref 등)';

-- GIN 인덱스 추가 (JSONB 검색 성능 향상)
CREATE INDEX IF NOT EXISTS idx_problems_content_gin ON public.problems USING GIN (content);

-- shared_passage_ref 필드에 대한 인덱스 (공유 지문 조회 성능 향상)
CREATE INDEX IF NOT EXISTS idx_problems_content_shared_passage_ref ON public.problems ((content->>'shared_passage_ref'))
WHERE content->>'shared_passage_ref' IS NOT NULL;;
