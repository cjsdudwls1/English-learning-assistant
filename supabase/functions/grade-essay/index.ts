import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { GoogleGenAI } from "https://esm.sh/@google/genai@1.21.0";
import { createServiceSupabaseClient } from "../_shared/supabaseClient.ts";
import { handleOptions, jsonResponse, errorResponse } from "../_shared/http.ts";
import { generateWithRetry, extractTextFromResponse, parseJsonResponse } from "../_shared/aiClient.ts";
import { summarizeError } from "../_shared/errors.ts";
import { logAiUsage } from "../_shared/usageLogger.ts";
import { MODEL_SEQUENCE } from "../_shared/models.ts";
import { createAIClient } from "../_shared/aiClientFactory.ts";
import { getActiveUserKey } from "../_shared/userApiKeys.ts";

// 서술형 과제 응답 AI 보조 채점.
// 판정은 제안(suggestion)일 뿐 DB에 저장하지 않는다 — 교사가 프론트에서 승인해야
// assignment_responses.is_correct가 갱신된다(교사 승인 플로우).

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return handleOptions();
  }

  if (req.method !== 'POST') {
    return errorResponse('Method not allowed', 405);
  }

  try {
    const { responseId, userId, language } = await req.json();

    if (!responseId || !userId) {
      return errorResponse('Missing required fields: responseId, userId', 400);
    }

    const supabase = createServiceSupabaseClient();

    // 1. 학생 응답 조회
    const { data: studentResponse, error: rError } = await supabase
      .from('assignment_responses')
      .select('id, answer, problem_id, assignment_id')
      .eq('id', responseId)
      .single();
    if (rError || !studentResponse) {
      return errorResponse('Response not found', 404);
    }

    // 2. 권한 검증 — service role로 조회하므로 과제 작성자만 허용하도록 직접 확인
    const { data: assignment, error: aError } = await supabase
      .from('shared_assignments')
      .select('created_by')
      .eq('id', studentResponse.assignment_id)
      .single();
    if (aError || !assignment) {
      return errorResponse('Assignment not found', 404);
    }
    if (assignment.created_by !== userId) {
      return errorResponse('Only the assignment creator can request AI grading', 403);
    }

    const studentAnswer = String(studentResponse.answer || '').trim();
    if (!studentAnswer) {
      return errorResponse('Response has no answer to grade', 400);
    }

    // 3. 문제 조회
    const { data: problem, error: pError } = await supabase
      .from('generated_problems')
      .select('stem, passage, guidelines, correct_answer, explanation, problem_type')
      .eq('id', studentResponse.problem_id)
      .single();
    if (pError || !problem) {
      return errorResponse('Problem not found', 404);
    }

    // 4. AI 채점 (사용자 BYOK 키가 있으면 우선, 없으면 시스템 키 폴백)
    const userKey = await getActiveUserKey(supabase, userId);
    const { ai, provider } = createAIClient(GoogleGenAI, userKey);
    const sessionId = `grade-essay-${userId}-${Date.now()}`;
    console.log('Grading essay response', { responseId, provider });

    const isEnglish = language === 'en';
    const prompt = isEnglish
      ? `
You are an English teacher grading a student's written answer.

## Problem
${problem.passage ? `- **Passage**: ${problem.passage}\n` : ''}- **Question**: ${problem.stem}
${problem.guidelines ? `- **Grading Guidelines**: ${problem.guidelines}\n` : ''}${problem.correct_answer ? `- **Model Answer**: ${problem.correct_answer}\n` : ''}${problem.explanation ? `- **Explanation**: ${problem.explanation}\n` : ''}
## Student's Answer
${studentAnswer}

## Task
Judge whether the student's answer is acceptable.
- "correct": clearly satisfies the question (and guidelines/model answer if given)
- "incorrect": clearly fails to satisfy them
- "uncertain": partially correct, ambiguous, or you cannot judge confidently

Give brief feedback (2-3 sentences) explaining your judgement, written for the teacher.

## Output Format
\`\`\`json
{
  "verdict": "correct | incorrect | uncertain",
  "feedback": "2-3 sentence explanation in English"
}
\`\`\`
`
      : `
당신은 학생의 서술형 답안을 채점하는 영어 교사입니다.

## 문제
${problem.passage ? `- **지문**: ${problem.passage}\n` : ''}- **문항**: ${problem.stem}
${problem.guidelines ? `- **채점 기준**: ${problem.guidelines}\n` : ''}${problem.correct_answer ? `- **모범 답안**: ${problem.correct_answer}\n` : ''}${problem.explanation ? `- **해설**: ${problem.explanation}\n` : ''}
## 학생 답안
${studentAnswer}

## 작업
학생 답안이 인정 가능한지 판정하세요.
- "correct": 문항(및 채점 기준·모범 답안이 있으면 그것)을 명확히 충족
- "incorrect": 명확히 미충족
- "uncertain": 부분 정답이거나 애매하여 확신할 수 없음

교사가 읽을 판정 근거를 2~3문장으로 작성하세요.

## 출력 형식
\`\`\`json
{
  "verdict": "correct | incorrect | uncertain",
  "feedback": "2~3문장 판정 근거 (한국어)"
}
\`\`\`
`;

    const modelName = MODEL_SEQUENCE[0];
    const result = await generateWithRetry({
      ai,
      model: modelName,
      contents: { parts: [{ text: prompt }] },
      sessionId,
      maxRetries: 2,
      baseDelayMs: 2000,
      temperature: 0.2,
    });

    const responseText = await extractTextFromResponse(result.response, modelName);
    const parsed: any = parseJsonResponse(responseText, modelName);

    if (!parsed || typeof parsed !== 'object' || !parsed.verdict) {
      throw new Error('Invalid response format from AI');
    }
    const verdict = ['correct', 'incorrect', 'uncertain'].includes(parsed.verdict)
      ? parsed.verdict
      : 'uncertain';

    if (result.usageMetadata) {
      await logAiUsage({
        supabase,
        userId,
        functionName: 'grade-essay',
        modelUsed: modelName,
        usageMetadata: result.usageMetadata,
        metadata: { responseId },
      });
    }

    return jsonResponse({
      success: true,
      grading: {
        verdict,
        feedback: parsed.feedback || '',
      },
    });

  } catch (error: any) {
    console.error('Error in grade-essay function:', error);
    return errorResponse(
      error.message || 'Internal server error',
      500,
      summarizeError(error)
    );
  }
});
