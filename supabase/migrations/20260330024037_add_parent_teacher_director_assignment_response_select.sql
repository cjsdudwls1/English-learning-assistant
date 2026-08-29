
-- =============================================
-- assignment_responses에 학부모/선생/학원장 SELECT 정책 추가
-- (기존 ar_select와 별도로, student_id 기반 조회 허용)
-- =============================================

-- 학부모: 자녀의 과제 응답 조회 가능
CREATE POLICY "Parents can view children assignment responses"
ON public.assignment_responses
FOR SELECT
USING (is_parent_of(auth.uid(), student_id));

-- 선생: 같은 학급 학생의 과제 응답 조회 가능
CREATE POLICY "Teachers can view class students assignment responses"
ON public.assignment_responses
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM class_members cm
    WHERE cm.user_id = assignment_responses.student_id
      AND cm.role = 'student'
      AND is_class_admin(auth.uid(), cm.class_id)
  )
);

-- 학원장: 모든 과제 응답 조회 가능
CREATE POLICY "Directors can view all assignment responses"
ON public.assignment_responses
FOR SELECT
USING (get_user_role(auth.uid()) = 'director');
;
