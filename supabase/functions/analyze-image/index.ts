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
import { analyzeOnePage, extractStructureAndBboxes, analyzeWithCroppedImages } from './_shared/pageAnalyzer.ts'
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
    const mode = requestData.mode as string | undefined; // 'extract' | 'analyze' | undefined(하위호환)

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

    // ══════════════════════════════════════════════════════════
    // MODE 분기: extract / analyze / 기존(하위호환)
    // ══════════════════════════════════════════════════════════

    if (mode === 'extract') {
      // ── MODE: EXTRACT ─────────────────────────────────────
      // Pass A(구조 추출) + Pass 0(좌표 추출)만 동기 수행 후 즉시 반환.
      // 이미지 크롭은 하지 않으므로 CPU Time 부담이 없다.
      console.log(`[mode: extract] Starting for ${imageList.length} page(s)`);

      // Step 1: 이미지 Storage 업로드
      const imageUrls = await uploadImages({ supabase, userId, imageList });

      // Step 2: 세션 생성
      const { sessionId } = await createSession({ supabase, userId, imageUrls });
      createdSessionId = sessionId;

      // Vertex AI 인증 사전 검증
      if (aiProvider === 'vertex') {
        await validateVertexAuth({ supabase, sessionId: createdSessionId! });
      }

      // Taxonomy 데이터 로드
      const taxonomyData = await loadTaxonomyData(supabase, userLanguage);
      const { taxonomyByDepthKey, taxonomyByCode } = await buildTaxonomyLookup({
        supabase, userLanguage, sessionId: createdSessionId!,
      });

      // Pass A + Pass 0 (순차 — 각 페이지를 순서대로 처리하여 CPU 분산)
      const pagesExtract: any[] = [];
      for (let i = 0; i < imageList.length; i++) {
        const result = await extractStructureAndBboxes({
          ai, supabase, sessionId: createdSessionId!,
          imageData: imageList[i],
          pageNum: i + 1, totalPages: imageList.length,
          taxonomyData, taxonomyByDepthKey, taxonomyByCode,
          userLanguage, preferredModel,
        });
        pagesExtract.push({
          pageNum: i + 1,
          pageItems: result?.pageItems ?? [],
          bboxes: result?.bboxes ?? [],
          pageModel: result?.pageModel ?? '',
        });
        // 이미지 메모리 즉시 해제
        (imageList[i] as any).imageBase64 = '';
      }

      console.log(`[mode: extract] Done. Returning structure + bboxes for ${pagesExtract.length} pages`, { sessionId: createdSessionId });

      // 세션 상태를 'extracting' (중간 상태)으로 업데이트
      await supabase.from('sessions').update({ status: 'extracting' }).eq('id', createdSessionId);

      return jsonResponse({
        success: true,
        sessionId: createdSessionId,
        mode: 'extract',
        pages: pagesExtract,
      });

    } else if (mode === 'analyze') {
      // ── MODE: ANALYZE ─────────────────────────────────────
      // 클라이언트에서 크롭된 이미지를 수신하여 Pass B + C + DB 저장 수행.
      // 백그라운드로 처리한다.
      const sessionId = requestData.sessionId as string;
      const pagesData = requestData.pages as any[];

      if (!sessionId || !pagesData || !Array.isArray(pagesData)) {
        return errorResponse('mode:analyze requires sessionId and pages[]', 400);
      }

      createdSessionId = sessionId;
      console.log(`[mode: analyze] Starting Pass B+C for session ${sessionId}, ${pagesData.length} pages`);

      const response = jsonResponse({
        success: true,
        sessionId,
        mode: 'analyze',
        message: 'Analysis started in background',
      });

      const backgroundTask = (async () => {
        try {
          // Vertex AI 인증 사전 검증
          if (aiProvider === 'vertex') {
            await validateVertexAuth({ supabase, sessionId });
          }

          const taxonomyData = await loadTaxonomyData(supabase, userLanguage);
          const { taxonomyByDepthKey, taxonomyByCode } = await buildTaxonomyLookup({
            supabase, userLanguage, sessionId,
          });

          let allValidatedItems: any[] = [];
          let finalUsedModel: string = '';
          let totalUsage: any = {};

          for (const pageData of pagesData) {
            const { pageItems, answerAreaCrops, fullCrops, pageModel } = pageData;
            if (!pageItems || pageItems.length === 0) continue;

            finalUsedModel = pageModel || finalUsedModel;

            const result = await analyzeWithCroppedImages({
              ai, supabase, sessionId,
              pageItems,
              answerAreaCrops: answerAreaCrops || [],
              fullCrops: fullCrops || [],
              taxonomyData, userLanguage,
            });

            if (result) {
              // Pass B 결과를 pageItems에 병합
              for (const item of pageItems) {
                const mark = result.marks.find((m: any) => m.problem_number === item.problem_number);
                if (mark) {
                  item.user_answer = mark.user_answer;
                  item.correct_answer = mark.correct_answer;
                }
                const cls = result.classifications.find((c: any) => c.problem_number === item.problem_number);
                if (cls) {
                  item.classification = cls.classification;
                  item.metadata = cls.metadata;
                }
              }
              allValidatedItems.push(...pageItems);

              if (result.usageMetadata) {
                totalUsage.promptTokenCount = (totalUsage.promptTokenCount || 0) + (result.usageMetadata.promptTokenCount || 0);
                totalUsage.candidatesTokenCount = (totalUsage.candidatesTokenCount || 0) + (result.usageMetadata.candidatesTokenCount || 0);
                totalUsage.totalTokenCount = (totalUsage.totalTokenCount || 0) + (result.usageMetadata.totalTokenCount || 0);
              }
            }
          }

          if (allValidatedItems.length === 0) {
            await markSessionFailed({
              supabase, sessionId,
              stage: 'extract_empty',
              error: new Error('Pass B+C produced 0 items'),
              extra: { usedModel: finalUsedModel },
            });
            return;
          }

          // Step 4: 문제 DB 저장
          const saveResult = await saveProblems({ supabase, sessionId, items: allValidatedItems });
          if (!saveResult) return;
          const { problems } = saveResult;

          // Step 5: Labels 저장
          const validLabelsPayload = await buildLabelsPayload({
            items: allValidatedItems, problems,
            taxonomyByDepthKey, taxonomyByCode, sessionId,
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
              if (!['high','medium','low'].includes(difficulty||'')) difficulty = difficulty==='상'?'high':difficulty==='중'?'medium':difficulty==='하'?'low':'medium';
            } else {
              if (!['상','중','하'].includes(difficulty||'')) difficulty = difficulty==='high'?'상':difficulty==='medium'?'중':difficulty==='low'?'하':'중';
            }
            const wdNum = Number(meta.word_difficulty);
            const wordDifficulty = (!isNaN(wdNum) && wdNum >= 1 && wdNum <= 9) ? Math.round(wdNum) : 5;
            await supabase.from('problems').update({ problem_metadata: { difficulty, word_difficulty: wordDifficulty, problem_type: problemType, analysis: meta.analysis || '' } }).eq('id', p.id);
          }

          // Step 7: 세션 완료
          await completeSession({ supabase, sessionId, usedModel: finalUsedModel });

          // Step 8: 토큰 사용량 로깅
          if (totalUsage.totalTokenCount) {
            await logAiUsage({ supabase, userId, functionName: 'analyze-image', modelUsed: finalUsedModel, usageMetadata: totalUsage, sessionId, metadata: { imageCount: pagesData.length, problemCount: allValidatedItems.length } });
          }

          console.log(`[mode: analyze] Background analysis completed for session: ${sessionId}`);
        } catch (bgError: any) {
          console.error(`[mode: analyze] Background error for session ${sessionId}:`, bgError?.message);
          const stage: FailureStage = bgError instanceof StageError ? bgError.stage : 'unknown';
          await markSessionFailed({ supabase, sessionId, stage, error: bgError, extra: bgError instanceof StageError ? bgError.details : undefined });
        }
      })();

      if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime.waitUntil) {
        EdgeRuntime.waitUntil(backgroundTask);
      } else {
        await backgroundTask;
      }

      return response;

    } else {
      // ── MODE: 기존 (하위 호환) ────────────────────────────
      // mode 파라미터 없음 → 기존 1단계 파이프라인 (서버 크롭 포함)
      console.log(`[mode: legacy] Starting legacy pipeline for ${imageList.length} page(s)`);

      const imageUrls = await uploadImages({ supabase, userId, imageList });
      const { sessionId } = await createSession({ supabase, userId, imageUrls });
      createdSessionId = sessionId;

      const response = jsonResponse({
        success: true,
        sessionId: createdSessionId,
        message: 'Session created, analysis in progress',
      });

      const backgroundTask = (async () => {
        try {
          console.log(`[Background] Starting analysis for session ${createdSessionId}...`);

          if (aiProvider === 'vertex') {
            await validateVertexAuth({ supabase, sessionId: createdSessionId! });
          }

          console.log(`[Background] Step 3a: Loading taxonomy data...`, { language: userLanguage, sessionId: createdSessionId, imageCount: imageList.length });
          const taxonomyData = await loadTaxonomyData(supabase, userLanguage);
          const { taxonomyByDepthKey, taxonomyByCode } = await buildTaxonomyLookup({
            supabase, userLanguage, sessionId: createdSessionId!,
          });

          const ANALYSIS_BATCH_SIZE = 3;
          console.log(`[Background] Step 3: Starting analysis for ${imageList.length} page(s) (batch size: ${ANALYSIS_BATCH_SIZE})...`, { sessionId: createdSessionId });

          let allValidatedItems: any[] = [];
          let allSharedPassages: any[] = [];
          let finalUsedModel: string = '';
          let totalAnalysisUsageMetadata: any = {};

          for (let batchStart = 0; batchStart < imageList.length; batchStart += ANALYSIS_BATCH_SIZE) {
            const batchEnd = Math.min(batchStart + ANALYSIS_BATCH_SIZE, imageList.length);
            const batchIndices = Array.from({ length: batchEnd - batchStart }, (_, i) => batchStart + i);

            const batchResults = await Promise.all(batchIndices.map(idx => analyzeOnePage({
              ai, supabase, sessionId: createdSessionId!,
              imageData: imageList[idx], pageNum: idx + 1, totalPages: imageList.length,
              taxonomyData, taxonomyByDepthKey, taxonomyByCode, userLanguage, preferredModel,
            })));

            for (const result of batchResults) {
              if (!result) continue;
              allValidatedItems.push(...result.pageItems);
              if (result.pageResult?.shared_passages) allSharedPassages.push(...result.pageResult.shared_passages);
              finalUsedModel = result.pageModel;
              if (result.pageUsage) {
                totalAnalysisUsageMetadata.promptTokenCount = (totalAnalysisUsageMetadata.promptTokenCount || 0) + (result.pageUsage.promptTokenCount || 0);
                totalAnalysisUsageMetadata.candidatesTokenCount = (totalAnalysisUsageMetadata.candidatesTokenCount || 0) + (result.pageUsage.candidatesTokenCount || 0);
                totalAnalysisUsageMetadata.totalTokenCount = (totalAnalysisUsageMetadata.totalTokenCount || 0) + (result.pageUsage.totalTokenCount || 0);
              }
            }

            for (const idx of batchIndices) {
              if (imageList[idx]) (imageList[idx] as any).imageBase64 = '';
            }
          }

          const usedModel = finalUsedModel;
          const validatedItems = allValidatedItems;
          const analysisUsageMetadata = totalAnalysisUsageMetadata;

          if (!validatedItems || validatedItems.length === 0) {
            await markSessionFailed({ supabase, sessionId: createdSessionId, stage: 'extract_empty', error: new Error('No problems extracted'), extra: { usedModel } });
            return;
          }

          const saveResult = await saveProblems({ supabase, sessionId: createdSessionId!, items: validatedItems });
          if (!saveResult) return;
          const { problems } = saveResult;

          const validLabelsPayload = await buildLabelsPayload({ items: validatedItems, problems, taxonomyByDepthKey, taxonomyByCode, sessionId: createdSessionId! });
          if (validLabelsPayload.length > 0) {
            const { error: labelsError } = await supabase.from('labels').insert(validLabelsPayload);
            if (labelsError) throw new StageError('insert_labels', 'Labels insert failed', { count: validLabelsPayload.length });
          }

          for (const p of problems) {
            const originalItem = validatedItems[p.index_in_image];
            if (!originalItem) continue;
            const meta = originalItem.metadata || {};
            const cls = originalItem.classification || {};
            const typeParts = [cls.depth1, cls.depth2, cls.depth3, cls.depth4].filter((v: any) => typeof v === 'string' && v.trim().length > 0) as string[];
            const problemType = typeParts.length > 0 ? typeParts.join(' - ') : (userLanguage === 'ko' ? '분류 없음' : 'Unclassified');
            let difficulty = meta.difficulty;
            if (userLanguage === 'en') { if (!['high','medium','low'].includes(difficulty||'')) difficulty = 'medium'; }
            else { if (!['상','중','하'].includes(difficulty||'')) difficulty = '중'; }
            const wdNum = Number(meta.word_difficulty);
            const wordDifficulty = (!isNaN(wdNum) && wdNum >= 1 && wdNum <= 9) ? Math.round(wdNum) : 5;
            await supabase.from('problems').update({ problem_metadata: { difficulty, word_difficulty: wordDifficulty, problem_type: problemType, analysis: meta.analysis || '' } }).eq('id', p.id);
          }

          await completeSession({ supabase, sessionId: createdSessionId!, usedModel });

          if (analysisUsageMetadata) {
            await logAiUsage({ supabase, userId, functionName: 'analyze-image', modelUsed: usedModel, usageMetadata: analysisUsageMetadata, sessionId: createdSessionId, metadata: { imageCount: imageList.length, problemCount: validatedItems.length } });
          }

          console.log(`[Background] Background analysis completed successfully for session: ${createdSessionId}`);
        } catch (bgError: any) {
          console.error(`[Background] Background analysis error for session ${createdSessionId}:`, bgError?.message);
          const stage: FailureStage = bgError instanceof StageError ? bgError.stage : 'unknown';
          await markSessionFailed({ supabase, sessionId: createdSessionId, stage, error: bgError, extra: bgError instanceof StageError ? bgError.details : undefined });
        }
      })();

      if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime.waitUntil) {
        EdgeRuntime.waitUntil(backgroundTask);
      } else {
        await backgroundTask;
      }

      return response;
    }
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
