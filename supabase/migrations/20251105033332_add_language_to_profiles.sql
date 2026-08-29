-- profiles 테이블에 language 컬럼 추가
ALTER TABLE profiles 
ADD COLUMN IF NOT EXISTS language TEXT;

-- language는 'en' 또는 'ko'만 허용하는 CHECK 제약조건 추가
ALTER TABLE profiles
ADD CONSTRAINT profiles_language_check 
CHECK (language IS NULL OR language IN ('en', 'ko'));

-- 코멘트 추가
COMMENT ON COLUMN profiles.language IS '언어 설정: en (영어), ko (한국어)';;
