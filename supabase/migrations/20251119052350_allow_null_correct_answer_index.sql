-- generated_problems 테이블의 correct_answer_index 컬럼을 NULL 허용하도록 변경
-- 객관식이 아닌 문제 타입(ox, essay, short_answer)에서는 correct_answer_index가 필요하지 않음

ALTER TABLE generated_problems 
ALTER COLUMN correct_answer_index DROP NOT NULL;
;
