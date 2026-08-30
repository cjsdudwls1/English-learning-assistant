// @ts-nocheck
import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { GoogleGenAI } from "https://esm.sh/@google/genai@1.21.0"
import { MODEL_SEQUENCE, MODEL_RETRY_POLICY } from '../_shared/models.ts'
import { createAIClient } from '../_shared/aiClientFactory.ts'
import { getActiveUserKey } from '../_shared/userApiKeys.ts'

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
    includePassage?: boolean;
    passageLength?: number;
    passageTopic?: { category: string; subfield: string };
    passageGenre?: string;
    difficultyLevel?: number;
    vocabLevel?: number;
    sharedPassage?: string;
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
    "explanation": "정답 해설 (한국어, 4~6문장, 각 항목은 줄바꿈으로 구분). 서로 다른 학습 정보를 담아라(반복 금지): ① 정답의 직접 근거 — 적용된 핵심 문법·어법·어휘 규칙과 이 문장에서 어떻게 작동하는지, ② 그 규칙이 성립하는 원리 — 왜 그런지(암기가 아닌 이해), ③ 가장 헷갈리는 오답의 함정 — 어느 선택지가 왜 매력적 오답인지, ④ 적용 확장 — 같은 규칙이 쓰이는 다른 짧은 예나 기억 팁",
    "wrong_explanation": {
      "0": "1번 선택지가 오답인 이유 (2~3문장): 무엇이 틀렸는지 + 이 선택지를 고르게 만드는 오해·함정의 정체 + 올바른 교정 방법",
      "2": "3번 선택지가 오답인 이유 (2~3문장): 같은 형식",
      "3": "4번 선택지가 오답인 이유 (2~3문장): 같은 형식",
      "4": "5번 선택지가 오답인 이유 (2~3문장): 같은 형식"
    }
  }
]`,
            requirements: [
                '각 문제는 정확히 5개의 선택지를 가져야 합니다 (5지선다형)',
                '정답은 하나만 있어야 합니다 (is_correct: true)',
                'explanation은 ①정답의 직접 근거(핵심 문법·어법·어휘 규칙) ②그 규칙의 원리 ③대표 오답의 함정 ④적용 확장(다른 예·기억 팁)을 4~6문장으로 담되, 학습자가 이 해설만으로 유사 문제를 스스로 풀 수 있을 만큼 구체적으로 쓰세요. 같은 말 반복·군더더기는 금지',
                'wrong_explanation에는 정답을 제외한 나머지 4개 선택지 각각에 대해, 그 선택지의 인덱스(0부터 시작, 정답 인덱스 제외)를 키로 왜 틀렸는지·왜 매력적 오답인지(함정의 정체)·올바른 교정 방법을 2~3문장으로 설명하세요',
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
    "explanation": "Answer explanation (4-6 sentences, each point on its own line). Convey distinct learning value (no repetition): (1) the direct basis — the key grammar/usage/vocabulary rule and how it works in this sentence, (2) the underlying principle — why the rule holds (understanding, not memorization), (3) the trap — which wrong choice is most tempting and why, (4) an applied extension — another short example using the same rule or a memory tip",
    "wrong_explanation": {
      "0": "Why choice 1 is wrong (2-3 sentences): what is wrong + the misconception/trap that makes it tempting + how to correct it",
      "2": "Why choice 3 is wrong (2-3 sentences): same format",
      "3": "Why choice 4 is wrong (2-3 sentences): same format",
      "4": "Why choice 5 is wrong (2-3 sentences): same format"
    }
  }
]`,
            requirements: [
                'Each problem must have exactly 5 choices',
                'Only one answer should be correct (is_correct: true)',
                'explanation must cover, in 4-6 sentences, (1) the direct basis (key grammar/usage/vocabulary rule), (2) the principle behind it, (3) the trap of the most tempting wrong choice, and (4) an applied extension (another example or memory tip), specific enough that a learner can solve similar problems from it alone. No repetition or filler',
                'wrong_explanation must include, for each of the 4 non-correct choices keyed by index (0-based, excluding the correct one), 2-3 sentences on why it is wrong, why it is a tempting distractor (the trap), and how to correct it',
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
    "explanation": "정답 해설 (한국어, 4~6문장, 각 항목 줄바꿈). ① 정답의 근거 — 핵심 문법·표현과 빈칸/영작에서의 작동, ② 그 표현이어야 하는 원리, ③ 허용되는 대체 정답과 안 되는 표현의 경계, ④ 학습자가 흔히 쓰는 오답·실수와 교정 방법"
  }
]`,
            requirements: [
                '정답과 허용 가능한 대체 정답을 모두 포함하세요',
                '빈칸은 ___로 표시하세요',
                'explanation은 ①정답 근거(핵심 문법·표현) ②그 표현의 원리 ③허용 대체 정답과 오답의 경계 ④흔한 실수·교정을 4~6문장으로, 학습자가 스스로 점검할 수 있을 만큼 구체적으로 쓰세요. 반복·군더더기 금지',
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
    "explanation": "Answer explanation (4-6 sentences, each point on its own line): (1) the basis — key grammar/expression and how it works here, (2) why this expression is required, (3) which alternative answers are acceptable vs. not (the boundary), (4) common mistakes learners make and how to fix them"
  }
]`,
            requirements: [
                'Include correct answer and acceptable alternatives',
                'Use ___ for blanks',
                'explanation must cover, in 4-6 sentences, (1) the rationale (key grammar/expression), (2) why that expression is required, (3) the boundary between acceptable and unacceptable answers, and (4) common mistakes and fixes. No filler',
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
    "explanation": "문제 해설 및 핵심 포인트 (한국어, 4~6문장, 각 항목 줄바꿈): ① 출제 의도 — 이 문제가 평가하는 능력, ② 강한 답안의 핵심 요소 — 내용·구조·표현 측면, ③ 학생들이 자주 하는 실수, ④ 점수를 끌어올리는 구체적 팁이나 활용 표현 예"
  }
]`,
            requirements: [
                '답안 작성에 필요한 명확한 가이드라인을 제공하세요',
                '채점 기준을 구체적으로 명시하세요',
                'explanation에는 ①출제 의도 ②강한 답안의 핵심 요소(내용·구조·표현) ③학생들이 자주 하는 실수 ④점수를 끌어올리는 구체적 팁이나 표현 예를 4~6문장으로 담되, 학습자가 스스로 답안을 개선할 수 있을 만큼 구체적으로 쓰세요. 군더더기·반복은 금지',
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
    "explanation": "Key points and explanation (4-6 sentences, each point on its own line): (1) the intent — what skill this assesses, (2) the essential elements of a strong answer (content, structure, expression), (3) common mistakes students make, (4) concrete tips or example phrases that raise the score"
  }
]`,
            requirements: [
                'Provide clear guidelines for answering',
                'Include specific grading criteria',
                'explanation must cover, in 4-6 sentences, (1) the intent of the task, (2) the essential elements of a strong answer (content, structure, expression), (3) common mistakes students make, and (4) concrete tips or example phrases that raise the score, specific enough for a learner to improve their own answer. No filler or repetition',
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
    "explanation": "정답 해설 (한국어, 4~6문장, 각 항목 줄바꿈): ① 정답이 true/false인 명확한 근거, ② 적용된 핵심 문법·어법 규칙과 그것이 이 문장에서 작동하는 원리, ③ 이 진술에서 학습자가 흔히 헷갈리는 지점(반대로 판단하게 만드는 함정), ④ 기억 팁이나 같은 규칙이 적용되는 다른 짧은 예. 결론은 처음부터 명확히 — 번복·자기모순 금지"
  }
]`,
            requirements: [
                'correct_answer는 true 또는 false로 작성하세요',
                '해설은 4~6문장으로 ①정답 근거 ②적용된 문법·어법 규칙과 그 원리 ③학습자가 헷갈리는 함정 ④기억 팁이나 다른 예를 담되, 학습자가 같은 유형을 스스로 판단할 수 있을 만큼 구체적으로 쓰세요. 불필요한 반복은 피하세요',
                '해설에서 "하지만", "다시 생각하면" 등으로 자기 모순적인 내용을 쓰지 마세요. 결론을 명확하게 서술하세요',
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
    "explanation": "Answer explanation (4-6 sentences, each point on its own line): (1) the clear basis for why the answer is true/false, (2) the key grammar/usage rule applied and how it works in this sentence, (3) the common point of confusion in this statement (the trap that makes learners judge the opposite), (4) a memory tip or another short example of the same rule. State the conclusion clearly from the start — no reversal or self-contradiction"
  }
]`,
            requirements: [
                'correct_answer should be true or false',
                'Explain in 4-6 sentences: (1) the basis for the answer, (2) the grammar/usage rule applied and its underlying principle, (3) the trap that confuses learners, and (4) a memory tip or another example, specific enough for a learner to judge similar statements on their own. Avoid unnecessary repetition',
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

    // 문제 난이도 레벨 (5단계)
    if (request.difficultyLevel) {
        prompt += language === 'ko'
            ? `\n\n[문제 난이도]\n문제 난이도는 5단계 중 ${request.difficultyLevel}단계로 설정하라. (1=기초, 3=수능 평균, 5=최고난도)`
            : `\n\n[Difficulty Level]\nSet the problem difficulty to level ${request.difficultyLevel} out of 5. (1=Basic, 3=Average, 5=Most Difficult)`;
    }

    // 어휘 난이도 레벨 (5단계)
    if (request.vocabLevel) {
        prompt += language === 'ko'
            ? `\n\n[어휘 수준]\n사용 어휘 수준은 5단계 중 ${request.vocabLevel}단계로 설정하라. (1=중학 기초, 2=고1, 3=수능, 4=TEPS/편입, 5=GRE/학술)`
            : `\n\n[Vocabulary Level]\nSet the vocabulary level to ${request.vocabLevel} out of 5. (1=Basic/Middle School, 2=High School Year 1, 3=CSAT, 4=TEPS/Transfer, 5=GRE/Academic)`;
    }

    if (request.includePassage) {
        if (request.sharedPassage) {
            // 공유 지문이 제공된 경우: 새 지문을 생성하지 않고 제공된 지문을 사용
            prompt += language === 'ko'
                ? `\n\n[지문 기반 출제 지시]\n아래 제공된 영어 지문을 읽고, 이 지문의 내용에 기반하여 문제를 출제하라. 지문 내용을 정확히 이해해야만 풀 수 있는 문제를 만들어라.\n\n--- 지문 ---\n${request.sharedPassage}\n--- 지문 끝 ---`
                : `\n\n[Passage-Based Problem Creation]\nRead the passage below and create problems based on its content. Problems should require accurate understanding of the passage to answer.\n\n--- Passage ---\n${request.sharedPassage}\n--- End of Passage ---`;
        } else {
            // 지문을 새로 생성해야 하는 경우
            prompt += language === 'ko'
                ? `\n\n[지문 포함 지시]\n하나의 영어 지문(passage)을 생성하고, 모든 문제를 그 지문에 기반하여 출제하라. 지문은 학술적이거나 교양적인 내용의 영어 원문이어야 하며, 문제는 해당 지문을 읽고 풀 수 있도록 설계하라. 모든 문제의 "passage" 필드에 동일한 지문을 포함시켜라.`
                : `\n\n[Passage Inclusion]\nGenerate ONE English passage and create ALL problems based on that single passage. The passage should be academic or informational English text, and all problems should be designed to be answered after reading the passage. Include the same passage in the "passage" field of every problem.`;

            // 지문 길이 지정
            if (request.passageLength) {
                prompt += language === 'ko'
                    ? `\n지문 길이는 약 ${request.passageLength}자(±100자)로 작성하라.`
                    : `\nThe passage length should be approximately ${request.passageLength} characters (±100 characters).`;
            }

            // 지문 분야 지정
            if (request.passageTopic?.category && request.passageTopic?.subfield) {
                prompt += language === 'ko'
                    ? `\n지문의 주제는 ${request.passageTopic.category} 분야의 ${request.passageTopic.subfield}에 관한 학술적/교양적 내용으로 작성하라.`
                    : `\nThe passage topic should be about ${request.passageTopic.subfield} in the field of ${request.passageTopic.category}, written as academic or informational content.`;
            }

            // 지문 종류(genre) 지정
            if (request.passageGenre) {
                prompt += language === 'ko'
                    ? `\n지문의 형식(종류)은 반드시 "${request.passageGenre}" 형태로 작성하라. 예: 편지라면 Dear...로 시작, 기사라면 헤드라인+본문, 대화문이라면 A/B 화자 교대 등.`
                    : `\nThe passage MUST be written in "${request.passageGenre}" format. For example: a letter should start with "Dear...", a news article should have a headline and body, a dialogue should alternate between speakers, etc.`;
            }
        }
    }

    // includePassage일 때 JSON format 문자열에 passage 필드 예시를 동적 삽입
    // (템플릿 자체를 수정하지 않고, format 문자열 내 첫 번째 JSON 객체에 passage 필드를 추가)
    let formatStr = template.format;
    if (request.includePassage) {
        // JSON 예시의 첫 번째 키 앞에 passage 필드 삽입 ("stem" 또는 첫 키 앞)
        const passageField = language === 'ko'
            ? '"passage": "지문 전문 (영어 원문)",\n    '
            : '"passage": "Full passage text",\n    ';
        // JSON 객체 시작 후 첫 번째 필드 앞에 삽입
        formatStr = formatStr.replace(/\{\s*\n\s+"/, `{\n    ${passageField}"`);
    }

    prompt += '\n\n' + formatStr;
    prompt += '\n\n' + (language === 'ko' ? '중요 사항:' : 'Important:');
    template.requirements.forEach((req, idx) => {
        prompt += `\n${idx + 1}. ${req}`;
    });

    if (request.includePassage) {
        const passageReqIdx = template.requirements.length + 1;
        if (request.sharedPassage) {
            prompt += language === 'ko'
                ? `\n${passageReqIdx}. 각 문제 JSON 객체에 "passage" 필드를 추가하여 위에서 제공한 지문 전문을 그대로 포함하세요.`
                : `\n${passageReqIdx}. Add a "passage" field to each problem JSON object containing the exact passage text provided above.`;
        } else {
            prompt += language === 'ko'
                ? `\n${passageReqIdx}. 모든 문제 JSON 객체의 "passage" 필드에 동일한 지문 전문을 포함하세요.`
                : `\n${passageReqIdx}. Include the same full passage text in the "passage" field of every problem JSON object.`;
        }
    }

    return prompt;
}

async function generateProblemsInBackground(
    request: ProblemRequest,
    supabaseUrl: string,
    supabaseServiceKey: string,
) {
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    try {
        console.log('[Background] Starting problem generation...');
        console.log('[Background] Request AI options:', {
          includePassage: request.includePassage,
          passageLength: request.passageLength,
          passageTopic: request.passageTopic,
          passageGenre: request.passageGenre,
          difficultyLevel: request.difficultyLevel,
          vocabLevel: request.vocabLevel,
          classification: request.classification,
        });
        const userKey = await getActiveUserKey(supabase, request.userId);
        const { ai, provider } = createAIClient(GoogleGenAI, userKey);
        console.log('[Background] AI provider:', provider);
        const prompt = buildPrompt(request);

        let responseText = '';
        let lastError: any = null;
        const modelErrors: Array<{ model: string; error: string }> = [];

        // MODEL_SEQUENCE를 순회하며 failover 시도
        for (let modelIdx = 0; modelIdx < MODEL_SEQUENCE.length; modelIdx++) {
            const modelName = MODEL_SEQUENCE[modelIdx];
            const retryPolicy = MODEL_RETRY_POLICY[modelName] || { maxRetries: 2, baseDelayMs: 3000 };
            let modelSucceeded = false;

            console.log(`[Background] Trying model ${modelIdx + 1}/${MODEL_SEQUENCE.length}: ${modelName} (maxRetries=${retryPolicy.maxRetries})`);

            for (let attempt = 1; attempt <= retryPolicy.maxRetries; attempt++) {
                try {
                    console.log(`[Background] Model=${modelName}, Attempt ${attempt}/${retryPolicy.maxRetries}: Starting Gemini API call with 50s timeout...`);

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

                    console.log(`[Background] Model=${modelName}, Attempt ${attempt}/${retryPolicy.maxRetries} failed - code: ${errorCode}, message: ${errorMessage.substring(0, 200)}`);

                    const isRateLimit = errorCode === 429 ||
                        errorMessage.toLowerCase().includes('rate limit') ||
                        errorMessage.toLowerCase().includes('quota');
                    const isServerOverload = errorCode === 503 ||
                        errorMessage.toLowerCase().includes('overloaded') ||
                        errorStatus === 'UNAVAILABLE';
                    const isTimeout = errorMessage.toLowerCase().includes('timeout');

                    if (attempt === retryPolicy.maxRetries) {
                        // 이 모델의 모든 재시도 소진 → 다음 모델로 failover
                        console.warn(`[Background] Model=${modelName} failed after ${retryPolicy.maxRetries} attempts. Failing over to next model...`);
                        modelErrors.push({ model: modelName, error: errorMessage });
                        break;
                    }

                    if (isRateLimit || isServerOverload || isTimeout) {
                        const delay = retryPolicy.baseDelayMs * Math.pow(2, attempt - 1);
                        console.log(`[Background] Hit rate limit/overload/timeout. Retrying in ${delay / 1000}s...`);
                        await new Promise(resolve => setTimeout(resolve, delay));
                    } else {
                        const delay = retryPolicy.baseDelayMs * attempt;
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
            if (modelIdx === MODEL_SEQUENCE.length - 1 && !modelSucceeded) {
                console.error(`[Background] All ${MODEL_SEQUENCE.length} models failed:`, modelErrors);
                throw new Error(`All ${MODEL_SEQUENCE.length} models failed to generate problems. Errors: ${JSON.stringify(modelErrors)}`);
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

        // sharedPassage가 제공된 경우, 모든 문제에 동일한 passage 적용
        // (AI가 passage를 응답에 포함하지 않았더라도 강제 할당)
        if (request.sharedPassage) {
            problems.forEach((p: any) => {
                p.passage = request.sharedPassage;
            });
            console.log(`[Background] Applied sharedPassage to all ${problems.length} problems`);
        }

        // 첫 번째 문제의 passage를 추출 (응답에 포함하기 위해)
        const generatedPassage = problems[0]?.passage || null;

        // generated_problems 테이블에 저장
        const problemsToSave = problems.map((problem: any, index: number) => {
            const baseRecord: any = {
                user_id: request.userId,
                problem_type: request.problemType,
                stem: problem.stem || '',
                source_classification: request.classification || null,
                classification: request.classification || null,
                passage: problem.passage || null,
            };

            // 문제 유형별 추가 필드 처리
            switch (request.problemType) {
                case 'multiple_choice':
                    // choices 정규화: AI가 is_correct를 다른 형태로 반환할 수 있음
                    const rawChoices = problem.choices || [];
                    baseRecord.choices = rawChoices.map((c: any) => ({
                        text: c.text || '',
                        is_correct: c.is_correct === true || c.is_correct === 'true' || c.isCorrect === true,
                    }));
                    baseRecord.correct_answer_index = baseRecord.choices.findIndex((c: any) => c.is_correct);
                    if (baseRecord.correct_answer_index === -1 && baseRecord.choices.length > 0) {
                        // 정답이 없으면 첫 번째를 정답으로 설정 (fallback)
                        baseRecord.correct_answer_index = 0;
                        baseRecord.choices[0].is_correct = true;
                        console.warn(`[Background] No correct answer found in choices, defaulting to index 0`);
                    }
                    baseRecord.explanation = problem.explanation || null;
                    // 오답별 해설: AI가 wrong_explanation(단수, DB 컬럼) 또는 wrong_explanations(복수)로 반환 가능 → 정규화 후 단수 컬럼에 저장
                    baseRecord.wrong_explanation = problem.wrong_explanation || problem.wrong_explanations || null;
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
                    baseRecord.correct_answer = String(problem.correct_answer);
                    baseRecord.explanation = problem.explanation || null;
                    break;
            }

            return baseRecord;
        });

        console.log(`[Background] Saving ${problemsToSave.length} problems. First record keys:`, 
            problemsToSave.length > 0 ? Object.keys(problemsToSave[0]) : 'empty');

        const { data: insertedProblems, error: insertError } = await supabase
            .from('generated_problems')
            .insert(problemsToSave)
            .select('id');

        if (insertError) {
            console.error('[Background] Failed to save problems:', JSON.stringify(insertError));
            throw insertError;
        }

        // insert().select('id') 결과가 비어있으면 별도 조회로 fallback
        let finalProblems = insertedProblems || [];
        if (finalProblems.length === 0 && problemsToSave.length > 0) {
            console.warn('[Background] insert().select() returned empty. Trying fallback query...');
            const { data: fallbackProblems } = await supabase
                .from('generated_problems')
                .select('id')
                .eq('user_id', request.userId)
                .eq('problem_type', request.problemType)
                .order('created_at', { ascending: false })
                .limit(problemsToSave.length);
            finalProblems = fallbackProblems || [];
            console.log(`[Background] Fallback query found ${finalProblems.length} problems`);
        }

        console.log(`[Background] Successfully saved ${finalProblems.length} problems to database`);

        return { count: finalProblems.length, problems: finalProblems, passage: generatedPassage };

    } catch (error: any) {
        console.error('[Background] Error in background task:', error);
        console.error('[Background] Error stack:', error instanceof Error ? error.stack : 'No stack');
        console.error(`[Background] 생성 실패: userId=${request.userId}`);
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
                passage: result?.passage || null,
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
