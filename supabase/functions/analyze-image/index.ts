import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { GoogleGenAI } from "https://esm.sh/@google/genai@1.21.0"
import { createServiceSupabaseClient } from '../_shared/supabaseClient.ts'
import { requireEnv } from '../_shared/env.ts'
import { errorResponse, handleOptions, jsonResponse } from '../_shared/http.ts'
import { loadTaxonomyData } from '../_shared/taxonomy.ts'
import { buildPrompt } from './_shared/prompts.ts'

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

// OCR 처리 모듈
import { processOcr, type ImageItem } from './_shared/ocrProcessor.ts'

// 분석 처리 모듈
import { analyzeImagesWithFailover, buildImageParts, validateParts } from './_shared/analysisProcessor.ts'

// Labels 생성 모듈
import { buildLabelsPayload } from './_shared/labelProcessor.ts'

// 메타데이터 생성 모듈
import { generateBatchMetadata, type MetadataInput } from './_shared/metadataGenerator.ts'
import { buildStemText } from './_shared/problemProcessor.ts'

// 토큰 사용량 로깅 모듈
import { logAiUsage, sumUsageMetadata } from '../_shared/usageLogger.ts'
import type { UsageMetadata } from '../_shared/aiClient.ts'







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

    if (imageList.length === 0 || !userId) {
      console.error('Missing required fields:', {
        imageCount: imageList.length,
        hasUserId: !!userId,
      });
      return errorResponse('Missing required fields: images (or imageBase64), userId', 400);
    }

    const geminiApiKey = requireEnv('GEMINI_API_KEY');

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

    // 백그라운드 작업을 변수에 담습니다.
    const backgroundTask = (async () => {
      try {
        console.log(`[Background] Starting analysis for session ${createdSessionId}...`);
        // 3. Taxonomy 데이터 로드
        console.log(`[Background] Step 3a: Loading taxonomy data from database...`, { language: userLanguage, sessionId: createdSessionId, imageCount: imageList.length });
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

        // Gemini 클라이언트 (OCR 및 추출 공용)
        const ai = new GoogleGenAI({ apiKey: geminiApiKey });

        // 3a-1. 페이지별 OCR 수행 (텍스트만 추출) - ocrProcessor 모듈 사용
        const ocrResult = await processOcr({
          ai,
          imageList: imageList as ImageItem[],
          sessionId: createdSessionId!,
        });
        const ocrPages = ocrResult.ocrPages;

        const prompt = buildPrompt(taxonomyData, userLanguage, imageList.length, ocrPages);
        console.log(`[Background] Step 3a completed: Taxonomy data loaded, prompt length: ${prompt.length}, ocrPages=${ocrPages.length}`);

        // 3. Gemini API로 분석 (여러 이미지를 한 번에 전송) - analysisProcessor 모듈 사용
        console.log(`[Background] Step 3b: Analyzing ${imageList.length} image(s) with Gemini...`, { sessionId: createdSessionId });

        // 이미지 parts 배열 생성
        const parts = buildImageParts(prompt, imageList as ImageItem[], createdSessionId!);

        // parts 배열 검증
        validateParts(parts, imageList.length, createdSessionId!);

        console.log(`[Background] Step 3b: Calling Gemini API with ${imageList.length} image(s)...`, {
          sessionId: createdSessionId,
          partsLength: parts.length,
          expectedImages: imageList.length,
          actualImages: parts.filter((p: any) => !!p.inlineData).length,
        });

        // 모델 Failover 분석 실행
        const analysisResult = await analyzeImagesWithFailover({
          ai,
          supabase,
          sessionId: createdSessionId!,
          parts,
          imageCount: imageList.length,
          taxonomyByDepthKey,
          taxonomyByCode,
          preferredModel: preferredModel as string | undefined, // preferredModel 전달
        });

        const { usedModel, result, validatedItems, usageMetadata: analysisUsageMetadata } = analysisResult;

        console.log(`[Background] Step 3 completed: Model response received`, {
          sessionId: createdSessionId,
          usedModel,
          validatedItems: validatedItems.length,
        });

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

          // generateBatchMetadata 모듈 함수 호출
          await generateBatchMetadata({
            ai: new GoogleGenAI({ apiKey: geminiApiKey }),
            supabase,
            batchInputs,
            problemTypeById,
            userLanguage,
            sessionId: createdSessionId!,
          });
        }

        // 7. 세션 상태를 completed로 업데이트
        console.log(`[Background] Step 7: Update session status to completed...`, { sessionId: createdSessionId });
        const { error: statusUpdateError } = await supabase
          .from('sessions')
          .update({ status: 'completed' })
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
    // Deno 환경(Supabase)에서는 이 함수가 있어야 응답을 보낸 후에도 로직이 실행됩니다.
    if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime.waitUntil) {
      EdgeRuntime.waitUntil(backgroundTask);
    } else {
      // 로컬 테스트 환경 등을 위한 폴백 (필요 시)
      // 주의: await를 하면 클라이언트가 기다려야 하므로, 배포 환경에서는 waitUntil이 필수입니다.
      console.warn('EdgeRuntime.waitUntil not available; awaiting background task to avoid partial writes');
      await backgroundTask;
    }

    // 세션 생성 후 즉시 응답 반환
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
