-- generated_problems 테이블에 problem_type 컬럼 추가
-- problem_type: 'multiple_choice' (객관식), 'short_answer' (단답형), 'essay' (서술형), 'ox' (OX)

ALTER TABLE generated_problems 
ADD COLUMN IF NOT EXISTS problem_type TEXT DEFAULT 'multiple_choice'
CHECK (problem_type IN ('multiple_choice', 'short_answer', 'essay', 'ox'));

COMMENT ON COLUMN generated_problems.problem_type IS '문제 유형: multiple_choice (객관식), short_answer (단답형), essay (서술형), ox (OX)';

-- 편집 가능 여부를 위한 컬럼 추가 (선생님만 편집 가능)
ALTER TABLE generated_problems 
ADD COLUMN IF NOT EXISTS is_editable BOOLEAN DEFAULT false;

COMMENT ON COLUMN generated_problems.is_editable IS '편집 가능 여부: 선생님이 생성한 문제는 true';;
