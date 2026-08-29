-- problems 테이블에 problem_metadata JSONB 컬럼 추가
ALTER TABLE problems 
ADD COLUMN IF NOT EXISTS problem_metadata JSONB;

-- 인덱스 생성 (메타데이터 조회 성능 향상)
CREATE INDEX IF NOT EXISTS idx_problems_metadata 
ON problems USING GIN (problem_metadata);

-- 코멘트 추가
COMMENT ON COLUMN problems.problem_metadata IS '문제 분석 메타데이터: 난이도, 단어 난이도, 문제 유형, 분석 정보';;
