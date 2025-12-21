// @ts-nocheck
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { GoogleGenAI } from "https://esm.sh/@google/genai@1.21.0"
import { createServiceSupabaseClient } from '../_shared/supabaseClient.ts'
import { requireEnv } from '../_shared/env.ts'
import { errorResponse, handleOptions, jsonResponse } from '../_shared/http.ts'
import { fetchTaxonomyByCode } from '../_shared/taxonomy.ts'

serve(async (req) => {
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
    const geminiApiKey = requireEnv('GEMINI_API_KEY');

    // 1. Taxonomy 정보 조회
    console.log('Step 1: Fetching taxonomy for code:', code);
    const taxonomy = await fetchTaxonomyByCode(supabase, code);

    if (!taxonomy) {
      console.error('Taxonomy not found for code:', code);
      return errorResponse('Taxonomy not found', 404);
    }

    // 2. 사용자 프로필 정보 조회 (연령, 학년)
    console.log('Step 2: Fetching user profile');
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('age, grade')
      .eq('user_id', userId)
      .single();

    if (profileError && profileError.code !== 'PGRST116') {
      throw profileError;
    }

    const userAge = profile?.age ? parseInt(profile.age) || 14 : 14; // 기본값: 14세
    const userGrade = profile?.grade || '중학생'; // 기본값: 중학생

    // 3. Gemini로 예시 문장 생성
    console.log('Step 3: Generating example with Gemini', { language });
    const ai = new GoogleGenAI({ apiKey: geminiApiKey });

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
3. **Explanation**: A brief explanation of why it's wrong and why it's correct

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
  "explanation": "Brief explanation in English"
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
3. **설명**: 왜 틀렸는지, 왜 맞는지 간단히 설명

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
  "explanation": "간단한 설명"
}
\`\`\`
`;

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: { parts: [{ text: prompt }] },
    });

    const responseText = response.text;
    console.log('Step 3 completed: Gemini response received, length:', responseText.length);

    // JSON 파싱
    let jsonString = responseText.trim();
    // ```json 또는 ```로 감싸진 경우 제거
    jsonString = jsonString.replace(/```json/g, '').replace(/```/g, '').trim();
    
    let result;
    try {
      result = JSON.parse(jsonString);
    } catch (parseError) {
      console.error('JSON parsing error:', parseError);
      console.error('Response text:', responseText);
      // JSON 파싱 실패 시 텍스트에서 JSON 부분만 추출 시도
      const jsonMatch = jsonString.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          result = JSON.parse(jsonMatch[0]);
        } catch (e) {
          throw new Error(`Failed to parse JSON response: ${parseError instanceof Error ? parseError.message : 'Unknown error'}`);
        }
      } else {
        throw new Error(`Failed to parse JSON response: ${parseError instanceof Error ? parseError.message : 'Unknown error'}`);
      }
    }

    // 결과 검증
    if (!result || typeof result !== 'object') {
      throw new Error('Invalid response format from AI');
    }

    // 필수 필드 확인
    if (!result.wrong_example && !result.correct_example) {
      throw new Error('AI response missing required fields: wrong_example or correct_example');
    }

    return jsonResponse({
      success: true,
      example: {
        wrong_example: result.wrong_example || '',
        correct_example: result.correct_example || '',
        explanation: result.explanation || '',
      },
    });
  } catch (error: any) {
    console.error('Error in generate-example function:', error);

    return errorResponse(error.message || 'Internal server error', 500, error.toString());
  }
});

