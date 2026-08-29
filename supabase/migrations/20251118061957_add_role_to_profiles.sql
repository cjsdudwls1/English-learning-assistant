-- profiles 테이블에 role 컬럼 추가
-- role: 'student' (학생), 'parent' (학부모), 'teacher' (선생님)

ALTER TABLE profiles 
ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'student'
CHECK (role IN ('student', 'parent', 'teacher'));

COMMENT ON COLUMN profiles.role IS '사용자 권한: student (학생), parent (학부모), teacher (선생님)';

-- 기존 사용자에 대한 기본값 설정 (이미 student로 설정됨)
-- 새로운 회원가입 사용자는 반드시 role을 선택해야 함;
