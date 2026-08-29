-- 분류 Taxonomy 테이블 생성
CREATE TABLE IF NOT EXISTS taxonomy (
  code TEXT PRIMARY KEY,  -- TNS.ASP.PRS.PROG
  -- 영어 분류
  depth1_en TEXT,
  depth2_en TEXT,
  depth3_en TEXT,
  depth4_en TEXT,
  label_en TEXT,  -- 영어 라벨명 (예: "Present — Present Progressive")
  -- 한국어 분류
  depth1 TEXT,
  depth2 TEXT,
  depth3 TEXT,
  depth4 TEXT,
  -- 메타데이터 (edge_function_taxonomy_en_v3.csv)
  cefr TEXT,  -- A1, A2, B1, B2, C1
  difficulty INTEGER,  -- 1-5
  tags TEXT[],  -- 태그 배열 (예: ["시제", "진행"])
  vocabulary_level TEXT,  -- 어휘난이도(빈도밴드)
  age_correspondence TEXT,  -- 연령대응(세/학령)
  cefr_lex TEXT,  -- CEFR-LEX
  academic_vocab_index TEXT,  -- 학술어휘지표
  frequency_index TEXT,  -- 빈도지표(Zipf, 0-7)
  ngsl_rank TEXT,  -- NGSL순위
  -- 상세 정보 (edge_function_taxonomy_en_v3.csv)
  definition_ko TEXT,  -- 정의 (한국어)
  error_signals_ko TEXT,  -- 오류신호 (한국어)
  example_wrong TEXT,  -- 예시(오류)
  example_correct TEXT,  -- 예시(정답)
  related_rules TEXT,  -- 관련규칙
  -- 상세 정보 (Sheet1.csv)
  definition_en TEXT,  -- Definition (영어)
  core_rule_en TEXT,  -- Core Rule (영어)
  core_rule_ko TEXT,  -- 핵심규칙 (한국어)
  error_signals_en TEXT,  -- Error Signals (영어)
  llm_hints TEXT,  -- LLM 힌트 (검증용, UI 표시 안 함)
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 인덱스 (빠른 조회)
CREATE INDEX IF NOT EXISTS idx_taxonomy_depth1 ON taxonomy(depth1);
CREATE INDEX IF NOT EXISTS idx_taxonomy_depth2 ON taxonomy(depth2);
CREATE INDEX IF NOT EXISTS idx_taxonomy_depth3 ON taxonomy(depth3);
CREATE INDEX IF NOT EXISTS idx_taxonomy_depth4 ON taxonomy(depth4);
CREATE INDEX IF NOT EXISTS idx_taxonomy_code ON taxonomy(code);

-- RLS 정책 (읽기 전용, 모든 사용자 접근 가능)
ALTER TABLE taxonomy ENABLE ROW LEVEL SECURITY;

CREATE POLICY "taxonomy_select_policy" ON taxonomy
  FOR SELECT
  USING (true);;
