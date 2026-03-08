import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { GoogleGenAI } from "https://esm.sh/@google/genai@1.21.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { CORS_HEADERS, handleOptions, jsonResponse, errorResponse } from "../_shared/http.ts";
import { generateWithRetry, extractTextFromResponse } from "../_shared/aiClient.ts";
import { summarizeError } from "../_shared/errors.ts";
import { logAiUsage } from "../_shared/usageLogger.ts";
import { MODEL_SEQUENCE } from "../_shared/models.ts";
import { createAIClient } from "../_shared/aiClientFactory.ts";

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return handleOptions();
  }

  if (req.method !== 'POST') {
    return errorResponse('Method not allowed', 405);
  }

  try {
    console.log('generate-report Edge Function called');
    const { problems, userId } = await req.json();

    if (!problems || !userId) {
      console.log('Missing required fields');
      return errorResponse('Missing required fields: problems, userId', 400);
    }

    // 환경 변수 확인
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Missing Supabase environment variables');
    }

    // Supabase 클라이언트 생성
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // 사용자 인증 확인
    const { data: userData, error: userError } = await supabase.auth.admin.getUserById(userId);

    if (userError || !userData.user) {
      throw new Error('Invalid user ID');
    }

    // AI 클라이언트 생성 (Vertex AI 우선, GEMINI_API_KEY fallback)
    const { ai, provider } = createAIClient(GoogleGenAI);
    const sessionId = `gen-report-${userId}-${Date.now()}`;

    // 문제 데이터 준비
    const problemData = problems.map((p: any, i: number) => {
      const classification = p.classification || {};
      const depth1 = classification.depth1 || '';
      const depth2 = classification.depth2 || '';
      const depth3 = classification.depth3 || '';
      const depth4 = classification.depth4 || '';
      const classificationText = [depth1, depth2, depth3, depth4].filter(Boolean).join(' > ');

      // DB 스키마 변경 대응: root 레벨의 stem/choices 우선 확인 후, content 내부 확인
      const stem = p.problem.stem || p.problem.content?.stem || '내용 없음';
      const choices = p.problem.choices || p.problem.content?.choices || [];

      // choices가 문자열 배열일 수도 있고 객체 배열일 수도 있음
      const choicesText = choices.map((c: any, idx: number) => {
        const text = typeof c === 'string' ? c : (c.text || JSON.stringify(c));
        return `${idx + 1}. ${text}`;
      }).join(', ');

      return `문제 ${i + 1}:
- 문제 내용: ${stem}
- 문제 분류: ${classificationText || '분류 없음'}
- 정답 여부: ${p.is_correct ? '정답' : '오답'}
- 사용자 답안: ${p.user_answer || '답안 없음'}
- 보기: ${choicesText}`;
    }).join('\n\n');

    const prompt = `안녕하세요, 영어 교육 전문가입니다. 

제공해주신 사용자 오답 문제에 대한 학습 리포트를 작성해 드리겠습니다. 다음은 제공받은 문제 정보입니다:

${problemData}

다음 내용을 포함하여 체계적인 학습 리포트를 작성해주세요:

1. **문제 분석**: 각 문제의 핵심 포인트와 요구사항
2. **공통 오류 패턴**: 이 문제들에서 나타나는 공통적인 실수 패턴 분석
3. **취약한 영역**: 사용자가 특히 약한 문법/어휘 영역 파악
4. **구체적인 개선 방안**: 각 문제 유형에 맞는 구체적인 학습 방법과 연습 방법 제시
5. **학습 권장사항**: 향후 학습 전략 및 우선순위

한국어로 상세하게 작성해주세요.`;

    const modelName = MODEL_SEQUENCE[0]; // models.ts 기본 모델 사용
    // 재시도 로직 사용
    const result = await generateWithRetry({
      ai,
      model: modelName,
      contents: { parts: [{ text: prompt }] },
      sessionId,
      maxRetries: 2,
      baseDelayMs: 2000,
      temperature: 0.7
    });

    const report = await extractTextFromResponse(result.response, modelName);
    console.log('Problem analysis report generated successfully');

    // 토큰 사용량 로깅
    if (result.usageMetadata) {
      await logAiUsage({
        supabase,
        userId,
        functionName: 'generate-report',
        modelUsed: modelName,
        usageMetadata: result.usageMetadata,
        metadata: { problemCount: problems.length },
      });
    }

    return jsonResponse({
      success: true,
      report: report.trim()
    });

  } catch (error: any) {
    console.error('Error generating problem analysis report:', error);
    return errorResponse(
      error.message || 'Internal server error',
      500,
      summarizeError(error)
    );
  }
});

