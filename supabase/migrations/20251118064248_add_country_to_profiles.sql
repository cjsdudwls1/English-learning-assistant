-- profiles 테이블에 country 컬럼 추가
-- country: 'singapore' (싱가폴), 'korea' (대한민국), 'china' (중국)

ALTER TABLE profiles 
ADD COLUMN IF NOT EXISTS country TEXT
CHECK (country IS NULL OR country IN ('singapore', 'korea', 'china'));

COMMENT ON COLUMN profiles.country IS '사용자 국가: singapore (싱가폴), korea (대한민국), china (중국)';;
