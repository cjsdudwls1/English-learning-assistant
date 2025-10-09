
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
