-- problem_solving_sessions에 부모/선생/학원장 SELECT RLS 추가
-- 기존 정책: user_id = auth.uid() (본인만 조회) — 20250101000000에서 정의
--
-- 2026-08-30 각 CREATE 앞에 DROP IF EXISTS 를 붙였다. 이 파일의 정책들은
-- **원장에 행이 없는데 프로덕션에는 이미 존재한다** — 누군가 SQL 에디터에서
-- 마이그레이션 추적 없이 실행했다는 뜻이다. 그 상태로 `db push` 를 돌리면
-- 첫 CREATE 가 42710 duplicate_object 로 죽고, db push 는 첫 실패에서 전체를
-- 중단하므로 **뒤에 대기 중인 마이그레이션이 통째로 막힌다**(실제로 막혔다).
--
-- DROP+CREATE 로 바꾼 이유(파일을 통째로 건너뛰지 않은 이유): 42710 은 첫 정책에서
-- 났을 뿐이라 나머지 둘이 존재하는지는 알 수 없다. 건너뛰면 정책 2개가 조용히
-- 빠진 채로 남을 수 있다. DROP+CREATE 는 최종 상태가 이 파일과 일치함을 보장한다.
-- 트랜잭션 안에서 돌므로 조회가 뚫리는 순간은 없다.

-- 학부모: 연결된 자녀의 풀이 세션 조회
DROP POLICY IF EXISTS "Parents can view children solving sessions" ON problem_solving_sessions;
CREATE POLICY "Parents can view children solving sessions"
  ON problem_solving_sessions FOR SELECT
  USING (is_parent_of(auth.uid(), user_id));

-- 선생님: 소속 학급 학생의 풀이 세션 조회
DROP POLICY IF EXISTS "Teachers can view class students solving sessions" ON problem_solving_sessions;
CREATE POLICY "Teachers can view class students solving sessions"
  ON problem_solving_sessions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM class_members cm
      WHERE cm.user_id = problem_solving_sessions.user_id
        AND cm.role = 'student'
        AND is_class_admin(auth.uid(), cm.class_id)
    )
  );

-- 학원장: 전체 풀이 세션 조회
DROP POLICY IF EXISTS "Directors can view all solving sessions" ON problem_solving_sessions;
CREATE POLICY "Directors can view all solving sessions"
  ON problem_solving_sessions FOR SELECT
  USING (get_user_role(auth.uid()) = 'director');
