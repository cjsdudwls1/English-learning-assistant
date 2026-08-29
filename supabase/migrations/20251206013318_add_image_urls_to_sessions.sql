-- image_urls 컬럼 추가
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS image_urls JSONB;

-- 기존 image_url 데이터를 image_urls 배열로 변환
UPDATE sessions 
SET image_urls = CASE 
  WHEN image_url IS NOT NULL THEN jsonb_build_array(image_url)
  ELSE '[]'::jsonb
END
WHERE image_urls IS NULL;

-- 인덱스 추가 (선택사항 - JSONB 배열 검색 최적화)
CREATE INDEX IF NOT EXISTS idx_sessions_image_urls ON sessions USING GIN (image_urls);;
