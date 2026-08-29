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
  AND profiles.email IS NULL;;
