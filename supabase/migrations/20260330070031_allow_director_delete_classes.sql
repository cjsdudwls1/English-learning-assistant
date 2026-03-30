-- classes 테이블의 기존 삭제 정책 제거
DROP POLICY IF EXISTS "class_delete" ON classes;

-- classes 테이블의 새로운 삭제 정책 생성 (생성자 또는 학원장 허용)
CREATE POLICY "class_delete" ON classes FOR DELETE USING (
  created_by = auth.uid() OR get_user_role(auth.uid()) = 'director'
);
