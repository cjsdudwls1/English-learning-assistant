-- 국가 코드를 ISO 코드로 변경
-- korea → KR, singapore → SG, china → CN

-- 1. 기존 데이터 마이그레이션
UPDATE profiles 
SET country = CASE 
  WHEN country = 'korea' THEN 'KR'
  WHEN country = 'singapore' THEN 'SG'
  WHEN country = 'china' THEN 'CN'
  ELSE country
END
WHERE country IN ('korea', 'singapore', 'china');

-- 2. 기존 CHECK 제약조건 삭제
ALTER TABLE profiles 
DROP CONSTRAINT IF EXISTS profiles_country_check;

-- 3. 새로운 CHECK 제약조건 추가 (KR, SG, CN)
ALTER TABLE profiles 
ADD CONSTRAINT profiles_country_check 
CHECK (country IS NULL OR country IN ('KR', 'SG', 'CN'));

-- 4. 컬럼 코멘트 업데이트
COMMENT ON COLUMN profiles.country IS '사용자 국가: KR (대한민국), SG (싱가폴), CN (중국)';;
