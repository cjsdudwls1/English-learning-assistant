-- can_view_assignment 함수에 class_admin 조건 추가
-- 같은 학급의 교사가 해당 학급에 배정된 과제와 응답을 조회할 수 있도록 수정

CREATE OR REPLACE FUNCTION can_view_assignment(uid UUID, aid UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (SELECT 1 FROM shared_assignments WHERE id = aid AND created_by = uid)
  OR EXISTS (SELECT 1 FROM assignment_targets WHERE assignment_id = aid AND student_id = uid)
  OR get_user_role(uid) = 'director'
  OR EXISTS (
    SELECT 1 FROM assignment_targets at2
    JOIN parent_children pc ON pc.child_id = at2.student_id
    WHERE at2.assignment_id = aid AND pc.parent_id = uid
  )
  OR EXISTS (
    SELECT 1 FROM shared_assignments sa
    WHERE sa.id = aid AND sa.class_id IS NOT NULL
      AND is_class_admin(uid, sa.class_id)
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;
