
-- =============================================
-- 학부모/선생/학원장이 연결된 학생의 통계를 볼 수 있도록
-- sessions, problems, labels 테이블에 SELECT RLS 정책 추가
-- =============================================

-- ==================
-- 1. SESSIONS 테이블
-- ==================

-- 학부모: 자녀의 세션 조회 가능
CREATE POLICY "Parents can view children sessions"
ON public.sessions
FOR SELECT
USING (is_parent_of(auth.uid(), user_id));

-- 선생: 같은 학급 학생의 세션 조회 가능
CREATE POLICY "Teachers can view class students sessions"
ON public.sessions
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM class_members cm
    WHERE cm.user_id = sessions.user_id
      AND cm.role = 'student'
      AND is_class_admin(auth.uid(), cm.class_id)
  )
);

-- 학원장: 모든 세션 조회 가능
CREATE POLICY "Directors can view all sessions"
ON public.sessions
FOR SELECT
USING (get_user_role(auth.uid()) = 'director');

-- ==================
-- 2. PROBLEMS 테이블
-- ==================

-- 학부모: 자녀의 문제 조회 가능
CREATE POLICY "Parents can view children problems"
ON public.problems
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM sessions s
    WHERE s.id = problems.session_id
      AND is_parent_of(auth.uid(), s.user_id)
  )
);

-- 선생: 같은 학급 학생의 문제 조회 가능
CREATE POLICY "Teachers can view class students problems"
ON public.problems
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM sessions s
    JOIN class_members cm ON cm.user_id = s.user_id AND cm.role = 'student'
    WHERE s.id = problems.session_id
      AND is_class_admin(auth.uid(), cm.class_id)
  )
);

-- 학원장: 모든 문제 조회 가능
CREATE POLICY "Directors can view all problems"
ON public.problems
FOR SELECT
USING (get_user_role(auth.uid()) = 'director');

-- ==================
-- 3. LABELS 테이블  
-- ==================

-- 학부모: 자녀의 라벨 조회 가능
CREATE POLICY "Parents can view children labels"
ON public.labels
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM problems p
    JOIN sessions s ON s.id = p.session_id
    WHERE p.id = labels.problem_id
      AND is_parent_of(auth.uid(), s.user_id)
  )
);

-- 선생: 같은 학급 학생의 라벨 조회 가능
CREATE POLICY "Teachers can view class students labels"
ON public.labels
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM problems p
    JOIN sessions s ON s.id = p.session_id
    JOIN class_members cm ON cm.user_id = s.user_id AND cm.role = 'student'
    WHERE p.id = labels.problem_id
      AND is_class_admin(auth.uid(), cm.class_id)
  )
);

-- 학원장: 모든 라벨 조회 가능
CREATE POLICY "Directors can view all labels"
ON public.labels
FOR SELECT
USING (get_user_role(auth.uid()) = 'director');
;
