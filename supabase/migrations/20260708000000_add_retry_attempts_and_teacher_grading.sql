-- 1) retry_attempts: 등록 문제(problems) 재풀이 이력
--    problem_solving_sessions는 generated_problems FK + UNIQUE(user_id, problem_id) 제약이라
--    등록 문제의 다회 시도 기록에 쓸 수 없어 별도 테이블로 분리.
CREATE TABLE IF NOT EXISTS retry_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  problem_id UUID NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
  answer TEXT,
  is_correct BOOLEAN, -- NULL = 자동 채점 불가(수동 확인)
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_retry_attempts_user_problem
  ON retry_attempts(user_id, problem_id, attempted_at DESC);

ALTER TABLE retry_attempts ENABLE ROW LEVEL SECURITY;

-- 본인 조회/기록
CREATE POLICY "Users can view own retry attempts"
  ON retry_attempts FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Users can insert own retry attempts"
  ON retry_attempts FOR INSERT
  WITH CHECK (user_id = auth.uid());

-- 부모/선생/학원장 SELECT — 20260328000002(problem_solving_sessions)와 동일 패턴
CREATE POLICY "Parents can view children retry attempts"
  ON retry_attempts FOR SELECT
  USING (is_parent_of(auth.uid(), user_id));

CREATE POLICY "Teachers can view class students retry attempts"
  ON retry_attempts FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM class_members cm
      WHERE cm.user_id = retry_attempts.user_id
        AND cm.role = 'student'
        AND is_class_admin(auth.uid(), cm.class_id)
    )
  );

CREATE POLICY "Directors can view all retry attempts"
  ON retry_attempts FOR SELECT
  USING (get_user_role(auth.uid()) = 'director');

-- 2) 과제 작성자(교사)의 응답 채점 허용
--    기존 ar_update 정책은 student_id = auth.uid()만 허용 → 교사 수동 채점(is_correct 갱신) 불가였음.
CREATE POLICY "Assignment creators can grade responses"
  ON assignment_responses FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM shared_assignments sa
      WHERE sa.id = assignment_responses.assignment_id
        AND sa.created_by = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM shared_assignments sa
      WHERE sa.id = assignment_responses.assignment_id
        AND sa.created_by = auth.uid()
    )
  );
