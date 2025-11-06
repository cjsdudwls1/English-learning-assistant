-- 문제 풀이 시간 추적을 위한 테이블 생성
CREATE TABLE IF NOT EXISTS problem_solving_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  problem_id UUID NOT NULL REFERENCES generated_problems(id) ON DELETE CASCADE,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  time_spent_seconds INTEGER,
  is_correct BOOLEAN,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, problem_id)
);

-- 인덱스 생성
CREATE INDEX IF NOT EXISTS idx_problem_solving_sessions_user_id ON problem_solving_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_problem_solving_sessions_problem_id ON problem_solving_sessions(problem_id);
CREATE INDEX IF NOT EXISTS idx_problem_solving_sessions_created_at ON problem_solving_sessions(created_at);

-- RLS (Row Level Security) 정책 설정
ALTER TABLE problem_solving_sessions ENABLE ROW LEVEL SECURITY;

-- 사용자는 자신의 데이터만 조회/수정/삭제 가능
CREATE POLICY "Users can view their own problem solving sessions"
  ON problem_solving_sessions
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own problem solving sessions"
  ON problem_solving_sessions
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own problem solving sessions"
  ON problem_solving_sessions
  FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own problem solving sessions"
  ON problem_solving_sessions
  FOR DELETE
  USING (auth.uid() = user_id);

