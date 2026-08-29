-- assignment_responses SELECT 범위 축소 — 학생이 같은 과제를 받은 **다른 학생의 답안**을 읽던 문제.
--
-- 기존 정책:
--   ar_select USING (student_id = auth.uid() OR can_view_assignment(auth.uid(), assignment_id))
-- 인데 can_view_assignment는 "과제를 배정받은 학생 본인"에게도 true를 준다
--   (20260328 / 20260329: EXISTS (SELECT 1 FROM assignment_targets WHERE assignment_id = aid AND student_id = uid))
-- 그 분기는 shared_assignments·assignment_problems·assignment_targets를 학생에게 열어주려고 만든 것인데,
-- 응답 테이블에까지 그대로 쓰이면서 반 친구들의 답안·정오답이 전부 읽혔다.
--
-- 실제 증상: 학생 풀이 화면이 이 조회 결과를 "내가 푼 문제"로 신뢰해서
--   (1) 내가 풀지 않은 문제에 정답 리뷰 화면이 뜨고(정답 노출)
--   (2) 반 친구들이 다 풀면 완료 화면이 떠 본인이 과제를 못 푸는 상태가 됐다.
-- 프론트는 fetchMyAssignmentResponses로 이미 고쳤지만, 브라우저에서 직접 질의하면 여전히 읽혔다.
-- 경계는 클라이언트가 아니라 DB가 지켜야 한다.
--
-- 이 마이그레이션은 재적용 가능하다(DROP POLICY IF EXISTS 선행, 함수는 CREATE OR REPLACE).

-- 응답을 **검토**할 수 있는 사람 = can_view_assignment에서 "배정받은 학생" 분기만 제거한 것.
-- 나머지 네 분기(작성 교사 / 원장 / 학부모 / 반 관리 교사)는 20260329 정의와 동일하게 유지한다.
CREATE OR REPLACE FUNCTION can_review_assignment_responses(uid UUID, aid UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (SELECT 1 FROM shared_assignments WHERE id = aid AND created_by = uid)
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

DROP POLICY IF EXISTS "ar_select" ON assignment_responses;
CREATE POLICY "ar_select" ON assignment_responses FOR SELECT USING (
  student_id = auth.uid()
  OR can_review_assignment_responses(auth.uid(), assignment_id)
);

-- can_view_assignment 자체는 건드리지 않는다. shared_assignments / assignment_problems /
-- assignment_targets는 학생이 자기 과제를 열어보려면 그 관대한 정의가 필요하다.
