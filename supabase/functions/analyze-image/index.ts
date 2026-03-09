import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { GoogleGenAI } from "https://esm.sh/@google/genai@1.21.0"
import { createServiceSupabaseClient } from '../_shared/supabaseClient.ts'
import { errorResponse, handleOptions, jsonResponse } from '../_shared/http.ts'
import { loadTaxonomyData } from '../_shared/taxonomy.ts'
import { buildPrompt, buildHandwritingDetectionPrompt } from './_shared/prompts.ts'
import { createAIClient } from '../_shared/aiClientFactory.ts'

// 에러 처리 모듈
import {
  StageError,
  summarizeError,
  markSessionFailed,
  type FailureStage
} from '../_shared/errors.ts'

// 검증 모듈
import {
  cleanOrNull,
  makeDepthKey,
  type TaxonomyByDepthKey,
  type TaxonomyByCode
} from './_shared/validation.ts'

// 모델 시퀀스 (UI 표시용)
import { MODEL_SEQUENCE } from '../_shared/models.ts'

// ocrProcessor.ts는 더 이상 사용하지 않음 (1단계 멀티모달 분석으로 전환)

// 분석 처리 모듈
import { analyzeImagesWithFailover, detectHandwritingMarks } from './_shared/analysisProcessor.ts'

// Labels 생성 모듈
import { buildLabelsPayload } from './_shared/labelProcessor.ts'

// 메타데이터 생성 모듈
import { generateBatchMetadata, type MetadataInput } from './_shared/metadataGenerator.ts'
import { buildStemText } from './_shared/problemProcessor.ts'

// 토큰 사용량 로깅 모듈
import { logAiUsage, sumUsageMetadata } from '../_shared/usageLogger.ts'
import type { UsageMetadata } from '../_shared/aiClient.ts'


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

    // 요청 본문 파싱 (에러 처리 추가)
    let requestData: any;
    try {
      requestData = await req.json();
      console.log('Request body parsed successfully');
    } catch (parseError: any) {
      console.error('Failed to parse request body:', parseError);
      return errorResponse(`Failed to parse request body: ${parseError.message}`, 400);
    }

    const { imageBase64, mimeType, userId, fileName, language, images, preferredModel } = requestData || {};

    // 다중 이미지 배열 또는 단일 이미지 지원 (하위 호환성)
    let imageList: Array<{ imageBase64: string; mimeType: string; fileName: string }> = [];

    if (images && Array.isArray(images) && images.length > 0) {
      // 다중 이미지 모드
      imageList = images.map((img: any, index: number) => {
        let base64Data = img.imageBase64 || '';
        // Base64 데이터에서 data:image/...;base64, 접두사 제거
        if (base64Data.includes(',')) {
          base64Data = base64Data.split(',')[1];
        }
        return {
          imageBase64: base64Data,
          mimeType: img.mimeType || 'image/jpeg',
          fileName: img.fileName || `image_${index}.jpg`,
        };
      });
      console.log('Request data: Multiple images mode', {
        imageCount: imageList.length,
        userId,
        language,
      });
    } else if (imageBase64) {
      // 단일 이미지 모드 (하위 호환성)
      let base64Data = imageBase64 || '';
      // Base64 데이터에서 data:image/...;base64, 접두사 제거
      if (base64Data.includes(',')) {
        base64Data = base64Data.split(',')[1];
      }
      imageList = [{
        imageBase64: base64Data,
        mimeType: mimeType || 'image/jpeg',
        fileName: fileName || 'image.jpg',
      }];
      console.log('Request data: Single image mode (backward compatible)', {
        userId,
        language,
      });
    }

    // 원본 요청 데이터의 이미지를 즉시 해제 (메모리 절약 - 이미 imageList에 복사됨)
    if (requestData) {
      if (requestData.images) requestData.images = null;
      if (requestData.imageBase64) requestData.imageBase64 = null;
    }

    if (imageList.length === 0 || !userId) {
      console.error('Missing required fields:', {
        imageCount: imageList.length,
        hasUserId: !!userId,
      });
      return errorResponse('Missing required fields: images (or imageBase64), userId', 400);
    }

    const MAX_IMAGES = 3;
    if (imageList.length > MAX_IMAGES) {
      console.warn(`Too many images: ${imageList.length}, max: ${MAX_IMAGES}. Truncating.`);
      imageList = imageList.slice(0, MAX_IMAGES);
    }

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

    // 1. 여러 이미지를 Storage에 업로드
    console.log(`Step 1: Upload ${imageList.length} image(s) to storage...`);
    const timestamp = Date.now();
    const { data: userData } = await supabase.auth.admin.getUserById(userId);
    const email = userData.user?.email || userId;
    const emailLocal = email.split('@')[0].replace(/[^a-zA-Z0-9_-]/g, '_');

    // 여러 이미지를 순차적으로 업로드하고 URL 수집
    const imageUrls: string[] = [];
    for (let i = 0; i < imageList.length; i++) {
      const img = imageList[i];
      const safeName = img.fileName.replace(/[^a-zA-Z0-9_.-]/g, '_');
      const path = `${emailLocal}/${timestamp}_${i}_${safeName}`;

      const buffer = new Uint8Array(atob(img.imageBase64).split('').map(c => c.charCodeAt(0)));
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('problem-images')
        .upload(path, buffer, {
          contentType: img.mimeType,
          cacheControl: '3600',
          upsert: false
        });

      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage.from('problem-images').getPublicUrl(uploadData.path);
      imageUrls.push(urlData.publicUrl);
      console.log(`Step 1: Image ${i + 1}/${imageList.length} uploaded to`, urlData.publicUrl);
    }

    // 첫 번째 이미지 URL을 메인 이미지 URL로 사용 (하위 호환성)
    const imageUrl = imageUrls[0];
    console.log(`Step 1 completed: ${imageList.length} image(s) uploaded, main image URL:`, imageUrl);

    // 2. 세션 생성
    console.log('Step 2: Create session...', {
      imageUrlsCount: imageUrls.length,
      imageUrls: imageUrls,
      imageUrl: imageUrl,
    });

    // image_urls 배열 검증 및 정리
    const cleanedImageUrls = imageUrls.filter((url: string) => url && typeof url === 'string' && url.trim().length > 0);
    if (cleanedImageUrls.length !== imageUrls.length) {
      console.warn('Step 2: Some image URLs were invalid and filtered out', {
        originalCount: imageUrls.length,
        cleanedCount: cleanedImageUrls.length,
        invalidUrls: imageUrls.filter((url: string, idx: number) => !cleanedImageUrls.includes(url))
      });
    }

    // 최종 저장할 image_urls 배열 (최소 1개는 있어야 함)
    // 최종 저장할 image_urls 배열 (최소 1개는 있어야 함)
    const finalImageUrls = cleanedImageUrls.length > 0 ? cleanedImageUrls : imageUrls;

    console.log('Step 2: Final image URLs to save', {
      originalCount: imageUrls.length,
      cleanedCount: cleanedImageUrls.length,
      finalCount: finalImageUrls.length,
      finalUrls: finalImageUrls
    });

    const { data: sessionData, error: sessionError } = await supabase
      .from('sessions')
      .insert({
        user_id: userId,
        // image_url 컬럼 삭제됨 (image_urls jsonb로 완전 대체)
        image_urls: finalImageUrls, // 다중 이미지 URL 배열
        analysis_model: MODEL_SEQUENCE[0],
        status: 'processing'
      })
      .select('id, image_urls')
      .single();

    if (sessionError) {
      console.error('Step 2: Session insert error', sessionError);
      throw sessionError;
    }

    createdSessionId = sessionData.id;

    // 저장된 데이터 검증
    console.log('Step 2: Session created', {
      sessionId: createdSessionId,
      insertedImageUrls: sessionData.image_urls,
      imageUrlsType: typeof sessionData.image_urls,
      imageUrlsIsArray: Array.isArray(sessionData.image_urls),
      imageUrlsLength: Array.isArray(sessionData.image_urls) ? sessionData.image_urls.length : 0,
      expectedCount: imageUrls.length,
    });

    // 저장된 image_urls가 예상과 다른 경우 경고
    if (!Array.isArray(sessionData.image_urls)) {
      console.error('Step 2: WARNING - image_urls is not an array!', {
        sessionId: createdSessionId,
        type: typeof sessionData.image_urls,
        value: sessionData.image_urls
      });
    } else if (sessionData.image_urls.length !== imageUrls.length) {
      console.warn('Step 2: WARNING - image_urls count mismatch!', {
        sessionId: createdSessionId,
        expected: imageUrls.length,
        actual: sessionData.image_urls.length,
        expectedUrls: imageUrls,
        actualUrls: sessionData.image_urls
      });
    }

    console.log('Step 2 completed: Session created with ID', createdSessionId);

    // 세션 생성 후 즉시 sessionId 반환 (분석은 백그라운드에서 계속)
    const response = jsonResponse({
      success: true,
      sessionId: createdSessionId,
      message: 'Session created, analysis in progress',
    });

    // 백그라운드 작업 정의 (IIFE)
    // EarlyDrop 방지: IIFE 직후 즉시 waitUntil 등록 필수
    const backgroundTask = (async () => {
      try {
        console.log(`[Background] Starting analysis for session ${createdSessionId}...`);

        // Vertex AI 인증 사전 검증 (인증 실패 시 OCR 5모델 x 3페이지 = 15회 무의미한 API 호출 방지)
        if (aiProvider === 'vertex') {
          try {
            console.log('[Background] Pre-validating Vertex AI authentication...');
            const { getAccessToken, parseServiceAccountJSON } = await import('../_shared/vertexAuth.ts');
            const creds = parseServiceAccountJSON(Deno.env.get('GOOGLE_SERVICE_ACCOUNT_JSON') || '');
            await getAccessToken(creds);
            console.log('[Background] Vertex AI authentication validated');
          } catch (authError: any) {
            console.error('[Background] Vertex AI auth pre-validation FAILED', {
              sessionId: createdSessionId,
              error: authError?.message,
            });
            await markSessionFailed({
              supabase,
              sessionId: createdSessionId!,
              stage: 'auth_failed' as FailureStage,
              error: authError,
            });
            return; // 백그라운드 작업 즉시 종료
          }
        }

        // 3. Taxonomy 데이터 로드 (프롬프트에 플랫 목록으로 포함 + 서버 측 enrichClassification용)
        console.log(`[Background] Step 3a: Loading taxonomy data...`, { language: userLanguage, sessionId: createdSessionId, imageCount: imageList.length });
        const taxonomyData = await loadTaxonomyData(supabase, userLanguage);

        // ✅ 서버 정규화/보강용 taxonomy lookup (프롬프트에는 포함하지 않음)
        // - depth 경로가 기준표에 실제 존재하는지 검증
        // - code/CEFR/난이도 등 부가정보를 한 번에 매핑
        // (성능) 문제당 DB쿼리 대신 taxonomy를 1회만 조회하여 Map으로 사용
        const depth1Col = userLanguage === 'en' ? 'depth1_en' : 'depth1';
        const depth2Col = userLanguage === 'en' ? 'depth2_en' : 'depth2';
        const depth3Col = userLanguage === 'en' ? 'depth3_en' : 'depth3';
        const depth4Col = userLanguage === 'en' ? 'depth4_en' : 'depth4';

        const { data: taxonomyRows, error: taxonomyRowsError } = await supabase
          .from('taxonomy')
          .select(`code, cefr, difficulty, ${depth1Col}, ${depth2Col}, ${depth3Col}, ${depth4Col}`);

        if (taxonomyRowsError) {
          console.error(`[Background] Step 3a: Failed to load taxonomy lookup rows`, {
            sessionId: createdSessionId,
            error: taxonomyRowsError,
          });
        }

        const taxonomyByDepthKey: TaxonomyByDepthKey = new Map();
        const taxonomyByCode: TaxonomyByCode = new Map();
        // makeDepthKey와 cleanOrNull은 _shared/validation.ts에서 import됨


        for (const row of taxonomyRows || []) {
          const code = cleanOrNull(row.code);
          const d1 = cleanOrNull(row[depth1Col]);
          const d2 = cleanOrNull(row[depth2Col]);
          const d3 = cleanOrNull(row[depth3Col]);
          const d4 = cleanOrNull(row[depth4Col]);
          const cefr = cleanOrNull(row.cefr);
          const difficulty = row.difficulty ?? null;

          if (d1 && d2 && d3 && d4) {
            taxonomyByDepthKey.set(makeDepthKey(d1, d2, d3, d4), { code, cefr, difficulty });
          }
          if (code) {
            taxonomyByCode.set(code, { depth1: d1, depth2: d2, depth3: d3, depth4: d4, code, cefr, difficulty });
          }
        }

        // 3. 페이지별 멀티모달 분석 (OCR 단계 없이 이미지를 직접 Gemini에 전달)
        const ANALYSIS_BATCH_SIZE = 3;
        console.log(`[Background] Step 3: Starting direct multimodal analysis for ${imageList.length} page(s) (batch size: ${ANALYSIS_BATCH_SIZE})...`, { sessionId: createdSessionId, pageCount: imageList.length });

        let allValidatedItems: any[] = [];
        let allSharedPassages: any[] = [];
        let finalUsedModel: string = '';
        let totalAnalysisUsageMetadata: any = {};

        // 단일 페이지 멀티모달 분석 함수
        async function analyzeOnePage(pageIdx: number) {
          const pageNum = pageIdx + 1;
          const imgData = imageList[pageIdx];

          if (!imgData?.imageBase64 || imgData.imageBase64.length === 0) {
            console.warn(`[Background] Step 3: Page ${pageNum} has no image data, skipping`, { sessionId: createdSessionId });
            return null;
          }

          const pagePrompt = buildPrompt(taxonomyData, userLanguage, 1);
          const pageParts: any[] = [
            { text: pagePrompt },
            { text: `Page ${pageNum} of ${imageList.length}. Read all text and detect handwritten answers and O/X marks from this exam page image.` },
            { inlineData: { data: imgData.imageBase64, mimeType: imgData.mimeType } },
          ];

          console.log(`[Background] Step 3: Page ${pageNum}/${imageList.length} - multimodal analysis, prompt length: ${pagePrompt.length}, image size: ${imgData.imageBase64.length}`, { sessionId: createdSessionId });

          try {
            // ─── Pass 1: 구조 추출 (텍스트, 선택지, 분류 등) ───
            const pageAnalysisResult = await analyzeImagesWithFailover({
              ai,
              supabase,
              sessionId: createdSessionId!,
              parts: pageParts,
              imageCount: 1,
              taxonomyByDepthKey,
              taxonomyByCode,
              preferredModel: preferredModel as string | undefined,
            });

            const { usedModel: pageModel, result: pageResult, validatedItems: pageItems, usageMetadata: pageUsage } = pageAnalysisResult;

            console.log(`[Background] Step 3 Pass 1: Page ${pageNum} structure extracted with ${pageModel}, items: ${pageItems.length}`, { sessionId: createdSessionId });

            // ─── Pass 2: 필기 마크 감지 (user_answer, O/X) ───
            const handwritingPrompt = buildHandwritingDetectionPrompt();
            const imagePart = { inlineData: { data: imgData.imageBase64, mimeType: imgData.mimeType } };

            const handwritingResult = await detectHandwritingMarks({
              ai,
              sessionId: createdSessionId!,
              prompt: handwritingPrompt,
              imageParts: [imagePart],
            });

            // ─── 결과 병합: Pass 2의 marks를 Pass 1의 items에 매칭 ───
            if (handwritingResult.marks.length > 0) {
              const markMap = new Map<string, { user_answer: string | null; user_marked_correctness: string | null }>();
              for (const mark of handwritingResult.marks) {
                markMap.set(String(mark.problem_number), {
                  user_answer: mark.user_answer,
                  user_marked_correctness: mark.user_marked_correctness,
                });
              }

              for (const item of pageItems) {
                const pNum = String(item.problem_number || '');
                const match = markMap.get(pNum);
                if (match) {
                  item.user_answer = match.user_answer;
                  item.user_marked_correctness = match.user_marked_correctness;
                }
              }

              console.log(`[Background] Step 3 Merge: ${handwritingResult.marks.length} mark(s) merged into ${pageItems.length} item(s)`, { sessionId: createdSessionId });
            }

            // 분석 완료 후 해당 페이지 이미지 메모리 해제
            (imageList[pageIdx] as any).imageBase64 = '';

            // Pass 2 토큰 사용량도 합산
            const combinedUsage = pageUsage ? { ...pageUsage } : {};
            if (handwritingResult.usageMetadata) {
              (combinedUsage as any).promptTokenCount = ((combinedUsage as any).promptTokenCount || 0) + (handwritingResult.usageMetadata.promptTokenCount || 0);
              (combinedUsage as any).candidatesTokenCount = ((combinedUsage as any).candidatesTokenCount || 0) + (handwritingResult.usageMetadata.candidatesTokenCount || 0);
              (combinedUsage as any).totalTokenCount = ((combinedUsage as any).totalTokenCount || 0) + (handwritingResult.usageMetadata.totalTokenCount || 0);
            }

            return { pageItems, pageResult, pageModel, pageUsage: combinedUsage };
          } catch (pageErr: any) {
            // 실패한 페이지도 메모리 해제
            if (imageList[pageIdx]) (imageList[pageIdx] as any).imageBase64 = '';
            console.error(`[Background] Step 3: Page ${pageNum} analysis FAILED`, {
              sessionId: createdSessionId,
              error: pageErr?.message || String(pageErr),
              stage: pageErr instanceof StageError ? pageErr.stage : 'unknown',
              details: pageErr instanceof StageError ? pageErr.details : undefined,
            });
            return null;
          }
        }

        // 배치별 병렬 처리
        for (let batchStart = 0; batchStart < imageList.length; batchStart += ANALYSIS_BATCH_SIZE) {
          const batchEnd = Math.min(batchStart + ANALYSIS_BATCH_SIZE, imageList.length);
          const batchIndices = Array.from({ length: batchEnd - batchStart }, (_, i) => batchStart + i);

          console.log(`[Background] Step 3: Processing batch (pages ${batchStart + 1}-${batchEnd})...`, { sessionId: createdSessionId });

          const batchResults = await Promise.all(batchIndices.map(idx => analyzeOnePage(idx)));

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
        }

        // 분석 결과 합산
        const usedModel = finalUsedModel;
        const validatedItems = allValidatedItems;
        const result = { items: allValidatedItems, shared_passages: allSharedPassages };
        const analysisUsageMetadata = totalAnalysisUsageMetadata;

        console.log(`[Background] Step 3 completed: All pages analyzed`, {
          sessionId: createdSessionId,
          usedModel,
          totalItems: validatedItems.length,
          pagesProcessed: imageList.length,
        });

        // 진단 로그: 이미지가 있는데 분석 결과 0문항인 경우
        if (imageList.length > 0 && (!validatedItems || validatedItems.length === 0)) {
          console.error(`[Background] Step 3: ${imageList.length} page(s) provided but analysis produced 0 items`, {
            sessionId: createdSessionId,
            usedModel,
          });
        }

        // 0문항인 경우: 환각 방지 지침 준수로 간주하고 세션을 실패 처리
        if (!validatedItems || validatedItems.length === 0) {
          console.warn(`[Background] Step 3 result: 0 items extracted. Marking session as failed to avoid hallucination.`, {
            sessionId: createdSessionId,
            usedModel,
          });
          await markSessionFailed({
            supabase,
            sessionId: createdSessionId,
            stage: 'extract_empty',
            error: new Error('No problems extracted (model returned empty items)'),
            extra: { usedModel },
          });
          return;
        }

        // 4. 문제 저장 (새로운 JSONB content 구조 포함)
        console.log(`[Background] Step 4: Save problems to database...`, { sessionId: createdSessionId, itemCount: validatedItems.length });
        const items = validatedItems;

        // 공유 지문 저장 (result.shared_passages가 있으면)
        const sharedPassages = result?.shared_passages || [];

        // 여러 이미지에서 온 문제들이 중복된 index를 가질 수 있으므로, 배열 인덱스를 사용하여 고유한 index_in_image 보장
        const problemsPayload = items.map((it: any, idx: number) => {
          // choices 정규화: 문자열 배열 또는 객체 배열 모두 지원
          const normalizedChoices = (it.choices || []).map((c: any) => {
            if (typeof c === 'string') {
              return { text: c };
            }
            // 새 구조: { label: "①", text: "..." }
            if (c.label && c.text) {
              return { label: c.label, text: c.text };
            }
            return { text: c.text || String(c) };
          });

          // stem 생성: 새 구조에서는 instruction + passage/question_body 조합
          // 기존 question_text가 있으면 그것을 사용 (하위 호환성)
          let stemText = it.question_text || '';
          if (!stemText && it.instruction) {
            // 새로운 구조: instruction을 기본으로 하고, passage가 있으면 앞에 추가
            const passageText = it._resolved_passage || it.passage || '';
            const questionBody = it.question_body || '';
            stemText = [
              passageText ? `[지문]\n${passageText}` : '',
              it.visual_context ? `[${it.visual_context.type || '자료'}] ${it.visual_context.title || ''}\n${it.visual_context.content || ''}` : '',
              `[문제] ${it.instruction}`,
              questionBody ? `\n${questionBody}` : ''
            ].filter(Boolean).join('\n\n');
          }

          // 새로운 content JSONB 구조 (UI에서 유연하게 활용 가능)
          const contentJson = {
            stem: stemText, // 조합된 전체 지문+문제 텍스트
            problem_number: it.problem_number || null,
            shared_passage_ref: it.shared_passage_ref || null,
            passage: it._resolved_passage || it.passage || null,
            visual_context: it.visual_context || null,
            instruction: it.instruction || null,
            question_body: it.question_body || null,
            choices: normalizedChoices,
            user_answer: it.user_answer || null,
            user_marked_correctness: it.user_marked_correctness || null,
          };

          return {
            session_id: createdSessionId,
            index_in_image: idx, // 항상 배열 인덱스 사용 (0부터 순차적으로 증가)
            // stem, choices 컬럼 제거됨 -> content에 포함됨
            content: contentJson, // 새로운 JSONB 필드
            problem_metadata: it.metadata || {
              difficulty: '중',
              word_difficulty: 5,
              problem_type: '분석 대기',
              analysis: '분석 정보 없음'
            }
          };
        });

        const { data: problems, error: problemsError } = await supabase
          .from('problems')
          .insert(problemsPayload)
          .select('id, index_in_image');

        if (problemsError) {
          console.error(`[Background] Step 4 error: Problems insert error`, { sessionId: createdSessionId, error: problemsError, problemsPayloadCount: problemsPayload.length });
          throw new StageError('insert_problems', 'Problems insert failed', { problemsPayloadCount: problemsPayload.length, error: summarizeError(problemsError) });
        }

        console.log(`[Background] Step 4 completed: Inserted ${problems?.length || 0} problems`, { sessionId: createdSessionId });

        if (!problems || problems.length === 0) {
          console.error(`[Background] Step 4 produced 0 problems. Marking session as failed.`, { sessionId: createdSessionId });
          await markSessionFailed({
            supabase,
            sessionId: createdSessionId,
            stage: 'insert_problems',
            error: new Error('Inserted 0 problems'),
            extra: { problemsPayloadCount: problemsPayload.length },
          });
          return;
        }

        // 5. AI 분석 결과를 labels에 저장 (user_mark는 null로 - 사용자 검수 대기) - labelProcessor 모듈 사용
        console.log(`[Background] Step 5: Save AI analysis results to labels (pending user review)...`, { sessionId: createdSessionId, problemCount: problems?.length || 0 });

        const validLabelsPayload = await buildLabelsPayload({
          items,
          problems: problems || [],
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
            throw new StageError('insert_labels', 'Labels insert failed', { validLabelsPayloadCount: validLabelsPayload.length, error: summarizeError(labelsError) });
          }
        }

        console.log(`[Background] Step 5 completed: AI analysis results saved (pending user review)`, { sessionId: createdSessionId });

        // Step 5.5 (Early Status Update) removed to prevent race condition.
        // Session status will be updated to 'completed' only after metadata generation (Step 6) is finished.

        // 6. 문제 메타데이터 생성 및 저장 - metadataGenerator 모듈 사용
        console.log(`[Background] Step 6: Generate problem metadata...`, { sessionId: createdSessionId });

        if (!problems || problems.length === 0) {
          console.log(`[Background] Step 6 skipped: No problems to process`, { sessionId: createdSessionId });
        } else {
          // 문제와 원본 아이템을 매핑
          const problemItemMap = new Map<number, any>();
          for (let i = 0; i < items.length; i++) {
            problemItemMap.set(i, items[i]);
          }

          // 문제와 labels를 매핑 (classification 정보 가져오기 위해)
          const problemLabelsMap = new Map<string, any>();
          for (const label of validLabelsPayload) {
            problemLabelsMap.set(label.problem_id, label);
          }

          // 배치 입력 데이터 준비
          const batchInputs: MetadataInput[] = [];
          const problemTypeById = new Map<string, string>();

          for (const p of problems) {
            const originalItem = problemItemMap.get(p.index_in_image);
            const label = problemLabelsMap.get(p.id);

            if (!originalItem) continue;
            if (!originalItem) continue;
            const stem = String(buildStemText(originalItem) || '').trim();
            if (!stem) continue;

            const classification = label?.classification || {};
            const typeParts = [
              classification.depth1,
              classification.depth2,
              classification.depth3,
              classification.depth4,
            ].filter((v: any) => typeof v === 'string' && v.trim().length > 0) as string[];
            const problemType = typeParts.length > 0
              ? typeParts.join(' - ')
              : (userLanguage === 'ko' ? '분류 없음' : 'Unclassified');

            const choices = (originalItem.choices || []).map((c: any) => {
              if (typeof c === 'string') return c;
              return c?.text || '';
            }).join('\n');
            const userAnswer = originalItem.user_answer || '';
            const isCorrect = label?.is_correct ?? null;

            problemTypeById.set(p.id, problemType);
            batchInputs.push({
              problem_id: p.id,
              problem_type: problemType,
              stem,
              choices,
              user_answer: userAnswer,
              is_correct: isCorrect,
            });
          }

          // generateBatchMetadata 모듈 함수 호출 (실패해도 세션은 완료 처리)
          try {
            await generateBatchMetadata({
              ai,
              supabase,
              batchInputs,
              problemTypeById,
              userLanguage,
              sessionId: createdSessionId!,
            });
          } catch (metaErr: any) {
            console.warn(`[Background] Step 6: Metadata generation failed (non-critical, continuing):`, {
              sessionId: createdSessionId,
              error: metaErr?.message || String(metaErr),
            });
            // 메타데이터 실패는 치명적이지 않으므로 계속 진행
          }
        }

        // 7. 세션 상태를 completed로 업데이트 + 모델 정보 저장
        const modelsUsed = {
          ocr: 'none (direct multimodal)',
          analysis: usedModel,
        };
        console.log(`[Background] Step 7: Update session status to completed...`, { sessionId: createdSessionId, modelsUsed });
        const { error: statusUpdateError } = await supabase
          .from('sessions')
          .update({
            status: 'completed',
            analysis_model: usedModel,
            models_used: modelsUsed,
          })
          .eq('id', createdSessionId)
          // 사용자 라벨링이 이미 끝나 labeled로 바뀐 경우 되돌리지 않도록 가드
          .eq('status', 'processing');

        if (statusUpdateError) {
          console.error(`[Background] Step 7 error: Status update error`, { sessionId: createdSessionId, error: statusUpdateError });
          // 상태 업데이트 실패해도 분석은 완료되었으므로 계속 진행
        } else {
          console.log(`[Background] Step 7 completed: Session status updated to completed`, { sessionId: createdSessionId });
        }

        // 8. 토큰 사용량 로깅
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

        console.log(`[Background] ✅ Background analysis completed successfully for session: ${createdSessionId}`);
      } catch (bgError: any) {
        console.error(`[Background] ❌ Background analysis error for session ${createdSessionId}:`, {
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
    // Deno 환경(Supabase)에서는 이 함수가 있어야 응답을 보낸 후에도 로직이 실행됩니다.
    if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime.waitUntil) {
      EdgeRuntime.waitUntil(backgroundTask);
      console.log('[Lifecycle] Background task registered with waitUntil');
    } else {
      // 로컬 테스트 환경 등을 위한 폴백 (필요 시)
      // 주의: await를 하면 클라이언트가 기다려야 하므로, 배포 환경에서는 waitUntil이 필수입니다.
      console.warn('EdgeRuntime.waitUntil not available; awaiting background task to avoid partial writes');
      await backgroundTask;
    }

    // waitUntil 등록 후 응답 반환 (순서 중요: 등록 → 반환)
    return response;
  } catch (error: any) {
    console.error('Error in analyze-image function:', error);

    // 에러 발생 시 세션 상태를 failed로 업데이트 (세션이 생성된 경우에만)
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
