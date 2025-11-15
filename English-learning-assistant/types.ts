
export interface TextWithConfidence {
  text: string;
  confidence_score: number;
}

export interface UserAnswer extends TextWithConfidence {
  auto_corrected: boolean;
  alternate_interpretations: string[];
}

export interface ProblemClassification {
  '1Depth': string;
  '2Depth': string;
  '3Depth': string;
  '4Depth': string;
  'code'?: string | null;  // taxonomy 조회용 (필수, NULL 가능)
  'CEFR'?: string | null;  // taxonomy에서 가져옴
  '난이도'?: number | null;  // taxonomy에서 가져옴
  '분류_신뢰도': '높음' | '보통' | '낮음' | string;
}

export interface Taxonomy {
  code: string;
  depth1_en: string;
  depth2_en: string;
  depth3_en: string;
  depth4_en: string;
  label_en: string;
  depth1: string;
  depth2: string;
  depth3: string;
  depth4: string;
  cefr: string | null;
  difficulty: number | null;
  tags: string[] | null;
  vocabulary_level: string | null;
  age_correspondence: string | null;
  cefr_lex: string | null;
  academic_vocab_index: string | null;
  frequency_index: string | null;
  ngsl_rank: string | null;
  definition_ko: string | null;
  error_signals_ko: string | null;
  example_wrong: string | null;
  example_correct: string | null;
  related_rules: string | null;
  definition_en: string | null;
  core_rule_en: string | null;
  core_rule_ko: string | null;
  error_signals_en: string | null;
  llm_hints: string | null;
  created_at: string;
  updated_at: string;
}

export interface AnalysisResult {
  사용자가_직접_채점한_정오답: 'O' | 'X' | '△' | '✓' | string;
  문제내용: TextWithConfidence;
  문제_보기: TextWithConfidence[];
  사용자가_기술한_정답: UserAnswer;
  문제_유형_분류: ProblemClassification;
  분류_근거: string;
}

// 멀티 문항 결과 타입 (신규)
export interface ProblemItem {
  index: number;
  사용자가_직접_채점한_정오답: 'O' | 'X' | '△' | '✓' | string;
  AI가_판단한_정오답?: '정답' | '오답' | string;
  문제내용: TextWithConfidence;
  문제_보기: TextWithConfidence[];
  사용자가_기술한_정답: UserAnswer;
  문제_유형_분류: ProblemClassification;
  분류_근거: string;
}

export interface AnalysisResults {
  items: ProblemItem[];
}

export interface SessionWithProblems {
  id: string;
  created_at: string;
  image_url: string;
  problem_count: number;
  correct_count: number;
  incorrect_count: number;
  status?: string;
}