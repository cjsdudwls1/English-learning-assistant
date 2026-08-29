-- profiles 테이블에 country 컬럼 추가
-- ISO 3166-1 alpha-2 국가 코드 사용 (예: 'KR', 'US', 'JP' 등)

ALTER TABLE profiles 
ADD COLUMN IF NOT EXISTS country TEXT;

COMMENT ON COLUMN profiles.country IS '국가 코드 (ISO 3166-1 alpha-2): 예) KR, US, JP, CN 등';;
