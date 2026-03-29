-- =============================================================
-- profiles 테이블 role CHECK 제약에 director 역할 추가
-- =============================================================

-- 기존 role 관련 CHECK 제약을 모두 삭제 (이름이 다를 수 있으므로 동적으로 찾아 삭제)
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    WHERE rel.relname = 'profiles'
      AND nsp.nspname = 'public'
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) LIKE '%role%'
  LOOP
    EXECUTE 'ALTER TABLE profiles DROP CONSTRAINT ' || quote_ident(r.conname);
  END LOOP;
END $$;

-- director를 포함한 새 제약 생성
ALTER TABLE profiles ADD CONSTRAINT profiles_role_check CHECK (role IN ('student', 'teacher', 'parent', 'director'));
