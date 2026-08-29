-- 신뢰도 관련 필드 제거 마이그레이션

-- 1. labels 테이블의 confidence 컬럼 삭제
ALTER TABLE labels DROP COLUMN IF EXISTS confidence;

-- 2. classification JSONB에서 분류_신뢰도 필드 제거 (기존 데이터 업데이트)
UPDATE labels 
SET classification = classification - '분류_신뢰도'
WHERE classification ? '분류_신뢰도';

-- 3. problems 테이블의 choices JSONB에서 confidence 필드 제거 (기존 데이터 업데이트)
UPDATE problems
SET choices = (
  SELECT jsonb_agg(
    CASE 
      WHEN jsonb_typeof(choice) = 'object' THEN choice - 'confidence'
      ELSE choice
    END
  )
  FROM jsonb_array_elements(choices) AS choice
)
WHERE choices IS NOT NULL;;
