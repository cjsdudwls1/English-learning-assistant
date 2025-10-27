// SECURITY FIX: Gemini API 호출을 Edge Function으로 이동
// import { GoogleGenAI } from '@google/genai';
import type { TypeStatsRow } from './stats';

// const API_KEY = import.meta.env.VITE_GEMINI_API_KEY || import.meta.env.VITE_API_KEY;
// if (!API_KEY) {
//   throw new Error('VITE_GEMINI_API_KEY environment variable is not set');
// }
// const ai = new GoogleGenAI({ apiKey: API_KEY });

// SECURITY FIX: 이 함수들은 이제 Edge Function에서 처리됩니다
export async function makeCoachingMessage(stats: TypeStatsRow[]): Promise<string> {
  // Edge Function으로 이동됨 - generate-coaching Edge Function 사용
  throw new Error('이 함수는 Edge Function으로 이동되었습니다. generate-coaching Edge Function을 사용하세요.');
}

export async function generateProblemAnalysisReport(problems: any[]): Promise<string> {
  // Edge Function으로 이동됨 - generate-report Edge Function 사용
  throw new Error('이 함수는 Edge Function으로 이동되었습니다. generate-report Edge Function을 사용하세요.');
}


