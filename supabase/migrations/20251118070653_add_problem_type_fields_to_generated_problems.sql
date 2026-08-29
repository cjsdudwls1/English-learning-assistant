-- generated_problems 테이블에 문제 유형별 필드 추가

-- 단답형용 정답 필드
ALTER TABLE generated_problems 
ADD COLUMN IF NOT EXISTS correct_answer TEXT;

COMMENT ON COLUMN generated_problems.correct_answer IS '단답형 문제의 정답 (1-3단어)';

-- 서술형용 가이드라인 필드
ALTER TABLE generated_problems 
ADD COLUMN IF NOT EXISTS guidelines TEXT;

COMMENT ON COLUMN generated_problems.guidelines IS '서술형 문제의 답변 가이드라인';

-- OX 문제용 is_correct 필드 (문제 자체가 참/거짓)
ALTER TABLE generated_problems 
ADD COLUMN IF NOT EXISTS is_correct BOOLEAN;

COMMENT ON COLUMN generated_problems.is_correct IS 'OX 문제의 정답 (true/false)';;
