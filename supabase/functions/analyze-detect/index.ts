import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { GoogleGenAI } from "https://esm.sh/@google/genai@1.21.0"
import { createServiceSupabaseClient } from '../_shared/supabaseClient.ts'
import { errorResponse, handleOptions, jsonResponse } from '../_shared/http.ts'
import { createAIClient } from '../_shared/aiClientFactory.ts'

// 분석 모듈 (analyze-image의 공유 모듈 참조)
import { detectHandwritingFromCroppedImages } from '../analyze-image/_shared/analysisProcessor.ts'
import { buildCroppedUserAnswerPrompt, buildCroppedCorrectAnswerPrompt } from '../analyze-image/_shared/prompts.ts'

// ─── Edge Function 라이프사이클 이벤트 핸들러 ──────────────────
addEventListener('beforeunload', (ev: any) => {
  console.warn('[analyze-detect] Edge Function shutting down', {
    reason: ev.detail?.reason || 'unknown',
  });
});

addEventListener('unhandledrejection', (ev: any) => {
  console.error('[analyze-detect] Unhandled promise rejection:', ev.reason);
  ev.preventDefault();
});

/**
 * analyze-detect: Pass B 전용 Edge Function
 *
 * 클라이언트에서 Canvas로 크롭된 이미지를 받아
 * user_answer(필기 인식) + correct_answer(정답 추론)를 수행한다.
 *
 * 입력: { sessionId, userId, language, pages: [{ answerAreaCrops, fullCrops }] }
 * 출력: { success, pages: [{ marks: [{ problem_number, user_answer, correct_answer }] }] }
 */
serve(async (req) => {
  if (req.method === 'OPTIONS') return handleOptions();
  if (req.method !== 'POST') return errorResponse('Method not allowed', 405);

  try {
    const requestData = await req.json();
    const { sessionId, pages: pagesData } = requestData;

    if (!sessionId || !pagesData || !Array.isArray(pagesData)) {
      return errorResponse('analyze-detect requires sessionId and pages[]', 400);
    }

    console.log(`[analyze-detect] Starting Pass B for session ${sessionId}, ${pagesData.length} pages`);

    const { ai } = createAIClient(GoogleGenAI);

    // 각 페이지의 크롭 이미지에 대해 Pass B 수행
    const resultPages: any[] = [];

    for (let i = 0; i < pagesData.length; i++) {
      const page = pagesData[i];
      const answerAreaCrops = page.answerAreaCrops || [];
      const fullCrops = page.fullCrops || [];

      if (answerAreaCrops.length === 0 && fullCrops.length === 0) {
        console.warn(`[analyze-detect] Page ${i + 1}: No crops, skipping`);
        resultPages.push({ marks: [] });
        continue;
      }

      console.log(`[analyze-detect] Page ${i + 1}: ${answerAreaCrops.length} answer + ${fullCrops.length} full crops`);

      try {
        // user_answer + correct_answer 병렬 요청
        const [userAnswerResult, correctAnswerResult] = await Promise.all([
          answerAreaCrops.length > 0
            ? detectHandwritingFromCroppedImages({
                ai, sessionId,
                croppedImages: answerAreaCrops,
                buildPromptFn: buildCroppedUserAnswerPrompt,
              })
            : Promise.resolve({ marks: [], usageMetadata: undefined }),
          fullCrops.length > 0
            ? detectHandwritingFromCroppedImages({
                ai, sessionId,
                croppedImages: fullCrops,
                buildPromptFn: buildCroppedCorrectAnswerPrompt,
              })
            : Promise.resolve({ marks: [], usageMetadata: undefined }),
        ]);

        // user_answer + correct_answer 병합
        const mergedMarks: any[] = userAnswerResult.marks.map((ua: any) => {
          const ca = correctAnswerResult.marks.find((m: any) => m.problem_number === ua.problem_number);
          return {
            problem_number: ua.problem_number,
            user_answer: ua.user_answer,
            correct_answer: ca?.correct_answer ?? null,
          };
        });

        // correct_answer만 있고 user_answer가 없는 경우 추가
        for (const ca of correctAnswerResult.marks) {
          if (!mergedMarks.find((m: any) => m.problem_number === ca.problem_number)) {
            mergedMarks.push({
              problem_number: ca.problem_number,
              user_answer: null,
              correct_answer: ca.correct_answer,
            });
          }
        }

        console.log(`[analyze-detect] Page ${i + 1}: ${mergedMarks.length} marks merged`);
        resultPages.push({ marks: mergedMarks });
      } catch (pageError: any) {
        console.error(`[analyze-detect] Page ${i + 1} error:`, pageError?.message);
        resultPages.push({ marks: [] });
      }
    }

    console.log(`[analyze-detect] Done. Returning marks for ${resultPages.length} pages`);

    return jsonResponse({
      success: true,
      sessionId,
      pages: resultPages,
    });
  } catch (error: any) {
    console.error('[analyze-detect] Error:', error?.message);
    return errorResponse(error?.message || 'Internal server error', 500);
  }
});
