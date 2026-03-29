-- problem_solving_sessions에 부모/선생/학원장 SELECT RLS 추가
-- 기존 정책: user_id = auth.uid() (본인만 조회) — 20250101000000에서 정의

-- 학부모: 연결된 자녀의 풀이 세션 조회
CREATE POLICY "Parents can view children solving sessions"
  ON problem_solving_sessions FOR SELECT
  USING (is_parent_of(auth.uid(), user_id));

-- 선생님: 소속 학급 학생의 풀이 세션 조회
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
CREATE POLICY "Directors can view all solving sessions"
  ON problem_solving_sessions FOR SELECT
  USING (get_user_role(auth.uid()) = 'director');
