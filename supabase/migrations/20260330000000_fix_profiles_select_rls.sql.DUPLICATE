-- =============================================================
-- profiles SELECT RLS 정책 수정
-- 기존: 자기 자신만 SELECT 가능 (타 사용자 프로필 검색 불가)
-- 변경: 인증된 사용자는 모든 프로필 SELECT 가능
-- 이유: 선생님의 학생 추가, 학부모의 자녀 등록, 학원장의 교사 실적 조회 등
--       크로스 권한 기능에서 이메일 기반 프로필 검색이 필수적임
-- INSERT/UPDATE/DELETE는 profiles_modify_own 정책으로 자기 자신만 허용 유지
-- =============================================================

-- 1. 기존 자기 자신만 SELECT 허용 정책 제거
DROP POLICY IF EXISTS "profiles_select_own" ON profiles;

-- 2. 인증된 사용자는 모든 프로필을 조회 가능
CREATE POLICY "profiles_select_authenticated" ON profiles
  FOR SELECT
  TO authenticated
  USING (true);

-- 3. profiles.email이 NULL인 레코드를 auth.users에서 동기화
UPDATE profiles
SET email = u.email
FROM auth.users u
WHERE profiles.user_id = u.id
  AND profiles.email IS NULL;
