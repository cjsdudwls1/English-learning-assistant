import { GoogleGenAI } from '@google/genai';
import type { TypeStatsRow } from './stats';

const API_KEY = import.meta.env.VITE_GEMINI_API_KEY || import.meta.env.VITE_API_KEY;
if (!API_KEY) {
  throw new Error('VITE_GEMINI_API_KEY environment variable is not set');
}
const ai = new GoogleGenAI({ apiKey: API_KEY });

export async function makeCoachingMessage(stats: TypeStatsRow[]): Promise<string> {
  const summary = stats.slice(0, 30); // 프롬프트 길이 제어
  const text = `당신은 영어 선생님입니다. 아래 학습자의 유형별 정오답 통계를 보고, 격려와 함께 다음 학습 우선순위 3가지를 제시하세요. 한국어 3~5문장.
  통계 JSON: ${JSON.stringify(summary)}`;
  const response = await ai.models.generateContent({ model: 'gemini-2.5-flash', contents: { parts: [{ text }] } });
  return response.text.trim();
}

export async function generateProblemAnalysisReport(problems: any[]): Promise<string> {
  const problemData = problems.map(p => ({
    stem: p.problem.stem,
    classification: p.problem.labels?.[0]?.classification || {},
    isCorrect: p.is_correct,
    userAnswer: p.problem.labels?.[0]?.user_answer || ''
  }));

  const text = `당신은 영어 교육 전문가입니다. 다음은 사용자가 틀린 영어 문제들입니다:

${problemData.map((p, i) => `
문제 ${i + 1}:
- 내용: ${p.stem}
- 분류: ${JSON.stringify(p.classification)}
- 정답 여부: ${p.isCorrect ? '정답' : '오답'}
- 사용자 답안: ${p.userAnswer}
`).join('\n')}

이 문제들을 분석하여 다음 내용을 포함한 학습 리포트를 작성해주세요:

1. **공통 오류 패턴**: 이 문제들에서 나타나는 공통적인 실수 패턴
2. **취약한 영역**: 사용자가 특히 약한 문법/어휘 영역
3. **학습 권장사항**: 구체적인 개선 방안과 학습 방법

한국어로 작성해주세요.`;

  const response = await ai.models.generateContent({ 
    model: 'gemini-2.5-flash', 
    contents: { parts: [{ text }] } 
  });
  return response.text.trim();
}


