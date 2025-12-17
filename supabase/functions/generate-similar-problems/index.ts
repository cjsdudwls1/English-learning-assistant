import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { GoogleGenAI } from "https://esm.sh/@google/genai@1.21.0"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS, PUT, DELETE',
  'Access-Control-Max-Age': '86400',
};

serve(async (req) => {
  // OPTIONS 요청 처리
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
    console.log('generate-similar-problems Edge Function called');
    const { classifications, userId, language } = await req.json();
    
    // 언어 설정 (기본값: ko)
    const userLanguage: 'ko' | 'en' = language === 'en' ? 'en' : 'ko';
    
    if (!classifications || !userId) {
      console.log('Missing required fields');
      return new Response(JSON.stringify({ error: 'Missing required fields: classifications, userId' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // 환경 변수 확인
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const geminiApiKey = Deno.env.get('GEMINI_API_KEY');
    
    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Missing Supabase environment variables');
    }
    
    if (!geminiApiKey) {
      throw new Error('GEMINI_API_KEY environment variable is not set');
    }

    // Supabase 클라이언트 생성
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    
    // 사용자 인증 확인
    const { data: userData, error: userError } = await supabase.auth.admin.getUserById(userId);
    
    if (userError || !userData.user) {
      throw new Error('Invalid user ID');
    }

    // Gemini API로 유사 문제 생성
    const ai = new GoogleGenAI({ apiKey: geminiApiKey });

    // 각 분류에 대해 유사 문제 생성
    const allProblems: any[] = [];

    for (const classification of classifications) {
      const { depth1, depth2, depth3, depth4, problemCount } = classification;
      
      // 분류 정보 문자열 생성
      const classificationPath = [depth1, depth2, depth3, depth4].filter(Boolean).join(' > ');
      
      // Gemini API에 요청할 프롬프트 생성
      const promptLanguage = userLanguage === 'en' ? 'English' : 'Korean';
      const prompt = userLanguage === 'en' 
        ? `Generate ${problemCount} English problems for the following classification:

Classification: ${classificationPath}

Each problem should be returned as a JSON array in the following format:
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
    "explanation": "Answer explanation: why this is the correct answer (in English)",
    "wrong_explanations": {
      "0": "Wrong answer explanation: why choice 1 is incorrect",
      "1": "This is the correct answer",
      "2": "Wrong answer explanation: why choice 3 is incorrect",
      "3": "Wrong answer explanation: why choice 4 is incorrect",
      "4": "Wrong answer explanation: why choice 5 is incorrect"
    },
    "classification": {
      "depth1": "${depth1}",
      "depth2": "${depth2 || ''}",
      "depth3": "${depth3 || ''}",
      "depth4": "${depth4 || ''}"
    }
  }
]

Important:
1. All problems must match the ${classificationPath} classification.
2. Each problem must have exactly 5 choices (5-choice multiple choice).
3. There must be only one correct answer (is_correct: true).
4. The explanation field should contain the answer explanation in English.
5. The wrong_explanations object should contain wrong answer explanations for each choice index (the correct index should say "This is the correct answer").
6. Problem difficulty should be at middle school level.
7. Return only JSON format without any additional explanation.`
        : `다음 분류에 해당하는 영어 문제 ${problemCount}개를 생성해주세요.

분류: ${classificationPath}

각 문제는 다음 형식의 JSON 배열로 반환해주세요:
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
    "explanation": "정답 해설: 왜 이것이 정답인지 설명 (한국어로)",
    "wrong_explanations": {
      "0": "오답 해설: 왜 선택지 1이 오답인지 설명",
      "1": "이 선택지는 정답입니다",
      "2": "오답 해설: 왜 선택지 3이 오답인지 설명",
      "3": "오답 해설: 왜 선택지 4가 오답인지 설명",
      "4": "오답 해설: 왜 선택지 5가 오답인지 설명"
    },
    "classification": {
      "depth1": "${depth1}",
      "depth2": "${depth2 || ''}",
      "depth3": "${depth3 || ''}",
      "depth4": "${depth4 || ''}"
    }
  }
]

중요 사항:
1. 모든 문제는 ${classificationPath} 분류에 맞아야 합니다.
2. 각 문제는 정확히 5개의 선택지를 가져야 합니다 (5지선다형).
3. 정답은 하나만 있어야 합니다 (is_correct: true).
4. explanation 필드에는 정답 해설을 ${promptLanguage === 'English' ? '영어로' : '한국어로'} 작성하세요.
5. wrong_explanations 객체에는 각 선택지 인덱스를 키로 하여 오답 해설을 작성하세요 (정답 인덱스는 "이 선택지는 정답입니다"로 표시).
6. 문제 난이도는 중학교 수준으로 작성해주세요.
7. JSON 형식만 반환하고 다른 설명은 추가하지 마세요.`;

      console.log(`Generating ${problemCount} problems for classification: ${classificationPath}`);
      
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: { parts: [{ text: prompt }] },
      });

      const responseText = response.text;
      console.log(`Received response for ${classificationPath}, length:`, responseText.length);
      
      // JSON 파싱
      let jsonString = responseText.trim();
      // ```json 또는 ```로 감싸진 경우 제거
      jsonString = jsonString.replace(/```json/g, '').replace(/```/g, '').trim();
      
      // JSON 배열이 아닌 경우 객체를 배열로 변환
      let problems: any[];
      try {
        const parsed = JSON.parse(jsonString);
        problems = Array.isArray(parsed) ? parsed : [parsed];
      } catch (e) {
        console.error('JSON parsing error:', e);
        // JSON 파싱 실패 시 빈 배열 반환
        problems = [];
      }

      // 분류 정보 추가 및 정답 인덱스 계산
      const processedProblems = problems.map((problem: any) => {
        // 정답 인덱스 찾기
        const correctIndex = problem.choices.findIndex((c: any) => c.is_correct);
        
        return {
          ...problem,
          correct_answer_index: correctIndex,
          classification: {
            depth1,
            depth2: depth2 || '',
            depth3: depth3 || '',
            depth4: depth4 || ''
          },
          source_classification: {
            depth1,
            depth2: depth2 || '',
            depth3: depth3 || '',
            depth4: depth4 || ''
          }
        };
      });

      // DB에 저장
      const problemsToSave = processedProblems.map((p: any) => ({
        user_id: userId,
        stem: p.stem,
        choices: p.choices,
        correct_answer_index: p.correct_answer_index,
        explanation: p.explanation || null,
        wrong_explanation: p.wrong_explanations || null,
        classification: p.classification,
        source_classification: p.source_classification
      }));

      const { data: insertedProblems, error: insertError } = await supabase
        .from('generated_problems')
        .insert(problemsToSave)
        .select('id');

      if (insertError) {
        console.error('Failed to save generated problems:', insertError);
        // 저장 실패해도 문제 생성은 계속 진행
        allProblems.push(...processedProblems);
      } else {
        console.log(`Saved ${problemsToSave.length} problems to database`);
        // 저장된 문제에 id 추가
        const problemsWithId = processedProblems.map((p: any, idx: number) => ({
          ...p,
          id: insertedProblems?.[idx]?.id
        }));
        allProblems.push(...problemsWithId);
      }
      console.log(`Generated ${processedProblems.length} problems for ${classificationPath}`);
    }

    console.log(`Total generated problems: ${allProblems.length}`);

    return new Response(JSON.stringify({ 
      success: true, 
      problems: allProblems 
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (e) {
    console.error('Error in generate-similar-problems:', e);
    return new Response(JSON.stringify({ 
      success: false, 
      error: e instanceof Error ? e.message : 'Unknown error' 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});

