-- 문제은행 테이블 생성
CREATE TABLE IF NOT EXISTS generated_problems (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  stem TEXT NOT NULL,
  choices JSONB NOT NULL, -- [{"text": "선택지", "is_correct": boolean}, ...]
  correct_answer_index INTEGER NOT NULL, -- 정답 인덱스 (0-based)
  explanation TEXT, -- 정답 해설
  wrong_explanation JSONB, -- 오답 해설 {"0": "해설", "1": "해설", ...}
  classification JSONB NOT NULL, -- {"depth1": "...", "depth2": "...", ...}
  source_classification JSONB, -- 원본 문제의 분류 (어떤 분류에서 생성했는지)
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 인덱스 추가
CREATE INDEX IF NOT EXISTS idx_generated_problems_user_id ON generated_problems(user_id);
CREATE INDEX IF NOT EXISTS idx_generated_problems_classification ON generated_problems USING GIN(classification);
CREATE INDEX IF NOT EXISTS idx_generated_problems_created_at ON generated_problems(created_at DESC);

-- RLS 정책 설정
ALTER TABLE generated_problems ENABLE ROW LEVEL SECURITY;

-- 사용자는 자신의 문제만 조회 가능
CREATE POLICY "Users can view their own generated problems"
  ON generated_problems
  FOR SELECT
  USING (auth.uid() = user_id);

-- 사용자는 자신의 문제만 삽입 가능
CREATE POLICY "Users can insert their own generated problems"
  ON generated_problems
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- 사용자는 자신의 문제만 수정 가능
CREATE POLICY "Users can update their own generated problems"
  ON generated_problems
  FOR UPDATE
  USING (auth.uid() = user_id);

-- 사용자는 자신의 문제만 삭제 가능
CREATE POLICY "Users can delete their own generated problems"
  ON generated_problems
  FOR DELETE
  USING (auth.uid() = user_id);

-- updated_at 자동 업데이트 트리거 함수
CREATE OR REPLACE FUNCTION update_generated_problems_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 트리거 생성
CREATE TRIGGER update_generated_problems_timestamp
  BEFORE UPDATE ON generated_problems
  FOR EACH ROW
  EXECUTE FUNCTION update_generated_problems_updated_at();
;
