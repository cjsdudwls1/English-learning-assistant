-- =============================================================
-- 역할 기반 학급 관리 + 과제 공유 시스템 마이그레이션
-- =============================================================

-- =====================
-- Step 1: 테이블 생성 (RLS 정책 없이)
-- =====================

-- 1. classes (학급)
CREATE TABLE IF NOT EXISTS classes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_classes_created_by ON classes(created_by);
ALTER TABLE classes ENABLE ROW LEVEL SECURITY;

-- 2. class_members (학급 멤버십)
CREATE TABLE IF NOT EXISTS class_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id UUID NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('teacher', 'student')),
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(class_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_class_members_class ON class_members(class_id);
CREATE INDEX IF NOT EXISTS idx_class_members_user ON class_members(user_id);
ALTER TABLE class_members ENABLE ROW LEVEL SECURITY;

-- 3. parent_children (학부모-자녀 관계)
CREATE TABLE IF NOT EXISTS parent_children (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  child_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(parent_id, child_id)
);
CREATE INDEX IF NOT EXISTS idx_pc_parent ON parent_children(parent_id);
CREATE INDEX IF NOT EXISTS idx_pc_child ON parent_children(child_id);
ALTER TABLE parent_children ENABLE ROW LEVEL SECURITY;

-- 4. shared_assignments (공유 과제)
CREATE TABLE IF NOT EXISTS shared_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  class_id UUID REFERENCES classes(id) ON DELETE CASCADE,
  due_date TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sa_created_by ON shared_assignments(created_by);
CREATE INDEX IF NOT EXISTS idx_sa_class ON shared_assignments(class_id);
ALTER TABLE shared_assignments ENABLE ROW LEVEL SECURITY;

-- 5. assignment_problems (과제에 포함된 문제)
CREATE TABLE IF NOT EXISTS assignment_problems (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id UUID NOT NULL REFERENCES shared_assignments(id) ON DELETE CASCADE,
  problem_id UUID NOT NULL REFERENCES generated_problems(id) ON DELETE CASCADE,
  order_index INTEGER NOT NULL DEFAULT 0,
  UNIQUE(assignment_id, problem_id)
);
CREATE INDEX IF NOT EXISTS idx_ap_assignment ON assignment_problems(assignment_id);
ALTER TABLE assignment_problems ENABLE ROW LEVEL SECURITY;

-- 6. assignment_targets (과제 대상 학생)
CREATE TABLE IF NOT EXISTS assignment_targets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id UUID NOT NULL REFERENCES shared_assignments(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  UNIQUE(assignment_id, student_id)
);
CREATE INDEX IF NOT EXISTS idx_at_assignment ON assignment_targets(assignment_id);
CREATE INDEX IF NOT EXISTS idx_at_student ON assignment_targets(student_id);
ALTER TABLE assignment_targets ENABLE ROW LEVEL SECURITY;

-- 7. assignment_responses (과제 응답)
CREATE TABLE IF NOT EXISTS assignment_responses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id UUID NOT NULL REFERENCES shared_assignments(id) ON DELETE CASCADE,
  problem_id UUID NOT NULL REFERENCES generated_problems(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  answer TEXT,
  is_correct BOOLEAN,
  time_spent_seconds INTEGER,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(assignment_id, problem_id, student_id)
);
CREATE INDEX IF NOT EXISTS idx_ar_assignment ON assignment_responses(assignment_id);
CREATE INDEX IF NOT EXISTS idx_ar_student ON assignment_responses(student_id);
CREATE INDEX IF NOT EXISTS idx_ar_submitted ON assignment_responses(submitted_at);
ALTER TABLE assignment_responses ENABLE ROW LEVEL SECURITY;

-- =====================
-- Step 2: 헬퍼 함수 정의 (테이블 생성 후)
-- =====================

CREATE OR REPLACE FUNCTION get_user_role(uid UUID)
RETURNS TEXT AS $$
  SELECT COALESCE(role, 'student') FROM profiles WHERE user_id = uid;
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION is_class_admin(uid UUID, cid UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM class_members WHERE user_id = uid AND class_id = cid AND role = 'teacher'
  ) OR EXISTS (
    SELECT 1 FROM classes WHERE id = cid AND created_by = uid
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION is_parent_of(parent_uid UUID, child_uid UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM parent_children WHERE parent_id = parent_uid AND child_id = child_uid
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION can_view_assignment(uid UUID, aid UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (SELECT 1 FROM shared_assignments WHERE id = aid AND created_by = uid)
  OR EXISTS (SELECT 1 FROM assignment_targets WHERE assignment_id = aid AND student_id = uid)
  OR get_user_role(uid) = 'director'
  OR EXISTS (
    SELECT 1 FROM assignment_targets at2
    JOIN parent_children pc ON pc.child_id = at2.student_id
    WHERE at2.assignment_id = aid AND pc.parent_id = uid
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- =====================
-- Step 3: RLS 정책 생성 (헬퍼 함수 정의 후)
-- =====================

-- classes RLS
CREATE POLICY "class_select" ON classes FOR SELECT USING (
  created_by = auth.uid()
  OR EXISTS (SELECT 1 FROM class_members WHERE class_id = id AND user_id = auth.uid())
  OR get_user_role(auth.uid()) = 'director'
);
CREATE POLICY "class_insert" ON classes FOR INSERT
  WITH CHECK (get_user_role(auth.uid()) IN ('teacher', 'director'));
CREATE POLICY "class_update" ON classes FOR UPDATE USING (created_by = auth.uid());
CREATE POLICY "class_delete" ON classes FOR DELETE USING (created_by = auth.uid());

-- class_members RLS
CREATE POLICY "cm_select" ON class_members FOR SELECT USING (
  user_id = auth.uid()
  OR is_class_admin(auth.uid(), class_id)
  OR get_user_role(auth.uid()) = 'director'
);
CREATE POLICY "cm_insert" ON class_members FOR INSERT
  WITH CHECK (is_class_admin(auth.uid(), class_id) OR get_user_role(auth.uid()) = 'director');
CREATE POLICY "cm_delete" ON class_members FOR DELETE
  USING (is_class_admin(auth.uid(), class_id) OR get_user_role(auth.uid()) = 'director');

-- parent_children RLS
CREATE POLICY "pc_select" ON parent_children FOR SELECT USING (
  parent_id = auth.uid() OR child_id = auth.uid()
  OR get_user_role(auth.uid()) IN ('teacher', 'director')
);
CREATE POLICY "pc_insert" ON parent_children FOR INSERT WITH CHECK (
  parent_id = auth.uid() OR get_user_role(auth.uid()) IN ('teacher', 'director')
);
CREATE POLICY "pc_delete" ON parent_children FOR DELETE USING (
  parent_id = auth.uid() OR get_user_role(auth.uid()) IN ('teacher', 'director')
);

-- shared_assignments RLS
CREATE POLICY "sa_select" ON shared_assignments FOR SELECT
  USING (can_view_assignment(auth.uid(), id));
CREATE POLICY "sa_insert" ON shared_assignments FOR INSERT
  WITH CHECK (get_user_role(auth.uid()) IN ('teacher', 'director'));
CREATE POLICY "sa_update" ON shared_assignments FOR UPDATE USING (created_by = auth.uid());
CREATE POLICY "sa_delete" ON shared_assignments FOR DELETE USING (created_by = auth.uid());

-- assignment_problems RLS
CREATE POLICY "ap_select" ON assignment_problems FOR SELECT
  USING (can_view_assignment(auth.uid(), assignment_id));
CREATE POLICY "ap_insert" ON assignment_problems FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM shared_assignments WHERE id = assignment_id AND created_by = auth.uid())
);

-- assignment_targets RLS
CREATE POLICY "at_select" ON assignment_targets FOR SELECT USING (
  student_id = auth.uid()
  OR can_view_assignment(auth.uid(), assignment_id)
);
CREATE POLICY "at_insert" ON assignment_targets FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM shared_assignments WHERE id = assignment_id AND created_by = auth.uid())
);

-- assignment_responses RLS
CREATE POLICY "ar_select" ON assignment_responses FOR SELECT USING (
  student_id = auth.uid()
  OR can_view_assignment(auth.uid(), assignment_id)
);
CREATE POLICY "ar_insert" ON assignment_responses FOR INSERT
  WITH CHECK (student_id = auth.uid());
CREATE POLICY "ar_update" ON assignment_responses FOR UPDATE
  USING (student_id = auth.uid());
