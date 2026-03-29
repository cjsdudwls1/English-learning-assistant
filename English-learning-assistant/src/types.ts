
export interface Text {
  text: string;
}

export interface UserAnswer extends Text {
  auto_corrected: boolean;
  alternate_interpretations: string[];
}

export interface ProblemClassification {
  depth1?: string | null;
  depth2?: string | null;
  depth3?: string | null;
  depth4?: string | null;
  code?: string | null; // taxonomy 조회용 (필수, NULL 가능)
  CEFR?: string | null; // taxonomy에서 가져옴
  난이도?: number | null; // taxonomy에서 가져옴
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
  문제내용: Text;
  문제_보기: Text[];
  사용자가_기술한_정답: UserAnswer;
  문제_유형_분류: ProblemClassification;
  분류_근거: string;
}

// 멀티 문항 결과 타입 (신규)
export type QuestionType = 'multiple_choice' | 'short_answer' | 'essay' | 'ox' | 'unknown';

export interface ProblemItem {
  id?: string;
  index: number;
  사용자가_직접_채점한_정오답: 'O' | 'X' | '△' | '✓' | string;
  AI가_판단한_정오답?: '정답' | '오답' | string;
  문제내용: Text;
  문제_보기: Text[];
  사용자가_기술한_정답: UserAnswer;
  correct_answer?: string | null;
  question_type?: QuestionType;
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
  image_urls?: string[];
  problem_count: number;
  correct_count: number;
  incorrect_count: number;
  status?: string;
  analysis_model?: string | null;
  models_used?: { ocr?: string; analysis?: string } | null;
  // 실패 관찰 가능성(Observability)
  failure_stage?: string | null;
  failure_message?: string | null;
}

// 생성된 문제 타입 (generated_problems 테이블)
export interface GeneratedProblem {
  id: string;
  stem: string;
  choices: Array<{ text: string; is_correct?: boolean }>;
  correct_answer_index: number | null;
  problem_type: 'multiple_choice' | 'short_answer' | 'essay' | 'ox';
  classification: ProblemClassification | Record<string, any>;
  correct_answer?: string | null;
  guidelines?: string | null;
  is_correct?: boolean | null;
  explanation?: string | null;
  is_editable?: boolean;
  created_at: string;
}

// Realtime 구독 타입 (Supabase Realtime Channel)
// Supabase의 RealtimeChannel 타입을 직접 참조하기 어려우므로 any로 유지 (기능 우선)
export type RealtimeSubscription = any;

// 문제 생성 상태 타입
export interface ProblemGenerationState {
  isGenerating: boolean;
  generatedProblems: GeneratedProblem[];
  error: string | null;
  expectedProblemCounts: { [key: string]: number };
  receivedProblems: GeneratedProblem[];
}

// =====================
// 역할 기반 학급 관리 시스템 타입
// =====================

export type UserRole = 'student' | 'teacher' | 'parent' | 'director';

export interface ClassInfo {
  id: string;
  name: string;
  description: string | null;
  created_by: string;
  created_at: string;
  member_count?: number;
  student_count?: number;
}

export interface ClassMember {
  id: string;
  class_id: string;
  user_id: string;
  role: 'teacher' | 'student';
  joined_at: string;
  email?: string;
}

export interface SharedAssignment {
  id: string;
  title: string;
  description: string | null;
  created_by: string;
  class_id: string | null;
  due_date: string | null;
  created_at: string;
  problem_count?: number;
  completed_count?: number;
}

export interface AssignmentProblem {
  id: string;
  assignment_id: string;
  problem_id: string;
  order_index: number;
  problem?: GeneratedProblem;
}

export interface AssignmentResponse {
  id: string;
  assignment_id: string;
  problem_id: string;
  student_id: string;
  answer: string | null;
  is_correct: boolean | null;
  time_spent_seconds: number | null;
  submitted_at: string;
}

export interface MonthlyStats {
  month: number;
  total_count: number;
  correct_count: number;
  incorrect_count: number;
  avg_time_seconds: number;
}

export interface DailyStats {
  date: string;
  total_count: number;
  correct_count: number;
  incorrect_count: number;
  avg_time_seconds: number;
}

export interface CreateAssignmentParams {
  title: string;
  description: string | null;
  classId: string | null;
  problemIds: string[];
  studentIds: string[];
  dueDate?: string | null;
}