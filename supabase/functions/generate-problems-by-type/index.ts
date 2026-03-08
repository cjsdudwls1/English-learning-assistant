// @ts-nocheck
import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { GoogleGenAI } from "https://esm.sh/@google/genai@1.21.0"
import { MODEL_SEQUENCE } from '../_shared/models.ts'
import { createAIClient } from '../_shared/aiClientFactory.ts'

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
    "explanation": "정답 해설 (한국어로)"
  }
]`,
            requirements: [
                '각 문제는 정확히 5개의 선택지를 가져야 합니다 (5지선다형)',
                '정답은 하나만 있어야 합니다 (is_correct: true)',
                'JSON 형식만 반환하고 다른 설명은 추가하지 마세요'
            ]
        },
        en: {
            intro: (count, classification) => `Generate ${count} multiple choice English problems (5 choices each).\n\nClassification: ${classification}`,
            format: `Return each problem as a JSON array:
[
  {
    "stem": "Problem text",
    "choices": [
      {"text": "Choice 1", "is_correct": false},
      {"text": "Choice 2", "is_correct": true},
      {"text": "Choice 3", "is_correct": false},
      {"text": "Choice 4", "is_correct": false},
      {"text": "Choice 5", "is_correct": false}
    ],
    "explanation": "Answer explanation"
  }
]`,
            requirements: [
                'Each problem must have exactly 5 choices',
                'Only one answer should be correct (is_correct: true)',
                'Return only JSON format without additional explanation'
            ]
        }
    },
    short_answer: {
        ko: {
            intro: (count, classification) => `다음 분류에 해당하는 영어 단답형 문제 ${count}개를 생성해주세요.\n\n분류: ${classification}`,
            format: `각 문제는 다음 형식의 JSON 배열로 반환해주세요:
[
  {
    "stem": "문제 본문 (빈칸 채우기, 영작 등)",
    "correct_answer": "정답",
    "acceptable_answers": ["정답", "대체 정답1", "대체 정답2"],
    "explanation": "정답 해설 (한국어로)"
  }
]`,
            requirements: [
                '정답과 허용 가능한 대체 정답을 모두 포함하세요',
                '빈칸은 ___로 표시하세요',
                'JSON 형식만 반환하고 다른 설명은 추가하지 마세요'
            ]
        },
        en: {
            intro: (count, classification) => `Generate ${count} short answer English problems.\n\nClassification: ${classification}`,
            format: `Return each problem as a JSON array:
[
  {
    "stem": "Problem text (fill in the blank, etc.)",
    "correct_answer": "Answer",
    "acceptable_answers": ["Answer", "Alt1", "Alt2"],
    "explanation": "Answer explanation"
  }
]`,
            requirements: [
                'Include correct answer and acceptable alternatives',
                'Use ___ for blanks',
                'Return only JSON format'
            ]
        }
    },
    essay: {
        ko: {
            intro: (count, classification) => `다음 분류에 해당하는 영어 서술형 문제 ${count}개를 생성해주세요.\n\n분류: ${classification}`,
            format: `각 문제는 다음 형식의 JSON 배열로 반환해주세요:
[
  {
    "stem": "서술형 문제 본문 (에세이, 문장 작성 등)",
    "guidelines": "답안 작성 가이드라인 (최소 단어 수, 포함해야 할 내용 등)",
    "sample_answer": "모범 답안",
    "grading_criteria": ["채점 기준 1", "채점 기준 2", "채점 기준 3"],
    "explanation": "문제 해설 및 핵심 포인트"
  }
]`,
            requirements: [
                '답안 작성에 필요한 명확한 가이드라인을 제공하세요',
                '채점 기준을 구체적으로 명시하세요',
                'JSON 형식만 반환하고 다른 설명은 추가하지 마세요'
            ]
        },
        en: {
            intro: (count, classification) => `Generate ${count} essay-type English problems.\n\nClassification: ${classification}`,
            format: `Return each problem as a JSON array:
[
  {
    "stem": "Essay problem text",
    "guidelines": "Writing guidelines (word count, content requirements)",
    "sample_answer": "Sample answer",
    "grading_criteria": ["Criteria 1", "Criteria 2", "Criteria 3"],
    "explanation": "Key points and explanation"
  }
]`,
            requirements: [
                'Provide clear guidelines for answering',
                'Include specific grading criteria',
                'Return only JSON format'
            ]
        }
    },
    ox: {
        ko: {
            intro: (count, classification) => `다음 분류에 해당하는 O/X 문제 ${count}개를 생성해주세요.\n\n분류: ${classification}`,
            format: `각 문제는 다음 형식의 JSON 배열로 반환해주세요:
[
  {
    "stem": "O/X 판단 문장 (영어로)",
    "correct_answer": true,
    "explanation": "정답 해설 (한국어로, 2~3문장 이내)"
  }
]`,
            requirements: [
                'correct_answer는 true 또는 false로 작성하세요',
                '해설은 반드시 2~3문장 이내로 간결하게 작성하세요. 장황한 설명은 금지합니다',
                '해설에서 "하지만", "다시 생각하면" 등으로 자기 모순적인 내용을 쓰지 마세요. 결론만 명확하게 서술하세요',
                'explanation 값에는 왜 정답이 true/false인지 핵심 근거만 포함하세요',
                'JSON 형식만 반환하고 다른 설명은 추가하지 마세요'
            ]
        },
        en: {
            intro: (count, classification) => `Generate ${count} True/False English problems.\n\nClassification: ${classification}`,
            format: `Return each problem as a JSON array:
[
  {
    "stem": "Statement to judge (True/False)",
    "correct_answer": true,
    "explanation": "Brief explanation (2-3 sentences max)"
  }
]`,
            requirements: [
                'correct_answer should be true or false',
                'Keep explanation to 2-3 sentences maximum. Be concise and direct',
                'Do not contradict yourself in the explanation. State the conclusion clearly',
                'Return only JSON format'
            ]
        }
    }
};

function buildPrompt(request: ProblemRequest): string {
    const { problemType, problemCount, classification, language, difficulty } = request;
    const template = promptTemplates[problemType][language];

    const classificationPath = classification
        ? [classification.depth1, classification.depth2, classification.depth3, classification.depth4]
            .filter(Boolean)
            .join(' > ')
        : (language === 'ko' ? '일반 영어' : 'General English');

    let prompt = template.intro(problemCount, classificationPath);

    if (difficulty) {
        prompt += language === 'ko'
            ? `\n\n난이도: ${difficulty}`
            : `\n\nDifficulty: ${difficulty}`;
    }

    prompt += '\n\n' + template.format;
    prompt += '\n\n' + (language === 'ko' ? '중요 사항:' : 'Important:');
    template.requirements.forEach((req, idx) => {
        prompt += `\n${idx + 1}. ${req}`;
    });

    return prompt;
}

async function generateProblemsInBackground(
    request: ProblemRequest,
    supabaseUrl: string,
    supabaseServiceKey: string,
) {
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const maxRetries = 5;
    const baseDelay = 5000;

    try {
        console.log('[Background] Starting problem generation...');
        const { ai, provider } = createAIClient(GoogleGenAI);
        console.log('[Background] AI provider:', provider);
        const prompt = buildPrompt(request);

        let responseText = '';
        let lastError: any = null;
        const modelErrors: Array<{ model: string; error: string }> = [];

        // gemini-3-flash-preview는 503이 잦아 failover 시간이 길어짐 → 제외
        // 문제 생성은 텍스트 기반이라 gemini-2.5-flash로 충분
        const genModels = (MODEL_SEQUENCE as readonly string[]).filter(m => m !== 'gemini-3-flash-preview');
        if (genModels.length === 0) genModels.push(...(MODEL_SEQUENCE as readonly string[]));

        // genModels를 순회하며 failover 시도
        for (let modelIdx = 0; modelIdx < genModels.length; modelIdx++) {
            const modelName = genModels[modelIdx];
            let modelSucceeded = false;

            console.log(`[Background] Trying model ${modelIdx + 1}/${genModels.length}: ${modelName}`);

            for (let attempt = 1; attempt <= maxRetries; attempt++) {
                try {
                    console.log(`[Background] Model=${modelName}, Attempt ${attempt}/${maxRetries}: Starting Gemini API call with 50s timeout...`);

                    const timeoutPromise = new Promise((_, reject) => {
                        setTimeout(() => reject(new Error('API call timeout after 50s')), 50000);
                    });

                    const apiPromise = ai.models.generateContent({
                        model: modelName,
                        contents: { parts: [{ text: prompt }] },
                        generationConfig: {
                            responseMimeType: "application/json",
                            temperature: 0.7,
                        },
                    });

                    const response = await Promise.race([apiPromise, timeoutPromise]) as any;

                    if (response?.text) {
                        responseText = typeof response.text === 'function'
                            ? await response.text()
                            : response.text;
                    } else if (response?.response?.text) {
                        responseText = typeof response.response.text === 'function'
                            ? await response.response.text()
                            : response.response.text;
                    } else if (response?.candidates?.[0]?.content?.parts?.[0]?.text) {
                        responseText = response.candidates[0].content.parts[0].text;
                    }

                    if (responseText && responseText.trim().length > 0) {
                        console.log(`[Background] Model=${modelName} succeeded on attempt ${attempt}`);
                        modelSucceeded = true;
                        break;
                    } else {
                        throw new Error('Empty response from Gemini API');
                    }

                } catch (apiError: any) {
                    lastError = apiError;

                    let errorCode = 0;
                    let errorMessage = '';
                    let errorStatus = '';

                    if (apiError?.status) errorCode = apiError.status;
                    if (apiError?.message) errorMessage = apiError.message;
                    if (apiError?.error?.status) errorStatus = apiError.error.status;

                    console.log(`[Background] Model=${modelName}, Attempt ${attempt}/${maxRetries} failed - code: ${errorCode}, message: ${errorMessage.substring(0, 200)}`);

                    const isRateLimit = errorCode === 429 ||
                        errorMessage.toLowerCase().includes('rate limit') ||
                        errorMessage.toLowerCase().includes('quota');
                    const isServerOverload = errorCode === 503 ||
                        errorMessage.toLowerCase().includes('overloaded') ||
                        errorStatus === 'UNAVAILABLE';
                    const isTimeout = errorMessage.toLowerCase().includes('timeout');

                    if (attempt === maxRetries) {
                        // 이 모델의 모든 재시도 소진 → 다음 모델로 failover
                        console.warn(`[Background] Model=${modelName} failed after ${maxRetries} attempts. Failing over to next model...`);
                        modelErrors.push({ model: modelName, error: errorMessage });
                        break;
                    }

                    if (isRateLimit || isServerOverload || isTimeout) {
                        const delay = baseDelay * Math.pow(2, attempt - 1);
                        console.log(`[Background] Hit rate limit/overload/timeout. Retrying in ${delay / 1000}s...`);
                        await new Promise(resolve => setTimeout(resolve, delay));
                    } else {
                        const delay = baseDelay * attempt;
                        console.log(`[Background] API error occurred. Retrying in ${delay / 1000}s...`);
                        await new Promise(resolve => setTimeout(resolve, delay));
                    }
                }
            }

            if (modelSucceeded) {
                console.log(`[Background] Successfully generated problems using model: ${modelName}`);
                break;
            }

            // 마지막 모델도 실패하면 최종 에러
            if (modelIdx === genModels.length - 1 && !modelSucceeded) {
                console.error(`[Background] All ${genModels.length} models failed:`, modelErrors);
                throw new Error(`All ${genModels.length} models failed to generate problems. Errors: ${JSON.stringify(modelErrors)}`);
            }
        }

        if (!responseText || responseText.trim().length === 0) {
            throw new Error('Failed to get response from Gemini API after all models');
        }

        // JSON 파싱
        const jsonString = responseText.replace(/```json/g, '').replace(/```/g, '').trim();
        let problems: any[];

        try {
            problems = JSON.parse(jsonString);
        } catch (parseError) {
            const arrayMatch = jsonString.match(/\[[\s\S]*\]/);
            if (arrayMatch) {
                problems = JSON.parse(arrayMatch[0]);
            } else {
                throw new Error('Failed to parse JSON response');
            }
        }

        if (!Array.isArray(problems)) {
            problems = [problems];
        }

        console.log(`[Background] Successfully parsed ${problems.length} problems`);

        // generated_problems 테이블에 저장
        const problemsToSave = problems.map((problem: any, index: number) => {
            const baseRecord: any = {
                user_id: request.userId,
                problem_type: request.problemType,
                stem: problem.stem || '',
                source_classification: request.classification || null,
                classification: request.classification || null,
            };

            // 문제 유형별 추가 필드 처리
            switch (request.problemType) {
                case 'multiple_choice':
                    baseRecord.choices = problem.choices || [];
                    baseRecord.correct_answer_index = problem.choices?.findIndex((c: any) => c.is_correct) ?? -1;
                    baseRecord.explanation = problem.explanation || null;
                    break;
                case 'short_answer':
                    baseRecord.correct_answer = problem.correct_answer || '';
                    baseRecord.acceptable_answers = problem.acceptable_answers || [];
                    baseRecord.explanation = problem.explanation || null;
                    break;
                case 'essay':
                    baseRecord.guidelines = problem.guidelines || '';
                    baseRecord.sample_answer = problem.sample_answer || '';
                    baseRecord.grading_criteria = problem.grading_criteria || [];
                    baseRecord.explanation = problem.explanation || null;
                    break;
                case 'ox':
                    baseRecord.correct_answer = problem.correct_answer;
                    baseRecord.explanation = problem.explanation || null;
                    break;
            }

            return baseRecord;
        });

        const { data: insertedProblems, error: insertError } = await supabase
            .from('generated_problems')
            .insert(problemsToSave)
            .select('id');

        if (insertError) {
            console.error('[Background] Failed to save problems:', insertError);
            throw insertError;
        }

        console.log(`[Background] Successfully saved ${insertedProblems?.length || 0} problems to database`);

        return { count: insertedProblems?.length || 0, problems: insertedProblems || [] };

        // 성공 알림을 위한 DB 업데이트
        await supabase
            .from('problem_generation_status')
            .upsert({
                user_id: request.userId,
                status: 'completed',
                problem_count: insertedProblems?.length || 0,
                updated_at: new Date().toISOString()
            }, { onConflict: 'user_id' });

    } catch (error: any) {
        console.error('[Background] Error in background task:', error);
        console.error('[Background] Error stack:', error instanceof Error ? error.stack : 'No stack');

        // 에러 상태 저장
        try {
            await supabase
                .from('problem_generation_status')
                .upsert({
                    user_id: request.userId,
                    status: 'error',
                    error_message: error.message || 'Unknown error',
                    updated_at: new Date().toISOString()
                }, { onConflict: 'user_id' });
            console.log('[Background] Error marker saved to database for Realtime notification');
        } catch (e) {
            console.error('[Background] Failed to save error status:', e);
        }
    }
}

Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response(null, {
            status: 200,
            headers: corsHeaders
        });
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

        const { problemType, problemCount, userId } = request;

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

        if (!supabaseUrl || !supabaseServiceKey) {
            return new Response(JSON.stringify({ error: 'Missing Supabase environment variables' }), {
                status: 500,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
        }

        // 동기식으로 문제 생성 (백그라운드 대신 직접 실행하여 에러 추적 가능)
        try {
            const result = await generateProblemsInBackground(request, supabaseUrl, supabaseServiceKey);

            return new Response(JSON.stringify({
                success: true,
                message: 'Problems generated successfully',
                count: result?.count || 0,
                problems: result?.problems || [],
            }), {
                status: 200,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
        } catch (genError: any) {
            console.error('[Sync] Problem generation failed:', genError);
            return new Response(JSON.stringify({
                success: false,
                error: genError.message || 'Problem generation failed',
            }), {
                status: 500,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
        }

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
