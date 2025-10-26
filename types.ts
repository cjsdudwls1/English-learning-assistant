
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
  '분류_신뢰도': '높음' | '보통' | '낮음' | string;
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
}