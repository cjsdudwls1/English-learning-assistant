-- AI 기능별 토큰 사용량 로그 테이블
-- 각 AI 호출(이미지 분석, 예시 문장 생성, 문제 생성 등)별 비용 추적

CREATE TABLE IF NOT EXISTS ai_usage_logs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    function_name text NOT NULL, -- 'analyze-image', 'generate-example', 'generate-similar-problems', 'generate-report', 'reclassify-problems'
    model_used text NOT NULL, -- 예: 'gemini-2.5-flash', 'gemini-2.5-pro'
    prompt_token_count integer DEFAULT 0, -- 입력 토큰 (이미지 포함)
    candidates_token_count integer DEFAULT 0, -- 출력 토큰
    total_token_count integer DEFAULT 0, -- 총 토큰
    session_id uuid REFERENCES sessions(id) ON DELETE SET NULL, -- 연관 세션 (있는 경우)
    metadata jsonb DEFAULT '{}', -- 추가 정보 (이미지 수, 문제 수 등)
    created_at timestamptz DEFAULT now()
);

-- 인덱스: 기능별 조회
CREATE INDEX IF NOT EXISTS idx_ai_usage_logs_function ON ai_usage_logs (function_name, created_at DESC);

-- 인덱스: 사용자별 조회
CREATE INDEX IF NOT EXISTS idx_ai_usage_logs_user ON ai_usage_logs (user_id, created_at DESC);

-- 인덱스: 날짜 범위 조회
CREATE INDEX IF NOT EXISTS idx_ai_usage_logs_created ON ai_usage_logs (created_at DESC);

-- RLS 정책
ALTER TABLE ai_usage_logs ENABLE ROW LEVEL SECURITY;

-- 사용자는 자신의 로그만 조회 가능
CREATE POLICY "Users can view own ai_usage_logs"
    ON ai_usage_logs FOR SELECT
    USING (auth.uid() = user_id);

-- 서비스 역할은 삽입 가능 (Edge Functions에서 사용)
CREATE POLICY "Service role can insert ai_usage_logs"
    ON ai_usage_logs FOR INSERT
    WITH CHECK (true);

-- 코멘트
COMMENT ON TABLE ai_usage_logs IS 'AI 기능별 토큰 사용량 로그';
COMMENT ON COLUMN ai_usage_logs.function_name IS 'AI 기능 이름 (analyze-image, generate-example, generate-similar-problems 등)';
COMMENT ON COLUMN ai_usage_logs.prompt_token_count IS '입력 토큰 수 (이미지+프롬프트)';
COMMENT ON COLUMN ai_usage_logs.candidates_token_count IS '출력 토큰 수';
