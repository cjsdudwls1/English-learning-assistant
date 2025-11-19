// @ts-nocheck
import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { GoogleGenAI } from "https://esm.sh/@google/genai@1.21.0"
import { parseApiError } from '../_shared/errorHandling.ts'

// EdgeRuntime 타입 정의 (Supabase Edge Functions에서 제공)
declare const EdgeRuntime: {
  waitUntil(promise: Promise<any>): void;
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS, PUT, DELETE',
  'Access-Control-Max-Age': '86400',
};

type ProblemType = 'multiple_choice' | 'short_answer' | 'essay' | 'ox';
type Language = 'ko' | 'en';

interface Classification {
  depth1: string;
  depth2?: string;
  depth3?: string;
  depth4?: string;
}

interface ProblemRequest {
  problemType: ProblemType;
  problemCount: number;
  classification?: Classification;
  userId: string;
  language: Language;
  difficulty?: string;
}

interface PromptTemplate {
  intro: (count: number, classification: string) => string;
  format: string;
  requirements: string[];
}

// 프롬프트 템플릿 정의
const promptTemplates: Record<ProblemType, Record<Language, PromptTemplate>> = {
  multiple_choice: {
    ko: {
      intro: (count, classification) => `다음 분류에 해당하는 영어 객관식 문제 ${count}개를 생성해주세요 (각 문제는 5지선다).\n\n분류: ${classification}`,
      format: `각 문제는 다음 형식의 JSON 배열로 반환해주세요:
[
  {
    "stem": "문제 본문 (영어로 작성)",
    "choices": [
      {"text": "선택지 1", "is_correct": false},
      {"text": "선택지 2", "is_correct": true},
      {"text": "선택지 3", "is_correct": false},
      {"text": "선택지 4", "is_correct": false},
      {"text": "선택지 5", "is_correct": false}
    ],
    "explanation": "정답 해설 (한국어로)",
    "wrong_explanations": {
      "0": "선택지 1이 오답인 이유",
      "1": "이 선택지는 정답입니다",
      "2": "선택지 3이 오답인 이유",
      "3": "선택지 4가 오답인 이유",
      "4": "선택지 5가 오답인 이유"
    }
  }
]`,
      requirements: [
        `모든 문제는 분류에 맞아야 합니다.`,
        `각 문제는 정확히 5개의 선택지를 가져야 합니다.`,
        `정답은 하나만 있어야 합니다.`,
        `JSON 형식만 반환하고 다른 설명은 추가하지 마세요.`
      ]
    },
    en: {
      intro: (count, classification) => `Generate ${count} English multiple-choice problems (5 choices each) for the following classification:\n\nClassification: ${classification}`,
      format: `Each problem should be returned as a JSON array in the following format:
[
  {
    "stem": "Problem text (in English)",
    "choices": [
      {"text": "Choice 1", "is_correct": false},
      {"text": "Choice 2", "is_correct": true},
      {"text": "Choice 3", "is_correct": false},
      {"text": "Choice 4", "is_correct": false},
      {"text": "Choice 5", "is_correct": false}
    ],
    "explanation": "Answer explanation (in English)",
    "wrong_explanations": {
      "0": "Why choice 1 is incorrect",
      "1": "This is the correct answer",
      "2": "Why choice 3 is incorrect",
      "3": "Why choice 4 is incorrect",
      "4": "Why choice 5 is incorrect"
    }
  }
]`,
      requirements: [
        `All problems must match the classification.`,
        `Each problem must have exactly 5 choices.`,
        `There must be only one correct answer.`,
        `Return only JSON format without any additional explanation.`
      ]
    }
  },
  short_answer: {
    ko: {
      intro: (count, classification) => `다음 분류에 해당하는 영어 단답형 문제 ${count}개를 생성해주세요.\n\n분류: ${classification}`,
      format: `각 문제는 다음 형식의 JSON 배열로 반환해주세요:
[
  {
    "stem": "문제 본문 (영어로 작성)",
    "correct_answer": "예상 정답 (1-3단어)",
    "explanation": "정답 해설 (한국어로)"
  }
]`,
      requirements: [
        `모든 문제는 분류에 맞아야 합니다.`,
        `정답은 1-3단어로 짧아야 합니다.`,
        `JSON 형식만 반환하고 다른 설명은 추가하지 마세요.`
      ]
    },
    en: {
      intro: (count, classification) => `Generate ${count} English short-answer problems for the following classification:\n\nClassification: ${classification}`,
      format: `Each problem should be returned as a JSON array in the following format:
[
  {
    "stem": "Problem text (in English)",
    "correct_answer": "Expected short answer (1-3 words)",
    "explanation": "Answer explanation (in English)"
  }
]`,
      requirements: [
        `All problems must match the classification.`,
        `Answers should be short (1-3 words).`,
        `Return only JSON format without any additional explanation.`
      ]
    }
  },
  essay: {
    ko: {
      intro: (count, classification) => `다음 분류에 해당하는 영어 서술형 문제 ${count}개를 생성해주세요.\n\n분류: ${classification}`,
      format: `각 문제는 다음 형식의 JSON 배열로 반환해주세요:
[
  {
    "stem": "서술형 문제 (영어로 작성)",
    "guidelines": "답변 가이드라인 (한국어로)",
    "explanation": "예시 답안 또는 해설 (한국어로)"
  }
]`,
      requirements: [
        `모든 문제는 분류에 맞아야 합니다.`,
        `문제는 사고를 요구하는 서술형 답변을 요구해야 합니다.`,
        `JSON 형식만 반환하고 다른 설명은 추가하지 마세요.`
      ]
    },
    en: {
      intro: (count, classification) => `Generate ${count} English essay questions for the following classification:\n\nClassification: ${classification}`,
      format: `Each problem should be returned as a JSON array in the following format:
[
  {
    "stem": "Essay question (in English)",
    "guidelines": "Guidelines for answering (in English)",
    "explanation": "Sample answer or explanation (in English)"
  }
]`,
      requirements: [
        `All problems must match the classification.`,
        `Questions should require thoughtful written responses.`,
        `Return only JSON format without any additional explanation.`
      ]
    }
  },
  ox: {
    ko: {
      intro: (count, classification) => `다음 분류에 해당하는 영어 O/X 문제 ${count}개를 생성해주세요.\n\n분류: ${classification}`,
      format: `각 문제는 다음 형식의 JSON 배열로 반환해주세요:
[
  {
    "stem": "진술문 (영어로 작성)",
    "is_correct": true,
    "explanation": "이것이 참 또는 거짓인 이유 설명 (한국어로)"
  }
]`,
      requirements: [
        `모든 문제는 분류에 맞아야 합니다.`,
        `is_correct는 true 또는 false여야 합니다.`,
        `JSON 형식만 반환하고 다른 설명은 추가하지 마세요.`
      ]
    },
    en: {
      intro: (count, classification) => `Generate ${count} English True/False (O/X) problems for the following classification:\n\nClassification: ${classification}`,
      format: `Each problem should be returned as a JSON array in the following format:
[
  {
    "stem": "Statement (in English)",
    "is_correct": true,
    "explanation": "Explanation why this is true or false (in English)"
  }
]`,
      requirements: [
        `All problems must match the classification.`,
        `is_correct should be true or false.`,
        `Return only JSON format without any additional explanation.`
      ]
    }
  }
};

// 분류 경로 생성 헬퍼 함수
function buildClassificationPath(classification: Classification | undefined): string {
  if (!classification) return 'General English';
  return [classification.depth1, classification.depth2, classification.depth3, classification.depth4]
    .filter(Boolean)
    .join(' > ');
}

// 프롬프트 빌드 함수
function buildPrompt(problemType: ProblemType, problemCount: number, classification: Classification | undefined, language: Language): string {
  const classificationPath = buildClassificationPath(classification);
  const template = promptTemplates[problemType][language];
  
  const requirementsText = language === 'ko' 
    ? '중요 사항:'
    : 'Important:';
  
  const requirementsList = template.requirements
    .map((req, idx) => `${idx + 1}. ${req}`)
    .join('\n');
  
  return `${template.intro(problemCount, classificationPath)}

${template.format}

${requirementsText}
${requirementsList}`;
}

// parseApiError는 _shared/errorHandling.ts에서 import

// AI 응답에서 문제 파싱
interface AIGeneratedProblem {
  stem: string;
  choices?: Array<{ text: string; is_correct: boolean }>;
  correct_answer?: string;
  is_correct?: boolean;
  explanation?: string;
  wrong_explanations?: Record<string, string>;
  guidelines?: string;
}

// 문제를 DB 형식으로 변환하는 함수
function transformProblemForDB(
  problem: AIGeneratedProblem,
  problemType: ProblemType,
  userId: string,
  classification: Classification | undefined,
  isTeacher: boolean
): any {
  const baseProblem = {
    user_id: userId,
    stem: problem.stem,
    explanation: problem.explanation || null,
    classification: classification || {},
    source_classification: classification || {},
    problem_type: problemType,
    is_editable: isTeacher,
  };

  switch (problemType) {
    case 'multiple_choice': {
      const correctIndex = problem.choices?.findIndex(c => c.is_correct) ?? -1;
      return {
        ...baseProblem,
        choices: problem.choices || [],
        correct_answer_index: correctIndex >= 0 ? correctIndex : null,
        wrong_explanation: problem.wrong_explanations || null,
      };
    }
    case 'short_answer':
      return {
        ...baseProblem,
        choices: [], // choices 컬럼이 NOT NULL이므로 빈 배열로 설정
        correct_answer: problem.correct_answer || '',
        correct_answer_index: null, // 단답형은 객관식이 아니므로 null
      };
    case 'essay':
      return {
        ...baseProblem,
        choices: [], // choices 컬럼이 NOT NULL이므로 빈 배열로 설정
        guidelines: problem.guidelines || null,
        correct_answer_index: null, // 서술형은 객관식이 아니므로 null
      };
    case 'ox':
      return {
        ...baseProblem,
        choices: [], // choices 컬럼이 NOT NULL이므로 빈 배열로 설정
        is_correct: problem.is_correct !== undefined ? problem.is_correct : null,
        correct_answer_index: null, // O/X 문제는 객관식이 아니므로 null
      };
    default:
      return {
        ...baseProblem,
        choices: [], // 기본값으로 빈 배열 설정
        correct_answer_index: null, // 기본값으로 null 설정
      };
  }
}

// 백그라운드 작업 함수: Gemini API 호출 및 DB 저장
async function generateProblemsInBackground(
  request: ProblemRequest,
  supabaseUrl: string,
  supabaseServiceKey: string,
  geminiApiKey: string
): Promise<void> {
  try {
    const { problemType, problemCount, classification, userId, language } = request;
    const userLanguage: Language = language === 'en' ? 'en' : 'ko';

    console.log(`[Background] Starting problem generation: ${problemCount} ${problemType} problems for user ${userId}`);

    // Supabase 클라이언트 생성
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    
    // 사용자 인증 확인
    const { data: userData, error: userError } = await supabase.auth.admin.getUserById(userId);
    
    if (userError || !userData.user) {
      throw new Error('Invalid user ID');
    }

    // 사용자 권한 확인 (선생님인지 확인)
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('user_id', userId)
      .single();

    const isTeacher = profile?.role === 'teacher';

    // 프롬프트 생성
    const prompt = buildPrompt(problemType, problemCount, classification, userLanguage);
    
    console.log(`[Background] Generating ${problemCount} ${problemType} problems...`);
    console.log(`[Background] Prompt length: ${prompt.length} characters`);

    // Gemini API 호출 (재시도 로직 적용)
    const ai = new GoogleGenAI({ apiKey: geminiApiKey });
    
    let responseText: string;
    
    // 재시도 설정
    const MAX_RETRIES = 5; // 최대 5번까지 재시도
    const BASE_DELAY = 5000; // 기본 5초 대기 (서버 복구 시간 고려)

    let attempt = 0;
    while (attempt < MAX_RETRIES) {
      try {
        const timeoutMs = 50000; // 50초 타임아웃
        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error('Gemini API request timeout')), timeoutMs);
        });
        
        const apiPromise = ai.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: { parts: [{ text: prompt }] },
        });
        
        console.log(`[Background] Attempt ${attempt + 1}/${MAX_RETRIES}: Starting Gemini API call with ${timeoutMs/1000}s timeout...`);
        const startTime = Date.now();
        
        const response = await Promise.race([apiPromise, timeoutPromise]);
        const elapsedTime = Date.now() - startTime;
        
        console.log(`[Background] Gemini API call completed in ${elapsedTime}ms`);
        responseText = response.text;
        console.log(`[Background] Received response, length:`, responseText.length);
        
        // 성공했으면 반복문 탈출
        break;
      } catch (apiError: any) {
        attempt++;
        
        // 에러 정보 상세 로깅
        console.error(`[Background] Gemini API error (attempt ${attempt}/${MAX_RETRIES}):`, apiError);
        console.error(`[Background] Error type:`, typeof apiError);
        console.error(`[Background] Error keys:`, apiError ? Object.keys(apiError) : 'N/A');
        if (apiError?.error) {
          console.error(`[Background] Nested error:`, apiError.error);
        }
        
        // 에러 정보 파싱
        const parsedError = parseApiError(apiError);
        const errorMessage = parsedError.message;
        const errorCode = parsedError.code;
        
        console.log(`[Background] Parsed error - code: ${errorCode}, message: ${errorMessage.substring(0, 100)}`);
        
        const isRateLimit = errorCode === 429 || errorMessage.toLowerCase().includes('rate limit') || errorMessage.toLowerCase().includes('quota') || errorMessage.toLowerCase().includes('429');
        const isServerOverload = errorCode === 503 || errorMessage.toLowerCase().includes('overloaded') || errorMessage.toLowerCase().includes('unavailable') || errorMessage.toLowerCase().includes('503') || parsedError.status === 'UNAVAILABLE';
        const isTimeout = errorMessage.includes('timeout') || errorMessage.includes('Timeout') || errorMessage.includes('TIMEOUT') || errorCode === 504;
        
        console.log(`[Background] Error classification - RateLimit: ${isRateLimit}, ServerOverload: ${isServerOverload}, Timeout: ${isTimeout}`);
        
        // 마지막 시도였거나, 재시도할 가치가 없는 에러라면 throw
        if (attempt >= MAX_RETRIES || (!isRateLimit && !isServerOverload && !isTimeout)) {
          console.error(`[Background] Gemini API failed after ${attempt} attempts:`, parsedError);
          throw new Error(`Gemini API error: ${errorMessage}`);
        }
        
        // 429, 503, 또는 타임아웃이면 잠시 대기 후 재시도 (Exponential Backoff)
        // 1번째: 5초, 2번째: 10초, 3번째: 20초, 4번째: 40초 대기
        const delay = BASE_DELAY * Math.pow(2, attempt - 1);
        console.warn(`[Background] Hit rate limit/overload/timeout (code: ${errorCode}, status: ${parsedError.status}). Retrying in ${delay/1000}s... (Attempt ${attempt}/${MAX_RETRIES})`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
    
    // JSON 파싱
    let jsonString = responseText.trim();
    jsonString = jsonString.replace(/```json/g, '').replace(/```/g, '').trim();
    
    let problems: AIGeneratedProblem[];
    try {
      const parsed = JSON.parse(jsonString);
      problems = Array.isArray(parsed) ? parsed : [parsed];
      console.log(`[Background] Parsed ${problems.length} problems from JSON`);
    } catch (e) {
      console.error('[Background] JSON parsing error:', e);
      console.error('[Background] Response text:', responseText.substring(0, 500));
      throw new Error(`Failed to parse AI response as JSON: ${e instanceof Error ? e.message : 'Unknown parsing error'}`);
    }

    if (!problems || problems.length === 0) {
      throw new Error('AI did not generate any problems. Please try again.');
    }

    // 문제 유효성 검증 및 변환
    const problemsToSave = problems
      .map((problem, idx) => {
        if (!problem || !problem.stem) {
          console.error(`[Background] Problem ${idx} is missing required fields:`, problem);
          throw new Error(`Problem ${idx + 1} is missing required fields (stem)`);
        }

        // O/X 타입 검증
        if (problemType === 'ox' && (problem.is_correct === undefined || problem.is_correct === null)) {
          console.error(`[Background] OX problem ${idx} is missing is_correct field:`, problem);
          throw new Error(`Problem ${idx + 1} (O/X type) is missing required field (is_correct)`);
        }

        return transformProblemForDB(problem, problemType, userId, classification, isTeacher);
      })
      .filter(p => p !== null);

    if (problemsToSave.length === 0) {
      throw new Error('No valid problems to save after processing');
    }

    // DB에 저장
    const { data: insertedProblems, error: insertError } = await supabase
      .from('generated_problems')
      .insert(problemsToSave)
      .select('id, stem, choices, correct_answer_index, problem_type, classification, correct_answer, guidelines, is_correct, explanation, is_editable');

    if (insertError) {
      console.error('[Background] Failed to save generated problems:', insertError);
      throw insertError;
    }

    console.log(`[Background] Successfully saved ${insertedProblems.length} problems to database`);
  } catch (error) {
    console.error('[Background] Error in background task:', error);
    console.error('[Background] Error stack:', error instanceof Error ? error.stack : 'No stack trace');
    
    // 에러 발생 시 클라이언트에 알리기 위해 에러 마커를 DB에 저장
    try {
      const supabase = createClient(supabaseUrl, supabaseServiceKey);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      
      // 에러 마커를 generated_problems 테이블에 저장 (Realtime으로 클라이언트에 전달)
      await supabase
        .from('generated_problems')
        .insert({
          user_id: request.userId,
          stem: '__GENERATION_ERROR__', // 에러 마커
          choices: [],
          correct_answer_index: null,
          problem_type: request.problemType,
          classification: request.classification || {},
          source_classification: request.classification || {},
          explanation: errorMessage, // 에러 메시지를 explanation에 저장
          is_editable: false,
        });
      
      console.log('[Background] Error marker saved to database for Realtime notification');
    } catch (markerError) {
      console.error('[Background] Failed to save error marker:', markerError);
      // 에러 마커 저장 실패해도 로깅만 하고 계속 진행
    }
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { 
      status: 405, 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
    });
  }

  try {
    console.log('generate-problems-by-type Edge Function called');
    const request: ProblemRequest = await req.json();
    
    const { problemType, problemCount, classification, userId, language } = request;
    
    // 입력 검증
    if (!problemType || !problemCount || !userId) {
      return new Response(JSON.stringify({ error: 'Missing required fields: problemType, problemCount, userId' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    if (problemCount <= 0 || problemCount > 50) {
      return new Response(JSON.stringify({ error: 'problemCount must be between 1 and 50' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // 환경 변수 확인
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const geminiApiKey = Deno.env.get('GEMINI_API_KEY');
    
    if (!supabaseUrl || !supabaseServiceKey) {
      return new Response(JSON.stringify({ error: 'Missing Supabase environment variables' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
    
    if (!geminiApiKey) {
      return new Response(JSON.stringify({ error: 'GEMINI_API_KEY environment variable is not set' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // 즉시 응답 반환
    const response = new Response(JSON.stringify({ 
      message: 'Processing started',
      success: true
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

    // 백그라운드 작업 시작
    EdgeRuntime.waitUntil(
      generateProblemsInBackground(request, supabaseUrl, supabaseServiceKey, geminiApiKey)
    );

    return response;

  } catch (e) {
    console.error('Error in generate-problems-by-type:', e);
    console.error('Error stack:', e instanceof Error ? e.stack : 'No stack trace');
    const errorMessage = e instanceof Error ? e.message : 'Unknown error';
    
    return new Response(JSON.stringify({ 
      success: false, 
      error: errorMessage
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
