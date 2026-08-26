-- 에이전트 실행 기록(agent_runs) + 스텝 추적(agent_steps)
--
-- 두 가지 목적:
--   (a) 프론트가 Realtime으로 "에이전트 사고 과정"을 실시간 표시 (agent_steps INSERT 구독)
--   (b) 비용·행동 감사 — 몇 번 호출했고 어떤 도구를 왜 썼는지가 남아야 한다
--
-- 권한 설계 주의:
--   에이전트 도구는 **호출자 JWT를 단 Supabase 클라이언트**로 실행된다. 즉 "이 학생 데이터를
--   볼 수 있는가"는 여기가 아니라 sessions/labels/problems 각 테이블의 기존 RLS가 판정한다.
--   이 파일의 정책은 "실행 기록 자체를 누가 볼 수 있는가"만 정한다.
--
--   INSERT/UPDATE 정책은 일부러 두지 않는다. 기록은 서버(GCF)가 service-role로만 쓰고,
--   클라이언트는 읽기만 하면 된다 — 최소권한. 클라이언트가 스텝을 위조할 경로를 열지 않는다.
--
-- RLS 4종 패턴은 20260708000000_add_retry_attempts_and_teacher_grading.sql과 동일하다.

CREATE TABLE IF NOT EXISTS agent_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  agent_type TEXT NOT NULL,                    -- consultant | planner | briefing | inspector
  status TEXT NOT NULL DEFAULT 'running',
  -- 왜 멈췄는가. final 외의 값은 전부 "답은 냈지만 정상 종료는 아니다"라는 뜻이라
  -- UI가 경고를 띄우고 운영이 maxSteps/예산을 조정할 근거가 된다.
  stop_reason TEXT,                            -- final | max_steps | budget | tool_errors | loop_detected
  input JSONB,
  result JSONB,
  error TEXT,
  total_tokens INTEGER NOT NULL DEFAULT 0,
  model_calls INTEGER NOT NULL DEFAULT 0,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  CONSTRAINT agent_runs_status_check CHECK (status IN ('running', 'completed', 'failed'))
);

CREATE TABLE IF NOT EXISTS agent_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  thought TEXT,
  tool TEXT,
  args JSONB,
  observation JSONB,
  ok BOOLEAN NOT NULL DEFAULT true,            -- false = 도구 실패(관측으로 되돌려 모델이 자기수정)
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT agent_steps_run_seq_unique UNIQUE (run_id, seq)
);

CREATE INDEX IF NOT EXISTS idx_agent_runs_user
  ON agent_runs(user_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_steps_run_seq
  ON agent_steps(run_id, seq);

ALTER TABLE agent_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_steps ENABLE ROW LEVEL SECURITY;

-- ── agent_runs SELECT ───────────────────────────────────────
CREATE POLICY "Users can view own agent runs"
  ON agent_runs FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Parents can view children agent runs"
  ON agent_runs FOR SELECT
  USING (is_parent_of(auth.uid(), user_id));

CREATE POLICY "Teachers can view class students agent runs"
  ON agent_runs FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM class_members cm
      WHERE cm.user_id = agent_runs.user_id
        AND cm.role = 'student'
        AND is_class_admin(auth.uid(), cm.class_id)
    )
  );

CREATE POLICY "Directors can view all agent runs"
  ON agent_runs FOR SELECT
  USING (get_user_role(auth.uid()) = 'director');

-- ── agent_steps SELECT ──────────────────────────────────────
-- 스텝은 항상 부모 run의 가시성을 따른다 — 정책을 4벌 복제하지 않고 EXISTS로 위임한다.
-- (agent_runs의 RLS가 이 서브쿼리에도 적용되므로 run이 안 보이면 스텝도 안 보인다)
CREATE POLICY "Agent steps follow run visibility"
  ON agent_steps FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM agent_runs r WHERE r.id = agent_steps.run_id)
  );

-- ── Realtime 발행 ───────────────────────────────────────────
-- 프론트 useAgentRun이 agent_steps INSERT를 구독한다(useProblemGeneration의 generated_problems와 동일 패턴).
-- 이미 발행 중이면 42710이 나므로 삼킨다.
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE agent_steps;
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN undefined_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE agent_runs;
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN undefined_object THEN NULL;
END $$;

-- ── 컨설팅 보고서 ↔ 실행 기록 연결 ──────────────────────────
-- consulting_reports는 마이그레이션 밖(대시보드)에서 생성된 테이블이라 IF EXISTS로 방어한다.
ALTER TABLE IF EXISTS public.consulting_reports
  ADD COLUMN IF NOT EXISTS agent_run_id UUID REFERENCES agent_runs(id) ON DELETE SET NULL;
