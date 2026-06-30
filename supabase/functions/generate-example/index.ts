import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { GoogleGenAI } from "https://esm.sh/@google/genai@1.21.0";
import { createServiceSupabaseClient } from "../_shared/supabaseClient.ts";
import { CORS_HEADERS, handleOptions, jsonResponse, errorResponse } from "../_shared/http.ts";
import { fetchTaxonomyByCode } from "../_shared/taxonomy.ts";
import { generateWithRetry, extractTextFromResponse, parseJsonResponse } from "../_shared/aiClient.ts";
import { summarizeError } from "../_shared/errors.ts";
import { logAiUsage } from "../_shared/usageLogger.ts";
import { MODEL_SEQUENCE } from "../_shared/models.ts";
import { createAIClient } from "../_shared/aiClientFactory.ts";
import { getActiveUserKey } from "../_shared/userApiKeys.ts";

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return handleOptions();
  }

  if (req.method !== 'POST') {
    return errorResponse('Method not allowed', 405);
  }

  try {
    const { code, userId, language } = await req.json();

    if (!code || !userId) {
      return errorResponse('Missing required fields: code, userId', 400);
    }

    const supabase = createServiceSupabaseClient();
    // 사용자 BYOK 키가 있으면 Claude/ChatGPT 사용, 없으면 시스템 Gemini로 폴백
    const userKey = await getActiveUserKey(supabase, userId);
    const { ai, provider } = createAIClient(GoogleGenAI, userKey);

    // 1. Taxonomy 정보 조회
    console.log('Step 1: Fetching taxonomy for code:', code);
    const taxonomy = await fetchTaxonomyByCode(supabase, code);

    if (!taxonomy) {
      console.error('Taxonomy not found for code:', code);
      return errorResponse('Taxonomy not found', 404);
    }

    // 2. 사용자 프로필 정보 조회
    console.log('Step 2: Fetching user profile');
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('age, grade')
      .eq('user_id', userId)
      .single();

    if (profileError && profileError.code !== 'PGRST116') {
      throw profileError;
    }

    const userAge = profile?.age ? parseInt(profile.age) || 14 : 14;
    const userGrade = profile?.grade || '중학생';

    // 3. Gemini로 예시 문장 생성
    console.log('Step 3: Generating example with AI', { language, provider });
    const sessionId = `gen-ex-${userId}-${Date.now()}`;

    // 언어에 따라 프롬프트 생성
    const isEnglish = language === 'en';
    const coreRule = isEnglish
      ? (taxonomy.core_rule_en || taxonomy.core_rule_ko || 'N/A')
      : (taxonomy.core_rule_ko || taxonomy.core_rule_en || 'N/A');
    const definition = isEnglish
      ? (taxonomy.definition_en || taxonomy.definition_ko || 'N/A')
      : (taxonomy.definition_ko || taxonomy.definition_en || 'N/A');

    const depth1Display = isEnglish ? (taxonomy.depth1_en || taxonomy.depth1) : taxonomy.depth1;
    const depth2Display = isEnglish ? (taxonomy.depth2_en || taxonomy.depth2) : taxonomy.depth2;
    const depth3Display = isEnglish ? (taxonomy.depth3_en || taxonomy.depth3) : taxonomy.depth3;
    const depth4Display = isEnglish ? (taxonomy.depth4_en || taxonomy.depth4) : taxonomy.depth4;

    const prompt = isEnglish
      ? `
You are an English education expert. Generate example sentences appropriate for the user's English learning level.

## Classification Information
- **Classification Code**: ${taxonomy.code}
- **depth1**: ${depth1Display}
- **depth2**: ${depth2Display || 'N/A'}
- **depth3**: ${depth3Display || 'N/A'}
- **depth4**: ${depth4Display || 'N/A'}
- **Core Rule**: ${coreRule}
- **Definition**: ${definition}

## User Information
- **Age**: ${userAge} years old
- **Grade**: ${userGrade}
- **Preferred Language**: English

## Requirements
Generate example sentences in the following format:

1. **Wrong Sentence** (❌): A sentence showing a common error in this classification
2. **Correct Sentence** (✅): A sentence using correct grammar
3. **Explanation**: A 4-5 sentence explanation conveying distinct learning value (no repetition): (1) exactly which rule the wrong sentence violates and where, (2) why that error happens — the underlying principle, (3) why the correct sentence follows the core rule, and (4) a practical tip to avoid the same mistake or one more short example of the rule

**Important Notes**:
- Use vocabulary and difficulty level appropriate for the user's age (${userAge} years old) and grade (${userGrade})
- Provide examples that clearly demonstrate the core rule
- Use simple, easy-to-understand sentences
- Include emojis (❌, ✅)
- All output (wrong_example, correct_example, explanation) must be in English

## Output Format
Output in the following JSON format:
\`\`\`json
{
  "wrong_example": "Wrong sentence in English",
  "correct_example": "Correct sentence in English",
  "explanation": "4-5 sentence explanation in English: (1) the violated rule and where, (2) why the error happens, (3) why the correct sentence fits the core rule, (4) a tip to avoid the mistake or another short example"
}
\`\`\`
`
      : `
당신은 영어 교육 전문가입니다. 사용자의 영어 학습 레벨에 맞는 예시 문장을 생성해주세요.

## 분류 정보
- **분류 코드**: ${taxonomy.code}
- **depth1**: ${depth1Display}
- **depth2**: ${depth2Display || 'N/A'}
- **depth3**: ${depth3Display || 'N/A'}
- **depth4**: ${depth4Display || 'N/A'}
- **핵심 규칙**: ${coreRule}
- **정의**: ${definition}

## 사용자 정보
- **연령**: ${userAge}세
- **학년**: ${userGrade}
- **선호 언어**: 한국어

## 요구사항
다음 형식으로 예시 문장을 생성해주세요:

1. **틀린 문장** (❌): 이 분류에서 자주 발생하는 오류를 보여주는 문장
2. **맞는 문장** (✅): 올바른 문법을 사용한 문장
3. **설명**: 서로 다른 학습 정보를 담아 4~5문장으로 설명(반복 금지): ① 틀린 문장이 위반한 규칙이 정확히 무엇이고 어디인지, ② 그 오류가 왜 생기는지 원리, ③ 맞는 문장이 왜 핵심 규칙에 부합하는지, ④ 같은 실수를 피하는 실용적 팁이나 규칙을 보여주는 또 다른 짧은 예

**주의사항**:
- 사용자의 연령(${userAge}세)과 학년(${userGrade})에 맞는 어휘와 난이도 사용
- 핵심 규칙을 명확히 보여주는 예시
- 이해하기 쉬운 문장
- 이모지 포함 (❌, ✅)

## 출력 형식
다음 JSON 형식으로 출력하세요:
\`\`\`json
{
  "wrong_example": "틀린 문장",
  "correct_example": "맞는 문장",
  "explanation": "4~5문장 설명: ① 위반한 규칙과 위치, ② 오류가 생기는 원리, ③ 맞는 문장이 핵심 규칙에 부합하는 이유, ④ 실수를 피하는 팁이나 또 다른 짧은 예"
}
\`\`\`
`;

    const modelName = MODEL_SEQUENCE[0]; // models.ts 기본 모델 사용
    const result = await generateWithRetry({
      ai,
      model: modelName,
      contents: { parts: [{ text: prompt }] },
      sessionId,
      maxRetries: 2,
      baseDelayMs: 2000,
      temperature: 0.7,
    });

    const responseText = await extractTextFromResponse(result.response, modelName);
    console.log('Step 3 completed: Gemini response received, length:', responseText.length);

    // JSON 파싱 (공통 함수 사용)
    const parsed: any = parseJsonResponse(responseText, modelName);

    // 결과 검증
    if (!parsed || typeof parsed !== 'object') {
      throw new Error('Invalid response format from AI');
    }

    // 필수 필드 확인
    if (!parsed.wrong_example && !parsed.correct_example) {
      throw new Error('AI response missing required fields: wrong_example or correct_example');
    }

    // 토큰 사용량 로깅
    if (result.usageMetadata) {
      await logAiUsage({
        supabase,
        userId,
        functionName: 'generate-example',
        modelUsed: modelName,
        usageMetadata: result.usageMetadata,
        metadata: { taxonomyCode: code },
      });
    }

    return jsonResponse({
      success: true,
      example: {
        wrong_example: parsed.wrong_example || '',
        correct_example: parsed.correct_example || '',
        explanation: parsed.explanation || '',
      },
    });

  } catch (error: any) {
    console.error('Error in generate-example function:', error);
    return errorResponse(
      error.message || 'Internal server error',
      500,
      summarizeError(error)
    );
  }
});

