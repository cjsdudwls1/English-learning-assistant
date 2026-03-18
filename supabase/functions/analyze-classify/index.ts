import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { GoogleGenAI } from "https://esm.sh/@google/genai@1.21.0"
import { createServiceSupabaseClient } from '../_shared/supabaseClient.ts'
import { errorResponse, handleOptions, jsonResponse } from '../_shared/http.ts'
import { loadTaxonomyData } from '../_shared/taxonomy.ts'
import { createAIClient } from '../_shared/aiClientFactory.ts'
import {
  StageError,
  markSessionFailed,
  type FailureStage
} from '../_shared/errors.ts'
import { logAiUsage } from '../_shared/usageLogger.ts'

// 분석 파이프라인 모듈 (analyze-image의 공유 모듈 참조)
import { classifyItems } from '../analyze-image/_shared/analysisProcessor.ts'
import { buildClassificationPrompt } from '../analyze-image/_shared/prompts.ts'
import { buildTaxonomyLookup } from '../analyze-image/_shared/taxonomyLoader.ts'
import { completeSession, validateVertexAuth } from '../analyze-image/_shared/sessionManager.ts'
import { saveProblems } from '../analyze-image/_shared/problemSaver.ts'
import { buildLabelsPayload } from '../analyze-image/_shared/labelProcessor.ts'

// ─── Edge Function 라이프사이클 이벤트 핸들러 ──────────────────
addEventListener('beforeunload', (ev: any) => {
  console.warn('[analyze-classify] Edge Function shutting down', {
    reason: ev.detail?.reason || 'unknown',
  });
});

addEventListener('unhandledrejection', (ev: any) => {
  console.error('[analyze-classify] Unhandled promise rejection:', ev.reason);
  ev.preventDefault();
});

/**
 * analyze-classify: Pass C + DB 저장 전용 Edge Function
 *
 * Pass B에서 반환된 marks가 병합된 pageItems를 받아
 * 분류(Pass C) 수행 후 problems, labels, metadata를 DB에 저장하고 세션 완료.
 *
 * 입력: { sessionId, userId, language, pages: [{ pageItems, pageModel }] }
 * 출력: { success, sessionId, message } (백그라운드 처리)
 */
serve(async (req) => {
  if (req.method === 'OPTIONS') return handleOptions();
  if (req.method !== 'POST') return errorResponse('Method not allowed', 405);

  const supabase = createServiceSupabaseClient();
  let sessionId: string | undefined;

  try {
    const requestData = await req.json();
    sessionId = requestData.sessionId as string;
    const userId = requestData.userId as string;
    const pagesData = requestData.pages as any[];
    const language = requestData.language as string;

    if (!sessionId || !userId || !pagesData || !Array.isArray(pagesData)) {
      return errorResponse('analyze-classify requires sessionId, userId, and pages[]', 400);
    }

    const userLanguage: 'ko' | 'en' = language === 'en' ? 'en' : 'ko';
    console.log(`[analyze-classify] Starting Pass C + DB save for session ${sessionId}, ${pagesData.length} pages`);

    const { ai, provider: aiProvider } = createAIClient(GoogleGenAI);

    const response = jsonResponse({
      success: true,
      sessionId,
      message: 'Classification started in background',
    });

    // ── 백그라운드 작업 ──────────────────────────────────────
    const backgroundTask = (async () => {
      try {
        if (aiProvider === 'vertex') {
          await validateVertexAuth({ supabase, sessionId: sessionId! });
        }

        const taxonomyData = await loadTaxonomyData(supabase, userLanguage);
        const { taxonomyByDepthKey, taxonomyByCode } = await buildTaxonomyLookup({
          supabase, userLanguage, sessionId: sessionId!,
        });

        let allValidatedItems: any[] = [];
        let finalUsedModel: string = '';
        let totalUsage: any = {};

        for (let i = 0; i < pagesData.length; i++) {
          const page = pagesData[i];
          const pageItems = page.pageItems || [];
          if (pageItems.length === 0) continue;

          finalUsedModel = page.pageModel || finalUsedModel;

          // ─── Pass C: 분류 ───
          const itemsSummary = pageItems.map((it: any, idx: number) =>
            `[${idx}] Q${it.problem_number}: ${it.question_text?.substring(0, 80) || '(no text)'}`
          ).join('\n');

          const classificationPrompt = buildClassificationPrompt(taxonomyData, itemsSummary, userLanguage);

          console.log(`[analyze-classify] Page ${i + 1}: Classifying ${pageItems.length} items`);

          const classificationResult = await classifyItems({
            ai, sessionId: sessionId!,
            prompt: classificationPrompt,
          });

          // 분류 결과를 pageItems에 병합
          for (const cls of classificationResult.classifications) {
            const item = pageItems.find((it: any) => it.problem_number === cls.problem_number);
            if (item) {
              item.classification = cls.classification;
              item.metadata = cls.metadata;
            }
          }

          allValidatedItems.push(...pageItems);

          if (classificationResult.usageMetadata) {
            totalUsage.promptTokenCount = (totalUsage.promptTokenCount || 0) + (classificationResult.usageMetadata.promptTokenCount || 0);
            totalUsage.candidatesTokenCount = (totalUsage.candidatesTokenCount || 0) + (classificationResult.usageMetadata.candidatesTokenCount || 0);
            totalUsage.totalTokenCount = (totalUsage.totalTokenCount || 0) + (classificationResult.usageMetadata.totalTokenCount || 0);
          }

          console.log(`[analyze-classify] Page ${i + 1}: ${classificationResult.classifications.length} classifications`);
        }

        if (allValidatedItems.length === 0) {
          await markSessionFailed({
            supabase, sessionId,
            stage: 'extract_empty',
            error: new Error('Pass C produced 0 items'),
            extra: { usedModel: finalUsedModel },
          });
          return;
        }

        // Step 4: 문제 DB 저장
        const saveResult = await saveProblems({ supabase, sessionId: sessionId!, items: allValidatedItems });
        if (!saveResult) return;
        const { problems } = saveResult;

        // Step 5: Labels 저장
        const validLabelsPayload = await buildLabelsPayload({
          items: allValidatedItems, problems,
          taxonomyByDepthKey, taxonomyByCode, sessionId: sessionId!,
        });
        if (validLabelsPayload.length > 0) {
          const { error: labelsError } = await supabase.from('labels').insert(validLabelsPayload);
          if (labelsError) throw new StageError('insert_labels', 'Labels insert failed', { count: validLabelsPayload.length });
        }

        // Step 6: 메타데이터 저장
        for (const p of problems) {
          const originalItem = allValidatedItems[p.index_in_image];
          if (!originalItem) continue;
          const meta = originalItem.metadata || {};
          const cls = originalItem.classification || {};
          const typeParts = [cls.depth1, cls.depth2, cls.depth3, cls.depth4]
            .filter((v: any) => typeof v === 'string' && v.trim().length > 0) as string[];
          const problemType = typeParts.length > 0 ? typeParts.join(' - ') : (userLanguage === 'ko' ? '분류 없음' : 'Unclassified');
          let difficulty = meta.difficulty;
          if (userLanguage === 'en') {
            if (!['high', 'medium', 'low'].includes(difficulty || '')) {
              difficulty = difficulty === '상' ? 'high' : difficulty === '중' ? 'medium' : difficulty === '하' ? 'low' : 'medium';
            }
          } else {
            if (!['상', '중', '하'].includes(difficulty || '')) {
              difficulty = difficulty === 'high' ? '상' : difficulty === 'medium' ? '중' : difficulty === 'low' ? '하' : '중';
            }
          }
          const wdNum = Number(meta.word_difficulty);
          const wordDifficulty = (!isNaN(wdNum) && wdNum >= 1 && wdNum <= 9) ? Math.round(wdNum) : 5;
          await supabase.from('problems').update({
            problem_metadata: { difficulty, word_difficulty: wordDifficulty, problem_type: problemType, analysis: meta.analysis || '' }
          }).eq('id', p.id);
        }

        // Step 7: 세션 완료
        await completeSession({ supabase, sessionId: sessionId!, usedModel: finalUsedModel });

        // Step 8: 토큰 사용량 로깅
        if (totalUsage.totalTokenCount) {
          await logAiUsage({
            supabase, userId,
            functionName: 'analyze-classify',
            modelUsed: finalUsedModel,
            usageMetadata: totalUsage,
            sessionId,
            metadata: { pageCount: pagesData.length, problemCount: allValidatedItems.length },
          });
        }

        console.log(`[analyze-classify] Completed successfully for session: ${sessionId}`);
      } catch (bgError: any) {
        console.error(`[analyze-classify] Background error for session ${sessionId}:`, bgError?.message);
        const stage: FailureStage = bgError instanceof StageError ? bgError.stage : 'unknown';
        await markSessionFailed({
          supabase, sessionId,
          stage, error: bgError,
          extra: bgError instanceof StageError ? bgError.details : undefined,
        });
      }
    })();

    if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime.waitUntil) {
      EdgeRuntime.waitUntil(backgroundTask);
    } else {
      await backgroundTask;
    }

    return response;
  } catch (error: any) {
    console.error('[analyze-classify] Error:', error?.message);
    if (supabase && sessionId) {
      await markSessionFailed({ supabase, sessionId, stage: 'request', error });
    }
    return errorResponse(error?.message || 'Internal server error', 500);
  }
});
