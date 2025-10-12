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


