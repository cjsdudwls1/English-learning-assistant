import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { GoogleGenAI } from "https://esm.sh/@google/genai@1.21.0"
import { createServiceSupabaseClient } from '../_shared/supabaseClient.ts'
import { errorResponse, handleOptions, jsonResponse } from '../_shared/http.ts'
import { loadTaxonomyData } from '../_shared/taxonomy.ts'
import { createAIClient } from '../_shared/aiClientFactory.ts'

// 에러 처리 모듈
import {
  StageError,
  markSessionFailed,
  type FailureStage
} from '../_shared/errors.ts'

// 분석 파이프라인 모듈
import { parseAnalyzeRequest } from './_shared/requestParser.ts'
import { uploadImages } from './_shared/imageUploader.ts'
import { createSession, completeSession, validateVertexAuth } from './_shared/sessionManager.ts'
import { buildTaxonomyLookup } from './_shared/taxonomyLoader.ts'
import { analyzeOnePage } from './_shared/pageAnalyzer.ts'
import { saveProblems } from './_shared/problemSaver.ts'

// Labels 생성 모듈
import { buildLabelsPayload } from './_shared/labelProcessor.ts'



// 토큰 사용량 로깅 모듈
import { logAiUsage } from '../_shared/usageLogger.ts'


// ─── Edge Function 라이프사이클 이벤트 핸들러 ──────────────────
// Supabase 공식 문서 권장: beforeunload로 shutdown 사유 감지
// https://supabase.com/docs/guides/functions/background-tasks
addEventListener('beforeunload', (ev: any) => {
  console.warn('[Lifecycle] Edge Function shutting down', {
    reason: ev.detail?.reason || 'unknown',
  });
});

addEventListener('unhandledrejection', (ev: any) => {
  console.error('[Lifecycle] Unhandled promise rejection:', ev.reason);
  ev.preventDefault();
});

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return handleOptions();
  }

  if (req.method !== 'POST') {
    return errorResponse('Method not allowed', 405);
  }

  let supabase = createServiceSupabaseClient();
  let createdSessionId: string | undefined;

  try {
    console.log('Edge Function called:', {
      method: req.method,
      url: req.url,
      hasBody: !!req.body,
    });

    // ── 요청 파싱 ──────────────────────────────────────────
    let requestData: any;
    try {
      requestData = await req.json();
      console.log('Request body parsed successfully');
    } catch (parseError: any) {
      console.error('Failed to parse request body:', parseError);
      return errorResponse(`Failed to parse request body: ${parseError.message}`, 400);
    }

    const { imageList, userId, language, preferredModel } = parseAnalyzeRequest(requestData);

    // ── AI 클라이언트 생성 + 언어 설정 ─────────────────────
    const { ai, provider: aiProvider } = createAIClient(GoogleGenAI);
    console.log('[analyze-image] AI provider:', aiProvider);

    let userLanguage: 'ko' | 'en' = language === 'en' ? 'en' : 'ko';

    if (!language) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('language')
        .eq('user_id', userId)
        .single();

      if (profile?.language === 'ko' || profile?.language === 'en') {
        userLanguage = profile.language as 'ko' | 'en';
      }
    }

    // ── Step 1: 이미지 Storage 업로드 ──────────────────────
    const imageUrls = await uploadImages({ supabase, userId, imageList });

    // ── Step 2: 세션 생성 ──────────────────────────────────
    const { sessionId } = await createSession({ supabase, userId, imageUrls });
    createdSessionId = sessionId;

    // ── 즉시 응답 반환 (분석은 백그라운드에서 계속) ────────
    const response = jsonResponse({
      success: true,
      sessionId: createdSessionId,
      message: 'Session created, analysis in progress',
    });

    // ── 백그라운드 작업 정의 ────────────────────────────────
    const backgroundTask = (async () => {
      try {
        console.log(`[Background] Starting analysis for session ${createdSessionId}...`);

        // Vertex AI 인증 사전 검증
        if (aiProvider === 'vertex') {
          await validateVertexAuth({ supabase, sessionId: createdSessionId! });
        }

        // Step 3a: Taxonomy 데이터 로드
        console.log(`[Background] Step 3a: Loading taxonomy data...`, { language: userLanguage, sessionId: createdSessionId, imageCount: imageList.length });
        const taxonomyData = await loadTaxonomyData(supabase, userLanguage);
        const { taxonomyByDepthKey, taxonomyByCode } = await buildTaxonomyLookup({
          supabase,
          userLanguage,
          sessionId: createdSessionId!,
        });

        // Step 3: 페이지별 3-Pass 분석 (배치 병렬 — WASM 뮤텍스로 크롭 직렬화)
        const ANALYSIS_BATCH_SIZE = 3;
        console.log(`[Background] Step 3: Starting direct multimodal analysis for ${imageList.length} page(s) (batch size: ${ANALYSIS_BATCH_SIZE})...`, { sessionId: createdSessionId, pageCount: imageList.length });

        let allValidatedItems: any[] = [];
        let allSharedPassages: any[] = [];
        let finalUsedModel: string = '';
        let totalAnalysisUsageMetadata: any = {};

        for (let batchStart = 0; batchStart < imageList.length; batchStart += ANALYSIS_BATCH_SIZE) {
          const batchEnd = Math.min(batchStart + ANALYSIS_BATCH_SIZE, imageList.length);
          const batchIndices = Array.from({ length: batchEnd - batchStart }, (_, i) => batchStart + i);

          console.log(`[Background] Step 3: Processing batch (pages ${batchStart + 1}-${batchEnd})...`, { sessionId: createdSessionId });

          const batchResults = await Promise.all(batchIndices.map(idx => analyzeOnePage({
            ai,
            supabase,
            sessionId: createdSessionId!,
            imageData: imageList[idx],
            pageNum: idx + 1,
            totalPages: imageList.length,
            taxonomyData,
            taxonomyByDepthKey,
            taxonomyByCode,
            userLanguage,
            preferredModel,
          })));

          for (const result of batchResults) {
            if (!result) continue;
            allValidatedItems.push(...result.pageItems);
            if (result.pageResult?.shared_passages) {
              allSharedPassages.push(...result.pageResult.shared_passages);
            }
            finalUsedModel = result.pageModel;
            if (result.pageUsage) {
              totalAnalysisUsageMetadata.promptTokenCount = (totalAnalysisUsageMetadata.promptTokenCount || 0) + (result.pageUsage.promptTokenCount || 0);
              totalAnalysisUsageMetadata.candidatesTokenCount = (totalAnalysisUsageMetadata.candidatesTokenCount || 0) + (result.pageUsage.candidatesTokenCount || 0);
              totalAnalysisUsageMetadata.totalTokenCount = (totalAnalysisUsageMetadata.totalTokenCount || 0) + (result.pageUsage.totalTokenCount || 0);
            }
          }

          // 분석 완료된 페이지의 이미지 메모리 해제
          for (const idx of batchIndices) {
            if (imageList[idx]) (imageList[idx] as any).imageBase64 = '';
          }
        }

        const usedModel = finalUsedModel;
        const validatedItems = allValidatedItems;
        const analysisUsageMetadata = totalAnalysisUsageMetadata;

        console.log(`[Background] Step 3 completed: All pages analyzed`, {
          sessionId: createdSessionId,
          usedModel,
          totalItems: validatedItems.length,
          pagesProcessed: imageList.length,
        });

        // 0문항 실패 처리
        if (!validatedItems || validatedItems.length === 0) {
          if (imageList.length > 0) {
            console.error(`[Background] Step 3: ${imageList.length} page(s) provided but analysis produced 0 items`, { sessionId: createdSessionId, usedModel });
          }
          console.warn(`[Background] Step 3 result: 0 items extracted. Marking session as failed to avoid hallucination.`, { sessionId: createdSessionId, usedModel });
          await markSessionFailed({
            supabase,
            sessionId: createdSessionId,
            stage: 'extract_empty',
            error: new Error('No problems extracted (model returned empty items)'),
            extra: { usedModel },
          });
          return;
        }

        // Step 4: 문제 DB 저장
        const saveResult = await saveProblems({
          supabase,
          sessionId: createdSessionId!,
          items: validatedItems,
        });

        if (!saveResult) return; // 0문항 → 내부에서 이미 markSessionFailed 처리됨

        const { problems } = saveResult;

        // Step 5: Labels 저장
        console.log(`[Background] Step 5: Save AI analysis results to labels (pending user review)...`, { sessionId: createdSessionId, problemCount: problems.length });

        const validLabelsPayload = await buildLabelsPayload({
          items: validatedItems,
          problems,
          taxonomyByDepthKey,
          taxonomyByCode,
          sessionId: createdSessionId!,
        });

        if (validLabelsPayload.length === 0) {
          console.warn(`[Background] Step 5 warning: No valid labels to insert`, { sessionId: createdSessionId });
        } else {
          console.log(`[Background] Step 5: Inserting ${validLabelsPayload.length} labels...`, { sessionId: createdSessionId });
          const { error: labelsError } = await supabase.from('labels').insert(validLabelsPayload);
          if (labelsError) {
            console.error(`[Background] Step 5 error: Labels insert error`, { sessionId: createdSessionId, error: labelsError, validLabelsPayloadCount: validLabelsPayload.length });
            throw new StageError('insert_labels', 'Labels insert failed', { validLabelsPayloadCount: validLabelsPayload.length });
          }
        }

        console.log(`[Background] Step 5 completed: AI analysis results saved (pending user review)`, { sessionId: createdSessionId });

        // Step 6: 메타데이터 저장 (Pass C에서 이미 생성된 데이터 활용, AI 호출 불필요)
        console.log(`[Background] Step 6: Saving problem metadata from Pass C results...`, { sessionId: createdSessionId });

        if (problems.length > 0) {
          let metaSuccessCount = 0;
          let metaErrorCount = 0;

          for (const p of problems) {
            const originalItem = validatedItems[p.index_in_image];
            if (!originalItem) continue;

            const meta = originalItem.metadata || {};
            const cls = originalItem.classification || {};

            // problem_type 생성
            const typeParts = [
              cls.depth1, cls.depth2, cls.depth3, cls.depth4,
            ].filter((v: any) => typeof v === 'string' && v.trim().length > 0) as string[];
            const problemType = typeParts.length > 0
              ? typeParts.join(' - ')
              : (userLanguage === 'ko' ? '분류 없음' : 'Unclassified');

            // 난이도 정규화
            let difficulty = meta.difficulty;
            if (userLanguage === 'en') {
              const valid = ['high', 'medium', 'low'];
              if (!valid.includes(difficulty || '')) {
                if (difficulty === '상') difficulty = 'high';
                else if (difficulty === '중') difficulty = 'medium';
                else if (difficulty === '하') difficulty = 'low';
                else difficulty = 'medium';
              }
            } else {
              const valid = ['상', '중', '하'];
              if (!valid.includes(difficulty || '')) {
                if (difficulty === 'high') difficulty = '상';
                else if (difficulty === 'medium') difficulty = '중';
                else if (difficulty === 'low') difficulty = '하';
                else difficulty = '중';
              }
            }

            // 단어 난이도 1-9
            const wdNum = Number(meta.word_difficulty);
            const wordDifficulty = (!isNaN(wdNum) && wdNum >= 1 && wdNum <= 9) ? Math.round(wdNum) : 5;

            const { error: updateError } = await supabase
              .from('problems')
              .update({
                problem_metadata: {
                  difficulty,
                  word_difficulty: wordDifficulty,
                  problem_type: problemType,
                  analysis: meta.analysis || '',
                }
              })
              .eq('id', p.id);

            if (updateError) {
              console.error(`[Background] Step 6: Error updating metadata for problem ${p.id}:`, updateError, { sessionId: createdSessionId });
              metaErrorCount++;
            } else {
              metaSuccessCount++;
            }
          }

          console.log(`[Background] Step 6 completed: Metadata saved for ${metaSuccessCount}/${problems.length} problems (${metaErrorCount} errors)`, { sessionId: createdSessionId });
        }

        // Step 7: 세션 완료 업데이트
        await completeSession({ supabase, sessionId: createdSessionId!, usedModel });

        // Step 8: 토큰 사용량 로깅
        if (analysisUsageMetadata) {
          await logAiUsage({
            supabase,
            userId,
            functionName: 'analyze-image',
            modelUsed: usedModel,
            usageMetadata: analysisUsageMetadata,
            sessionId: createdSessionId,
            metadata: {
              imageCount: imageList.length,
              problemCount: validatedItems.length,
            },
          });
        }

        console.log(`[Background] Background analysis completed successfully for session: ${createdSessionId}`);
      } catch (bgError: any) {
        console.error(`[Background] Background analysis error for session ${createdSessionId}:`, {
          error: bgError,
          errorMessage: bgError?.message,
          errorStack: bgError?.stack,
          errorName: bgError?.name,
          errorCause: bgError?.cause,
        });

        const stage: FailureStage = bgError instanceof StageError ? bgError.stage : 'unknown';
        await markSessionFailed({
          supabase,
          sessionId: createdSessionId,
          stage,
          error: bgError,
          extra: bgError instanceof StageError ? bgError.details : undefined,
        });
      }
    })();

    // EdgeRuntime.waitUntil로 백그라운드 작업이 끝날 때까지 기다리게 합니다.
    // EarlyDrop 방지: waitUntil을 먼저 등록한 후 응답을 반환해야 합니다.
    if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime.waitUntil) {
      EdgeRuntime.waitUntil(backgroundTask);
      console.log('[Lifecycle] Background task registered with waitUntil');
    } else {
      console.warn('EdgeRuntime.waitUntil not available; awaiting background task to avoid partial writes');
      await backgroundTask;
    }

    return response;
  } catch (error: any) {
    console.error('Error in analyze-image function:', error);

    if (supabase && typeof createdSessionId !== 'undefined') {
      await markSessionFailed({
        supabase,
        sessionId: createdSessionId,
        stage: 'request',
        error,
      });
    }

    return errorResponse(error.message || 'Internal server error', 500, error.toString());
  }
});
