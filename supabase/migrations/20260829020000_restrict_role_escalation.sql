-- =============================================================
-- RLS 권한 누수 수정 (2-A) — profiles.role 자가 상향 차단
--
-- 이 파일은 원래 `20260829020000_restrict_role_and_parent_link.sql` 한 덩어리였다.
-- 둘로 쪼갠 이유: 뒤쪽 절반(parent_children 승인 게이트)은 **승인할 방법이 없어서**
-- 적용하면 기능이 죽는다. 그런데 `supabase db push` 는 migrations/ 안의 미적용 파일을
-- 파일명 순으로 **전부** 밀어넣는다 — 한 파일에 같이 두면 안전한 절반만 골라 적용할 수 없다.
-- 그래서 위험한 절반은 `20260829030000_parent_link_approval.sql.HOLD` 로 빼 두었다
-- (확장자가 .sql 이 아니므로 CLI 가 집어가지 않는다). 그 파일 머리말에 보류 사유가 있다.
--
-- 이 절반은 **프론트 의존이 없다.** 트리거와 정책만 바꾼다.
--
-- [적용 시 사라지는 기능]
--   1. 프로필 화면(src/pages/ProfilePage.tsx:249-267)의 역할 자가 선택 중 **선생님 / 학원장**.
--      이미 teacher/director 인 계정이 자기 프로필을 저장하는 것은 그대로 된다(역할이 그대로면 통과).
--      학생↔학부모 전환, teacher/director → student/parent 하향도 그대로 된다.
--      막히는 것은 **teacher 또는 director 로 바꾸는 것 전부**다 — director → teacher 도 막힌다
--      (허용 목록이 student/parent 뿐이므로). 역할 변경은 관리자 경로로 하게 된다.
--   2. 회원가입(src/components/LoginButton.tsx:44-56)에서 role='director' 로 프로필을 만드는 것.
--      가입 UI 는 학생/학부모/선생님만 제공하므로(LoginButton.tsx:118-142) 화면상 변화는 없다.
--      학원장 계정은 관리자가 service_role 또는 대시보드로 부여해야 한다.
--
-- [의도적으로 남겨 둔 구멍]
--   가입 시 role='teacher' 자가 선택은 여전히 된다. 가입 UI 가 그 선택지를 제공하기 때문이다
--   (LoginButton.tsx:140). 이걸 막으려면 UI 를 먼저 바꿔야 하므로 이 파일 범위 밖이다.
--
-- 재적용 가능하다: 정책은 DROP POLICY IF EXISTS 선행,
-- 함수/트리거는 CREATE OR REPLACE + DROP TRIGGER IF EXISTS.
-- =============================================================


-- #####################################################################
-- 2-1. profiles.role 자가 상향 차단
--
-- 증상: 아무 계정이나 프로필 화면에서 "학원장"을 눌러 저장하면 그 즉시
--   get_user_role(auth.uid()) = 'director' 한 줄로 열리는 RLS 분기 전부를 통과한다.
--   (classes/class_members/shared_assignments/assignment_*/problem_solving_sessions/
--    retry_attempts/agent_runs/can_access_user_data — 학원 소속 조건이 어디에도 없다.)
--
-- 제약: profiles 의 CREATE TABLE 도, INSERT/UPDATE/DELETE 정책도 **마이그레이션에 없다.**
--   supabase/migrations 전체를 grep 했을 때 profiles 정책에 대한 유일한 흔적은
--   20260330000000_fix_profiles_select_rls.sql:7 의 주석 한 줄이다:
--     "-- INSERT/UPDATE/DELETE는 profiles_modify_own 정책으로 자기 자신만 허용 유지"
--   즉 그 정책은 **버전 관리 밖(대시보드)** 에 있고, 실제 이름과 정의를 확인할 수 없다.
--
-- 그래서 두 겹으로 막는다:
--   (a) 알려진/추정 이름을 DROP 하고 의도를 명시한 정책 3개를 새로 만든다.
--   (b) 이름을 모르는 정책이 살아남아도 뚫리지 않도록 **트리거**로 실제 강제를 건다.
--       RLS 정책은 permissive 라 OR 로 합쳐진다 — 이름 모르는 정책 하나만 남아도 (a)는 무력하다.
--       트리거는 정책과 무관하게 항상 실행되므로 이쪽이 진짜 방어선이다.
-- #####################################################################

-- 교체하기 전에 **현재 정의를 로그로 남긴다.** 대시보드에만 있는 정책을 DROP 하는 것이므로
-- 되돌릴 근거가 없으면 안 된다. 적용 로그(NOTICE)를 반드시 보관할 것.
--
-- 적용 전에 아래를 직접 실행해 실제 정책을 눈으로 확인하는 것을 권장한다:
--   SELECT policyname, cmd, qual, with_check FROM pg_policies
--    WHERE schemaname = 'public' AND tablename = 'profiles';
-- 특히 INSERT 정책이 user_id = auth.uid() 보다 관대하다면(예: WITH CHECK (true)),
-- 아래 profiles_insert_own 이 그보다 엄격해져 회원가입이 깨질 수 있다.
DO $do$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT policyname, cmd, COALESCE(qual, '-') AS qual, COALESCE(with_check, '-') AS wc
      FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'profiles'
  LOOP
    RAISE NOTICE '[교체 전 profiles 정책] % [%] USING=% WITH CHECK=%', r.policyname, r.cmd, r.qual, r.wc;
  END LOOP;
END
$do$;

-- (a) 정책 교체. 이름을 모르므로 후보를 모두 DROP 한다(존재하지 않으면 무시된다).
DROP POLICY IF EXISTS "profiles_modify_own" ON profiles;
DROP POLICY IF EXISTS "profiles_insert_own" ON profiles;
DROP POLICY IF EXISTS "profiles_update_own" ON profiles;
DROP POLICY IF EXISTS "profiles_delete_own" ON profiles;
DROP POLICY IF EXISTS "Users can insert own profile" ON profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON profiles;
DROP POLICY IF EXISTS "Users can delete own profile" ON profiles;

-- profiles_modify_own 이 FOR ALL 이었을 가능성이 높다(같은 저장소의 problems_modify_own /
-- labels_modify_own 이 그 형태다 — English-learning-assistant/supabase/migrations/
-- unify_rls_policies_for_stats_perf.sql:59, 76). 그것을 DROP 하면 INSERT/DELETE 도 함께
-- 사라지므로 여기서 셋을 모두 다시 만든다. SELECT 는 profiles_select_authenticated
-- (20260330000000:14-17)가 이미 담당하므로 건드리지 않는다.
CREATE POLICY "profiles_insert_own" ON profiles FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "profiles_update_own" ON profiles FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (
    user_id = auth.uid()
    AND (
      role IS NULL                          -- 역할 미설정 프로필(언어 저장만 한 계정)의 갱신 허용
      OR role IN ('student', 'parent')      -- 하향/수평 전환은 자유
      OR role = get_user_role(auth.uid())   -- 역할이 그대로면 통과 → 기존 teacher/director 저장 보존
    )
  );

CREATE POLICY "profiles_delete_own" ON profiles FOR DELETE
  USING (user_id = auth.uid());

-- get_user_role 은 SECURITY DEFINER STABLE 이라 (1) profiles 정책 재귀를 일으키지 않고
-- (2) UPDATE 문의 스냅샷을 쓰므로 **갱신 전** 역할을 돌려준다. 그래서 "역할이 그대로면 통과"가
-- 성립한다. 다만 이 미묘함에 보안을 걸지는 않는다 — 실제 강제는 아래 트리거다.

-- (b) 트리거. 정책 이름을 몰라도, 대시보드에 남은 정책이 있어도 관통되지 않는다.
CREATE OR REPLACE FUNCTION public.guard_profile_role_escalation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  -- service_role / SQL 에디터 / 마이그레이션: 관리자 프로비저닝 경로는 막지 않는다.
  -- PostgREST 익명 요청도 auth.uid() 가 NULL 이지만, 익명은 자기 uid 가 없어
  -- 이 검사가 지키려는 "자기 역할 상향" 자체를 할 수 없다(get_user_role 은 uid 로 조회한다).
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  -- 남의 행을 쓰는 경우는 정책이 판단할 몫이다(정상 정책이면 애초에 못 온다).
  IF NEW.user_id IS DISTINCT FROM auth.uid() THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.role = 'director' THEN
      RAISE EXCEPTION '학원장 역할은 스스로 지정할 수 없습니다. 관리자에게 요청하세요.'
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE: 역할이 그대로면 통과. 바꾸려면 student/parent 로만.
  -- (NEW.role 이 NULL 인데 OLD 가 teacher/director 면 차단된다 — 역할을 지워 우회하는 길도 막는다.)
  IF NEW.role IS DISTINCT FROM OLD.role
     AND COALESCE(NEW.role, '') NOT IN ('student', 'parent') THEN
    RAISE EXCEPTION '선생님/학원장 역할은 프로필 화면에서 스스로 부여할 수 없습니다.'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_profiles_guard_role_escalation ON profiles;
CREATE TRIGGER trg_profiles_guard_role_escalation
  BEFORE INSERT OR UPDATE ON profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_profile_role_escalation();

-- 남는 구멍(의도적): 가입 시 role='teacher' 는 여전히 자가 선택 가능하다. 가입 UI 가
-- 선생님을 제공하고 있어(LoginButton.tsx:140) 막으면 가입 자체가 깨진다.
-- 학생/학부모만 허용하려면 위 트리거의 INSERT 분기를 아래로 바꾸면 된다:
--     IF COALESCE(NEW.role, 'student') NOT IN ('student', 'parent') THEN ... RAISE ...
-- 그 경우 교사 계정도 관리자 승인 경로가 필요하다(가입 화면의 "선생님" 버튼 제거 필요).

-- 적용 후 확인용: 이 마이그레이션이 만들지 않은 UPDATE/ALL 정책이 profiles 에 남아 있으면 경고.
-- (남아 있어도 트리거가 막지만, 사람이 정리하도록 보이게 한다.)
DO $do$
DECLARE
  leftover TEXT;
BEGIN
  SELECT string_agg(policyname || ' [' || cmd || ']', ', ')
    INTO leftover
    FROM pg_policies
   WHERE schemaname = 'public'
     AND tablename = 'profiles'
     AND cmd IN ('ALL', 'UPDATE')
     AND policyname <> 'profiles_update_own';
  IF leftover IS NOT NULL THEN
    RAISE WARNING 'profiles 에 이 마이그레이션이 만들지 않은 쓰기 정책이 남아 있습니다: %', leftover;
  END IF;
END
$do$;

