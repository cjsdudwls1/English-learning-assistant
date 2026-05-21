-- /stats statement_timeout 근본 수정: sessions/problems/labels 각 4개 SELECT 정책을 1개 통합 정책으로 합쳐
-- planner가 OR 조건을 한 번에 최적화하도록 함. 권한 의미는 동일 유지.

-- 1) 통합 권한 헬퍼: own/parent/teacher/director 단일 함수
CREATE OR REPLACE FUNCTION public.can_access_user_data(viewer_uid uuid, target_uid uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN viewer_uid IS NULL THEN false
    WHEN viewer_uid = target_uid THEN true
    WHEN EXISTS (SELECT 1 FROM parent_children WHERE parent_id = viewer_uid AND child_id = target_uid) THEN true
    WHEN (SELECT COALESCE(role, 'student') FROM profiles WHERE user_id = viewer_uid) = 'director' THEN true
    WHEN EXISTS (
      SELECT 1 FROM class_members cm
      WHERE cm.user_id = target_uid AND cm.role = 'student'
        AND (
          EXISTS (SELECT 1 FROM class_members tcm WHERE tcm.user_id = viewer_uid AND tcm.class_id = cm.class_id AND tcm.role = 'teacher')
          OR EXISTS (SELECT 1 FROM classes c WHERE c.id = cm.class_id AND c.created_by = viewer_uid)
        )
    ) THEN true
    ELSE false
  END
$$;

-- 2) session_id 기반 헬퍼
CREATE OR REPLACE FUNCTION public.can_access_session_data(viewer_uid uuid, sid uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM sessions s
    WHERE s.id = sid AND public.can_access_user_data(viewer_uid, s.user_id)
  )
$$;

-- 3) sessions: 4개 정책 → 1개 통합
DROP POLICY IF EXISTS "Directors can view all sessions" ON public.sessions;
DROP POLICY IF EXISTS "Parents can view children sessions" ON public.sessions;
DROP POLICY IF EXISTS "Teachers can view class students sessions" ON public.sessions;
DROP POLICY IF EXISTS sessions_select_own ON public.sessions;

CREATE POLICY sessions_select_unified ON public.sessions FOR SELECT
USING (public.can_access_user_data((SELECT auth.uid()), user_id));

-- 4) problems: 4개 정책 → SELECT 통합 + ALL 분리
DROP POLICY IF EXISTS "Directors can view all problems" ON public.problems;
DROP POLICY IF EXISTS "Parents can view children problems" ON public.problems;
DROP POLICY IF EXISTS "Teachers can view class students problems" ON public.problems;
DROP POLICY IF EXISTS problems_via_session ON public.problems;

CREATE POLICY problems_select_unified ON public.problems FOR SELECT
USING (public.can_access_session_data((SELECT auth.uid()), session_id));

CREATE POLICY problems_modify_own ON public.problems FOR ALL
USING (EXISTS (SELECT 1 FROM public.sessions s WHERE s.id = problems.session_id AND s.user_id = (SELECT auth.uid())))
WITH CHECK (EXISTS (SELECT 1 FROM public.sessions s WHERE s.id = problems.session_id AND s.user_id = (SELECT auth.uid())));

-- 5) labels: 4개 정책 → SELECT 통합 + ALL 분리
DROP POLICY IF EXISTS "Directors can view all labels" ON public.labels;
DROP POLICY IF EXISTS "Parents can view children labels" ON public.labels;
DROP POLICY IF EXISTS "Teachers can view class students labels" ON public.labels;
DROP POLICY IF EXISTS labels_via_problem ON public.labels;

CREATE POLICY labels_select_unified ON public.labels FOR SELECT
USING (EXISTS (
  SELECT 1 FROM public.problems p
  WHERE p.id = labels.problem_id
    AND public.can_access_session_data((SELECT auth.uid()), p.session_id)
));

CREATE POLICY labels_modify_own ON public.labels FOR ALL
USING (EXISTS (
  SELECT 1 FROM public.problems p
  JOIN public.sessions s ON s.id = p.session_id
  WHERE p.id = labels.problem_id AND s.user_id = (SELECT auth.uid())
))
WITH CHECK (EXISTS (
  SELECT 1 FROM public.problems p
  JOIN public.sessions s ON s.id = p.session_id
  WHERE p.id = labels.problem_id AND s.user_id = (SELECT auth.uid())
));

-- 6) 보조 인덱스
CREATE INDEX IF NOT EXISTS idx_profiles_role ON public.profiles(role) WHERE role IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_labels_classification_depth1 ON public.labels((classification->>'depth1')) WHERE classification IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_labels_classification_depth2 ON public.labels((classification->>'depth2')) WHERE classification IS NOT NULL;
