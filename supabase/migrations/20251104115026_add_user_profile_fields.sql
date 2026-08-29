-- profiles 테이블에 성별, 연령, 학년 컬럼 추가
ALTER TABLE profiles 
ADD COLUMN IF NOT EXISTS gender TEXT,
ADD COLUMN IF NOT EXISTS age INTEGER,
ADD COLUMN IF NOT EXISTS grade TEXT;

-- gender는 'male', 'female', 'other' 또는 null
-- age는 정수 (자유 입력)
-- grade는 '초등학교 1학년' ~ '고등학교 3학년' 또는 null

-- 기존 데이터를 위한 코멘트 추가
COMMENT ON COLUMN profiles.gender IS '성별: male, female, other';
COMMENT ON COLUMN profiles.age IS '연령 (자유 입력)';
COMMENT ON COLUMN profiles.grade IS '학년: 초등학교 1학년 ~ 고등학교 3학년';;
