
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

export interface VisualContext {
  type?: string | null;
  title?: string | null;
  content?: string | null;
}

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
  // 상세 표시용 분리 필드 (검수 카드 풍부 표시)
  passage?: string | null;
  instruction?: string | null;
  question_body?: string | null;
  visual_context?: VisualContext | null;
  // 다중정답 객관식 지원 (multi_answer_contract v1) — 미설정(레거시)이면 단일답 경로로 취급
  // multi_blank = 한 문항 안 여러 번호빈칸(1)(2)(3) 서술형. 채점은 항상 기권(빈칸별 자유서술).
  answerFormat?: 'single' | 'multi' | 'multi_blank' | 'unknown';
  correctAnswers?: number[];
  userAnswers?: number[];
  // 다중빈칸 서술형(multi_blank) 전용 — 빈칸별 자유텍스트 배열(빈 빈칸은 null). MC 번호배열과 타입 분리.
  blankUserAnswers?: (string | null)[];
  blankCorrectAnswers?: (string | null)[];
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
  passage?: string | null;
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
  academy_id?: string | null;
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
  name?: string | null;
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
  // 채점 상세(학생 1명 기준) — fetchChildAssignments 등에서 채움. null 채점은 ungraded로 분리
  correct_count?: number;
  incorrect_count?: number;
  ungraded_count?: number;
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
  // 표시용 — fetchAssignmentResponses에서 profiles 병합(조회 실패 시 미설정)
  student_name?: string | null;
  student_email?: string | null;
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

export interface ParentSummary {
  user_id: string;
  email: string;
}

export interface StudentDetail {
  user_id: string;
  email: string;
  grade: string | null;
  class_ids: string[];
  parents: ParentSummary[];
  total_count: number;
  /** 채점 완료(is_correct boolean) 응답 수 — correct_rate의 분모 */
  graded_count: number;
  correct_count: number;
  correct_rate: number;
}

export interface TeacherDetail {
  user_id: string;
  email: string;
  classes: Array<{ id: string; name: string; student_count: number }>;
  student_ids: string[];
  total_count: number;
  /** 채점 완료(is_correct boolean) 응답 수 — correct_rate의 분모 */
  graded_count: number;
  correct_count: number;
  correct_rate: number;
}

export interface AcademyHierarchy {
  academy_id: string;
  teachers: TeacherDetail[];
  students: StudentDetail[];
  unassigned_students: StudentDetail[];
}