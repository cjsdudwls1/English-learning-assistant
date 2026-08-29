
-- shared_assignments: 생성자가 자신의 과제를 직접 SELECT할 수 있는 정책 추가
-- 기존 sa_select (can_view_assignment 기반) 정책은 유지하여 학원장/학부모 접근을 보장
CREATE POLICY "sa_select_creator"
  ON shared_assignments FOR SELECT
  USING (created_by = auth.uid());

-- shared_assignments: 학생이 자신에게 할당된 과제를 볼 수 있는 직접 정책 추가
CREATE POLICY "sa_select_student"
  ON shared_assignments FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM assignment_targets
      WHERE assignment_targets.assignment_id = shared_assignments.id
      AND assignment_targets.student_id = auth.uid()
    )
  );
;
