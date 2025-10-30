import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { GoogleGenAI } from 'npm:@google/genai@1.21.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-requested-with',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS, PUT, DELETE',
  'Access-Control-Max-Age': '86400',
  'Access-Control-Allow-Credentials': 'true'
};

Deno.serve(async (req) => {
  // OPTIONS 요청 처리
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
    console.log('generate-report Edge Function called');
    const { problems, userId } = await req.json();
    
    if (!problems || !userId) {
      console.log('Missing required fields');
      return new Response(JSON.stringify({ error: 'Missing required fields: problems, userId' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // 환경 변수 확인
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const geminiApiKey = Deno.env.get('GEMINI_API_KEY') || 'AIzaSyA2w5PqQOn98wHaZy2MtiRkbxeHqrEYbTo';
    
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

    // Gemini API로 문제 분석 리포트 생성
    const ai = new GoogleGenAI({ apiKey: geminiApiKey });

    // 문제 데이터 준비
    const problemData = problems.map((p: any, i: number) => {
      const classification = p.classification || {};
      const depth1 = classification['1Depth'] || '';
      const depth2 = classification['2Depth'] || '';
      const depth3 = classification['3Depth'] || '';
      const depth4 = classification['4Depth'] || '';
      const classificationText = [depth1, depth2, depth3, depth4].filter(Boolean).join(' > ');
      
      return `문제 ${i + 1}:
- 문제 내용: ${p.problem.stem || '내용 없음'}
- 문제 분류: ${classificationText || '분류 없음'}
- 정답 여부: ${p.is_correct ? '정답' : '오답'}
- 사용자 답안: ${p.user_answer || '답안 없음'}
- 보기: ${(p.problem.choices || []).map((c: any, idx: number) => `${idx + 1}. ${c.text || ''}`).join(', ')}`;
    }).join('\n\n');

    const text = `안녕하세요, 영어 교육 전문가입니다. 

제공해주신 사용자 오답 문제에 대한 학습 리포트를 작성해 드리겠습니다. 다음은 제공받은 문제 정보입니다:

${problemData}

다음 내용을 포함하여 체계적인 학습 리포트를 작성해주세요:

1. **문제 분석**: 각 문제의 핵심 포인트와 요구사항
2. **공통 오류 패턴**: 이 문제들에서 나타나는 공통적인 실수 패턴 분석
3. **취약한 영역**: 사용자가 특히 약한 문법/어휘 영역 파악
4. **구체적인 개선 방안**: 각 문제 유형에 맞는 구체적인 학습 방법과 연습 방법 제시
5. **학습 권장사항**: 향후 학습 전략 및 우선순위

한국어로 상세하게 작성해주세요.`;

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: { parts: [{ text }] }
    });

    const report = response.text.trim();
    console.log('Problem analysis report generated successfully');

    return new Response(JSON.stringify({
      success: true,
      report: report
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Error generating problem analysis report:', error);
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : 'Internal server error'
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});

