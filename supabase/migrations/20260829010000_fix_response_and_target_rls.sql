-- =============================================================
-- RLS 권한 누수 수정 (1) — 기능 영향 없는 보안 수정
--
-- 이 파일은 **현재 프론트가 하는 동작을 하나도 막지 않는다.** 근거는 각 절 주석에 적었다.
-- 재적용 가능하다: 모든 CREATE POLICY 앞에 DROP POLICY IF EXISTS, 함수는 CREATE OR REPLACE,
-- 트리거는 DROP TRIGGER IF EXISTS 선행.
--
-- 적용 순서: 20260829000000_restrict_assignment_response_select.sql 과 순서 의존이 없다.
--   그 파일이 만드는 can_review_assignment_responses 를 이 파일이 **다시 선언**하기 때문에
--   둘 중 어느 것을 먼저 적용해도, 혹은 이 파일만 적용해도 동작한다.
-- =============================================================


-- =====================================================================
-- 0) can_review_assignment_responses 재선언
--
-- 20260829000000 의 정의와 **의미가 같다**. 단 하나 바뀐 것은 학부모 분기를
-- parent_children 직접 조인 대신 is_parent_of() 경유로 바꾼 것뿐이다.
--   기존: JOIN parent_children pc ON pc.child_id = at2.student_id WHERE ... pc.parent_id = uid
--   지금: WHERE ... is_parent_of(uid, at2.student_id)
-- 두 식은 논리적으로 동일하다(is_parent_of = 그 EXISTS 한 줄, 20260328000000:117-122).
--
-- 왜 바꾸나: 학부모-자녀 연결에 승인 상태(status)를 붙이는 후속 마이그레이션
-- (20260829020000)이 is_parent_of 하나만 갈아끼우면 되도록 하기 위해서다.
-- 인라인 조인을 남겨두면 이 파일을 재적용할 때마다 status 검사가 사라진다.
-- =====================================================================
CREATE OR REPLACE FUNCTION can_review_assignment_responses(uid UUID, aid UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (SELECT 1 FROM shared_assignments WHERE id = aid AND created_by = uid)
  OR get_user_role(uid) = 'director'
  OR EXISTS (
    SELECT 1 FROM assignment_targets at2
    WHERE at2.assignment_id = aid AND is_parent_of(uid, at2.student_id)
  )
  OR EXISTS (
    SELECT 1 FROM shared_assignments sa
    WHERE sa.id = aid AND sa.class_id IS NOT NULL
      AND is_class_admin(uid, sa.class_id)
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;


-- =====================================================================
-- 1) assignment_responses UPDATE — WITH CHECK 누락 + 학생의 채점 조작
--
-- before (20260328000000:205-206):
--   CREATE POLICY "ar_update" ON assignment_responses FOR UPDATE
--     USING (student_id = auth.uid());
--
-- PostgreSQL 은 WITH CHECK 이 없으면 USING 을 갱신 후 행 검사에도 재사용한다.
-- 그래서 "내 행이면 무엇이든 쓸 수 있다"가 되어, 학생이 is_correct 를 true 로,
-- answer 를 정답으로 바꿔 저장할 수 있었다. 교사 화면(teacherStats)·학부모 요약
-- (fetchChildAssignments)·원장 개요(academies.fetchResponseStatsByStudent)가
-- 전부 이 값을 그대로 집계하므로 정답률이 조작된 값으로 보인다.
--
-- WITH CHECK 을 붙이는 것만으로는 부족하다. RLS 는 "이 컬럼만 바꿀 수 있다"를 표현하지
-- 못한다(정책은 행 단위 술어일 뿐이다). 그래서 BEFORE UPDATE 트리거로 채점 컬럼을
-- 되돌린다.
-- =====================================================================
DROP POLICY IF EXISTS "ar_update" ON assignment_responses;
CREATE POLICY "ar_update" ON assignment_responses FOR UPDATE
  USING (student_id = auth.uid())
  WITH CHECK (student_id = auth.uid());

-- 학생 경로에서 채점 컬럼을 되돌리는 트리거.
--
-- assignment_responses 의 실제 컬럼(20260328000000:83-93, 이후 ALTER 없음):
--   id, assignment_id, problem_id, student_id, answer, is_correct,
--   time_spent_seconds, submitted_at
-- 교사 채점용 별도 컬럼(graded_by 등)은 존재하지 않는다. 채점 값은 is_correct 하나뿐이므로
-- 되돌릴 대상도 그 하나다. answer / submitted_at / time_spent_seconds 는 학생이 바꿀 수 있다.
--
-- 통과시키는 경로:
--  (a) auth.uid() IS NULL — service_role, SQL 에디터, 마이그레이션. PostgREST 익명 요청도
--      여기 걸리지만 익명은 ar_update 의 student_id = auth.uid() 를 애초에 통과하지 못한다.
--  (b) 과제 작성자 — 20260708000000:49-64 "Assignment creators can grade responses" 의
--      정책 조건과 **같은 술어**를 쓴다. 즉 그 정책이 허용하는 UPDATE 는 트리거도 허용한다.
--      단 NEW 가 아니라 OLD.assignment_id 로 검사한다. NEW 로 검사하면 학생이 자기가 만든
--      과제로 assignment_id 를 옮겨 채점 권한을 얻는 우회가 생긴다.
CREATE OR REPLACE FUNCTION public.guard_assignment_response_student_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1 FROM shared_assignments sa
    WHERE sa.id = OLD.assignment_id
      AND sa.created_by = auth.uid()
  ) THEN
    RETURN NEW;
  END IF;

  -- 여기 오면 학생 본인(ar_update)이다. 채점 결과와 행의 정체성은 고정.
  NEW.is_correct    := OLD.is_correct;
  NEW.assignment_id := OLD.assignment_id;
  NEW.problem_id    := OLD.problem_id;
  NEW.student_id    := OLD.student_id;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_ar_guard_student_update ON assignment_responses;
CREATE TRIGGER trg_ar_guard_student_update
  BEFORE UPDATE ON assignment_responses
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_assignment_response_student_update();

-- 왜 이것이 기능 영향이 없나:
--   submitAssignmentResponse(src/services/db/assignments.ts:132-143)는 upsert 이지만
--   AssignmentSolvePage 는 **이미 답한 문제에 답안 폼을 그리지 않는다**
--   (src/pages/AssignmentSolvePage.tsx:150 — isAnswered(...) 면 AssignmentReviewItem 렌더).
--   즉 학생의 정상 경로는 항상 INSERT 이고 ON CONFLICT UPDATE 로 내려가지 않는다.
--   INSERT 시의 is_correct 자동 채점(checkAnswer)은 그대로 저장된다.
--   교사 채점(gradeAssignmentResponse, assignments.ts:199-205)은 위 (b)로 통과한다.
--
-- 남는 것: 언젠가 "다시 풀기"를 도입하면 재제출분의 is_correct 가 첫 시도 값으로 고정된다.
--   그때는 재채점을 서버(Edge Function, service_role)나 교사 승인으로 옮겨야 한다.


-- =====================================================================
-- 2) assignment_targets SELECT — 반 전체 명단 노출
--
-- before (20260328000000:190-193):
--   CREATE POLICY "at_select" ON assignment_targets FOR SELECT USING (
--     student_id = auth.uid()
--     OR can_view_assignment(auth.uid(), assignment_id)
--   );
--
-- can_view_assignment 에는 "이 과제를 배정받은 학생 본인" 분기가 있다
-- (20260329000000:7). 그런데 첫 조건 student_id = auth.uid() 가 이미 본인 행을 열어주므로,
-- 그 분기가 assignment_targets 에서 하는 일은 **같은 과제를 받은 다른 학생의 student_id 를
-- 노출하는 것뿐**이다. profiles SELECT 가 USING (true)(20260330000000:14-17)라서
-- 그 uuid 들은 곧바로 이름·이메일로 이어진다.
--
-- can_review_assignment_responses 는 그 분기 하나만 뺀 함수다(20260829000000:18-34).
-- =====================================================================
DROP POLICY IF EXISTS "at_select" ON assignment_targets;
CREATE POLICY "at_select" ON assignment_targets FOR SELECT USING (
  student_id = auth.uid()
  OR can_review_assignment_responses(auth.uid(), assignment_id)
);

-- 회귀 확인 — assignment_targets 를 읽는 프론트 경로는 세 곳뿐이다:
--   (1) assignments.ts:78-80  fetchAssignedToMe
--         .eq('student_id', userId) — 학생 본인. 첫 조건 student_id = auth.uid() 가 통과시킨다.
--         can_view_assignment 분기가 없어도 자기 과제 목록은 그대로 나온다.
--   (2) assignments.ts:217-219 fetchChildAssignments(childId)
--         학부모가 자녀의 대상 행을 읽는다. can_review_assignment_responses 의 학부모 분기
--         (is_parent_of)가 그대로 통과시킨다.
--   (3) assignments.ts:42     createAssignment 의 INSERT — SELECT 정책과 무관.
-- 교사(과제 작성자·반 관리자)와 원장 분기도 can_review_assignment_responses 에 그대로 있다.
-- 즉 잃는 것은 "학생이 같은 과제를 받은 다른 학생의 행을 읽는 것"뿐이고,
-- 그것을 쓰는 프론트 코드는 없다.


-- =====================================================================
-- 3) 마감일(due_date) 서버측 강제 — **적용하지 않음**
--
-- shared_assignments.due_date 는 존재한다(20260328000000:53). 다만 TIMESTAMPTZ **nullable**
-- 이고(마감 없는 과제가 정상 케이스다) 지시에 따라 이 파일에서는 강제하지 않는다.
-- 현재 마감 차단은 프론트에만 있다(AssignmentSolvePage.tsx:61 overdue → 제출 버튼 disabled).
-- 서버에서도 막으려면 아래 두 정책을 살리면 된다. NULL 은 "마감 없음"으로 통과시킨다.
-- 켜는 순간 기능 변화다: 마감이 지난 과제의 제출이 API 수준에서 거절된다.
--
-- DROP POLICY IF EXISTS "ar_insert" ON assignment_responses;
-- CREATE POLICY "ar_insert" ON assignment_responses FOR INSERT WITH CHECK (
--   student_id = auth.uid()
--   AND EXISTS (
--     SELECT 1 FROM shared_assignments sa
--     WHERE sa.id = assignment_responses.assignment_id
--       AND (sa.due_date IS NULL OR now() <= sa.due_date)
--   )
-- );
-- DROP POLICY IF EXISTS "ar_update" ON assignment_responses;
-- CREATE POLICY "ar_update" ON assignment_responses FOR UPDATE
--   USING (student_id = auth.uid())
--   WITH CHECK (
--     student_id = auth.uid()
--     AND EXISTS (
--       SELECT 1 FROM shared_assignments sa
--       WHERE sa.id = assignment_responses.assignment_id
--         AND (sa.due_date IS NULL OR now() <= sa.due_date)
--     )
--   );
-- =====================================================================
