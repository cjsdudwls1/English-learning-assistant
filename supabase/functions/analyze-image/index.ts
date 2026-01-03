// @ts-nocheck
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { GoogleGenAI } from "https://esm.sh/@google/genai@1.21.0"
import { createServiceSupabaseClient } from './_shared/supabaseClient.ts'
import { requireEnv } from './_shared/env.ts'
import { errorResponse, handleOptions, jsonResponse } from './_shared/http.ts'
import { loadTaxonomyData } from './_shared/taxonomy.ts'

// Model selection (ordered attempts)
// - Try in this exact order
// - If the last model fails too, treat as analysis failure
const MODEL_SEQUENCE = [
  'gemini-3-flash-preview',
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
  'gemini-2.5-pro',
  'gemma-3-27b-it',
] as const;

// Lowest possible temperature for deterministic extraction
const EXTRACTION_TEMPERATURE = 0.0;

// Keep retries modest; we fail over to next model on errors.
const MODEL_RETRY_POLICY: Record<(typeof MODEL_SEQUENCE)[number], { maxRetries: number; baseDelayMs: number }> = {
  'gemini-3-flash-preview': { maxRetries: 1, baseDelayMs: 3000 },
  'gemini-2.5-flash': { maxRetries: 1, baseDelayMs: 3000 },
  'gemini-2.5-flash-lite': { maxRetries: 1, baseDelayMs: 3000 },
  'gemini-2.5-pro': { maxRetries: 1, baseDelayMs: 4000 },
  'gemma-3-27b-it': { maxRetries: 1, baseDelayMs: 3000 },
};

// Step 6 (metadata) model: keep it fast/cheap and deterministic
const METADATA_MODEL = 'gemini-2.5-flash-lite';

// 2단계 프롬프트 로직: Step 1 (Raw OCR) + Step 2 (Extraction)
function buildPrompt(classificationData: { structure: string }, language: 'ko' | 'en' = 'ko', imageCount: number = 1) {
  const { structure } = classificationData;

  return `

## Task
Extract all exam questions from images into structured JSON.
${imageCount > 1 ? `**CRITICAL:** You have **${imageCount} sequential images**. Merge split questions across pages into single items.` : ''}
Images are provided **in order** with captions like "Page X of N. Continues from previous page. Next page follows." Use these captions to respect page order and reconnect passages/questions across pages.
If text is unreadable / blank, return an empty array instead of guessing. Do NOT hallucinate problems or content.

## Extraction Rules (CRITICAL)
1. **Verbatim Text**: Extract the ALL text content exactly as it appears. Do NOT summarize or skip any part of the passage, options, or instructions.
2. **Missing Content**: NEVER return placeholders like "[Missing paragraph]" or "[Passage]". If the text is in the image, you MUST extract it.
3. **Structure Markers**: Preserve all structural markers in passages, such as (A), (B), (C) or [A], [B]. For insertion questions, keep the insertion points (e.g. " (A) ") and their surrounding text clearly visible.
4. **Underlined/Bracketed Text**: If a question references underlined or bracketed parts (e.g., "① [increased]"), extract them exactly as shown with the markers.
5. **Options**: Extract all 5 choices fully. Do not truncate.

## Classification Criteria
\`\`\`
${structure}
\`\`\`
- **MANDATORY:** Classify using depth1~4 from criteria table above. NULL NOT allowed.
- Use exact values (spelling/spacing/case-sensitive).
- Only depth1~depth4 keys (no code/CEFR/difficulty).

## Output Format (JSON Only)
Respond with JSON only. Do NOT include any markdown, explanations, or HTML.

\`\`\`json
{
  "items": [
    {
      "problem_number": "35",
      "question_text": "Full instruction + passage + all sub-questions/segments. (Combine if split)",
      "choices": ["① Choice 1", "② Choice 2", "③ Choice 3", "④ Choice 4", "⑤ Choice 5"],
      "user_marked_correctness": "O" | "X",
      "user_answer": "marked choice or text",
      "classification": {
        "depth1": "exact value (MANDATORY)",
        "depth2": "exact value (MANDATORY)",
        "depth3": "exact value (MANDATORY)",
        "depth4": "exact value (MANDATORY)"
      }
    }
  ]
}
\`\`\`

If you cannot read any question, return { "items": [] }. Respond with JSON only.
`;
}

function normalizeMark(raw: unknown): 'O' | 'X' {
  if (raw === undefined || raw === null) return 'X';
  const value = String(raw).trim().toLowerCase();
  const truthy = new Set(['o', '✓', 'v', 'correct', 'true', '정답', '맞음', 'ok', '⭕', 'circle', 'check', 'checkmark']);
  if (truthy.has(value)) return 'O';
  return 'X';
}

// 검증: 필수 필드, 선택지 개수, 문제 번호 순서/중복, taxonomy 일관성
function validateExtractedItems(params: {
  items: any[];
  taxonomyByDepthKey: Map<string, { code: string | null; cefr: string | null; difficulty: number | null }>;
  taxonomyByCode: Map<string, { depth1: string | null; depth2: string | null; depth3: string | null; depth4: string | null; code: string | null; cefr: string | null; difficulty: number | null }>;
}) {
  const { items, taxonomyByDepthKey, taxonomyByCode } = params;

  const seenNumbers = new Set<string>();
  let previousNumber: number | null = null;

  const clean = (v: unknown) => {
    if (v === undefined || v === null) return '';
    return String(v).trim();
  };

  for (const item of items) {
    const numRaw = clean(item.problem_number || item.index);
    const stem = clean(item.question_text || item.stem);
    const choices = Array.isArray(item.choices) ? item.choices : [];

    // 선택지 5개 필수
    if (choices.length !== 5) {
      throw new StageError('extract_validate', `Invalid choices count: expected 5, got ${choices.length}`, {
        problem_number: numRaw,
        choices_length: choices.length,
      });
    }

    // 문제 번호 중복/역순 검사 (숫자로 파싱 가능한 경우)
    const numVal = parseInt(numRaw, 10);
    if (!Number.isNaN(numVal)) {
      const numKey = String(numVal);
      if (seenNumbers.has(numKey)) {
        throw new StageError('extract_validate', `Duplicate problem number detected: ${numKey}`, {
          problem_number: numKey,
        });
      }
      if (previousNumber !== null && numVal < previousNumber) {
        throw new StageError('extract_validate', `Problem numbers out of order (descending): prev=${previousNumber}, current=${numVal}`, {
          previous: previousNumber,
          current: numVal,
        });
      }
      seenNumbers.add(numKey);
      previousNumber = numVal;
    }

    // taxonomy depth1~4 필수 및 유효성 검사
    const classification = item.classification || {};
    const depth1 = clean(classification.depth1 ?? classification['depth1']);
    const depth2 = clean(classification.depth2 ?? classification['depth2']);
    const depth3 = clean(classification.depth3 ?? classification['depth3']);
    const depth4 = clean(classification.depth4 ?? classification['depth4']);
    const code = clean(classification.code ?? classification['code']);

    const hasAllDepth = !!(depth1 && depth2 && depth3 && depth4);
    const depthKey = `${depth1}␟${depth2}␟${depth3}␟${depth4}`;

    const depthValid = hasAllDepth && taxonomyByDepthKey.has(depthKey);
    const codeValid = code && taxonomyByCode.has(code);

    if (!depthValid && !codeValid) {
      throw new StageError('extract_validate', 'Invalid taxonomy classification', {
        problem_number: numRaw,
        depth1,
        depth2,
        depth3,
        depth4,
        code: code || null,
        stemPreview: stem.substring(0, 120),
      });
    }
  }

  return true;
}

// 실패 원인 기록을 위한 에러 타입/유틸
type FailureStage =
  | 'request'
  | 'extract_call'
  | 'extract_parse'
  | 'extract_empty'
  | 'extract_validate'
  | 'insert_problems'
  | 'insert_labels'
  | 'unknown';

class StageError extends Error {
  stage: FailureStage;
  details: any;
  constructor(stage: FailureStage, message: string, details?: any) {
    super(message);
    this.stage = stage;
    this.details = details;
  }
}

function safeStringify(value: unknown, maxLen = 1800): string {
  let s = '';
  try {
    s = JSON.stringify(value);
  } catch {
    try {
      s = String(value);
    } catch {
      s = '[unstringifiable]';
    }
  }
  if (s.length > maxLen) return s.slice(0, maxLen) + '...';
  return s;
}

function summarizeError(err: any) {
  const message = err?.message ? String(err.message) : String(err ?? 'Unknown error');
  const code = err?.status ?? err?.error?.code ?? err?.code ?? null;
  const status = err?.error?.status ?? err?.statusText ?? null;
  const name = err?.name ?? null;
  const stack = err?.stack ?? null;
  return { message, code, status, name, stack };
}

function parseModelError(apiError: any) {
  const errorCode = apiError?.status || apiError?.error?.code || 0;
  const errorMessage = apiError?.message || apiError?.error?.message || String(apiError);
  const errorStatus = apiError?.error?.status || '';
  const lower = String(errorMessage).toLowerCase();
  const isRateLimit = errorCode === 429 || lower.includes('rate limit') || lower.includes('quota');
  const isServerOverload = errorCode === 503 || lower.includes('overloaded') || lower.includes('unavailable') || errorStatus === 'UNAVAILABLE';
  const isTimeout = lower.includes('timeout') || errorCode === 504;
  return { errorCode, errorStatus, errorMessage, isRateLimit, isServerOverload, isTimeout };
}

function computeBackoffDelayMs(base: number, attempt: number) {
  // exponential backoff + jitter (0.85~1.15)
  const raw = base * Math.pow(2, Math.max(0, attempt - 1));
  const jitter = 0.85 + Math.random() * 0.30;
  return Math.round(raw * jitter);
}

async function generateWithRetry(params: {
  ai: any;
  model: string;
  contents: any;
  sessionId: string;
  maxRetries: number;
  baseDelayMs: number;
  temperature: number;
}) {
  const { ai, model, contents, sessionId, maxRetries, baseDelayMs, temperature } = params;
  let attempt = 0;
  let lastParsed: any = null;
  let lastErr: any = null;

  while (attempt < maxRetries) {
    try {
      console.log(`[Background] Step 3b: Model call attempt ${attempt + 1}/${maxRetries} (model=${model})...`, { sessionId });

      const response = await ai.models.generateContent({
        model,
        contents,
        generationConfig: {
          responseMimeType: "application/json",
          temperature,
        },
        // ✅ RECITATION 및 기타 안전 필터로 인한 차단을 방지하기 위해 BLOCK_NONE 설정
        safetySettings: [
          { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
        ],
      });
      return { response, attemptCount: attempt + 1 };
    } catch (apiError: any) {
      attempt++;
      lastErr = apiError;
      lastParsed = parseModelError(apiError);
      const { errorCode, errorStatus, errorMessage, isRateLimit, isServerOverload, isTimeout } = lastParsed;

      console.error(`[Background] Step 3b: Model error (attempt ${attempt}/${maxRetries}, model=${model}):`, {
        sessionId,
        errorCode,
        errorStatus,
        errorMessage: String(errorMessage).substring(0, 200),
      });

      const retryable = isRateLimit || isServerOverload || isTimeout;
      if (attempt >= maxRetries || !retryable) {
        throw new StageError(
          'extract_call',
          `Model call failed after ${attempt} attempts (model=${model})`,
          {
            model,
            attempt,
            maxRetries,
            errorCode,
            errorStatus,
            errorMessage: String(errorMessage).substring(0, 500),
          }
        );
      }

      const delay = computeBackoffDelayMs(baseDelayMs, attempt);
      console.warn(`[Background] Step 3b: Retrying in ${Math.round(delay / 1000)}s... (attempt ${attempt}/${maxRetries}, model=${model})`, { sessionId });
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  // should not reach here
  throw new StageError(
    'extract_call',
    `Model call failed (no response) (model=${params.model})`,
    { model: params.model, lastParsed, lastError: summarizeError(lastErr) }
  );
}

async function markSessionFailed(params: {
  supabase: any;
  sessionId: string;
  stage: FailureStage;
  error: any;
  extra?: any;
}) {
  const { supabase, sessionId, stage, error, extra } = params;
  const summary = summarizeError(error);
  const failureMessage = safeStringify({ stage, ...summary, extra });
  try {
    await supabase
      .from('sessions')
      .update({
        status: 'failed',
        failure_stage: stage,
        failure_message: failureMessage,
      })
      .eq('id', sessionId);
  } catch (e) {
    console.error('[FailureRecord] Failed to write failure_stage/message', {
      sessionId,
      stage,
      originalError: summary,
      updateError: summarizeError(e),
    });
    // 마지막 방어: status만이라도 업데이트
    try {
      await supabase.from('sessions').update({ status: 'failed' }).eq('id', sessionId);
    } catch (e2) {
      console.error('[FailureRecord] Failed to update status=failed', { sessionId, e2: summarizeError(e2) });
    }
  }
}

// 문제 번호 범위를 감지하고 분리하는 함수
function validateAndSplitProblems(items: any[]): any[] {
  const validatedItems: any[] = [];
  // 중복 체크를 위한 Set: 문제 내용의 해시를 저장
  const seenProblemHashes = new Set<string>();

  // 문제 내용에서 핵심 텍스트 추출하여 해시 생성 (중복 체크용)
  function getProblemHash(item: any): string {
    const stem = String(item.question_text || item.stem || '').trim();
    const choices = (item.choices || []).map((c: any) => {
      const text = typeof c === 'string' ? c : (c.text || c);
      return String(text).trim();
    }).join('|');
    return `${stem}||${choices}`;
  }

  for (const item of items) {
    const problemNumber = String(item.problem_number || item.index || '').trim();
    const problemText = String(item.question_text || item.stem || '').trim();

    // 중복 체크: 같은 문제 내용이 이미 처리되었는지 확인
    const problemHash = getProblemHash(item);
    if (seenProblemHashes.has(problemHash)) {
      console.warn(`Skipping duplicate problem: problem_number=${problemNumber}, hash=${problemHash.substring(0, 50)}...`);
      continue;
    }

    // 1. problem_number에서 범위 패턴 확인 (N~M 또는 N-M)
    // 단, problem_number가 단일 숫자(예: "1", "2")인 경우 범위로 처리하지 않음
    let rangeMatch = problemNumber.match(/^(\d+)[~-](\d+)$/);

    // 2. problem_number에 범위가 없고, 문제 번호가 단일 숫자가 아닌 경우에만
    //    문제 내용의 시작 부분에서 범위 패턴 확인
    //    (AI가 이미 분리한 문제에서는 problem_number가 단일 숫자일 것이므로 이 로직은 실행되지 않음)
    if (!rangeMatch && problemText && !/^\d+$/.test(problemNumber)) {
      // 문제 내용의 시작 부분(첫 100자)에서만 범위 패턴 찾기
      const textStart = problemText.substring(0, 100);
      const textRangeMatch = textStart.match(/\[(\d+)[~-](\d+)\]/);
      if (textRangeMatch) {
        rangeMatch = textRangeMatch;
        console.log(`Found problem number range in problem text start: ${textRangeMatch[0]}`);
      }
    }

    if (rangeMatch) {
      // 범위로 표시된 경우 분리
      const startNum = parseInt(rangeMatch[1], 10);
      const endNum = parseInt(rangeMatch[2], 10);

      if (startNum < endNum && endNum - startNum <= 10) {
        // 합리적인 범위인 경우에만 분리 (최대 10개까지)
        console.warn(`Detected problem number range: ${rangeMatch[0]}. Splitting into ${endNum - startNum + 1} separate problems.`);

        // 각 문제 번호에 대해 별도 항목 생성
        // 주의: 문제 내용은 그대로 유지 (범위 표시가 포함된 지시문일 수 있음)
        for (let num = startNum; num <= endNum; num++) {
          const newItem = {
            ...item,
            index: validatedItems.length,
            problem_number: num.toString(),
          };
          validatedItems.push(newItem);
          seenProblemHashes.add(getProblemHash(newItem));
        }
      } else {
        // 잘못된 범위이거나 너무 큰 범위인 경우 원본 그대로 추가
        console.warn(`Invalid or too large problem number range: ${rangeMatch[0]}. Keeping as single item.`);
        validatedItems.push({
          ...item,
          index: validatedItems.length,
          problem_number: problemNumber || validatedItems.length.toString(),
        });
        seenProblemHashes.add(problemHash);
      }
    } else {
      // 단일 문제 번호인 경우 그대로 추가
      validatedItems.push({
        ...item,
        index: validatedItems.length,
        problem_number: problemNumber || validatedItems.length.toString(),
      });
      seenProblemHashes.add(problemHash);
    }
  }

  return validatedItems;
}

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

    const { imageBase64, mimeType, userId, fileName, language, images } = requestData || {};

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
    const finalImageUrls = cleanedImageUrls.length > 0 ? cleanedImageUrls : (imageUrls.length > 0 ? imageUrls : [imageUrl]);

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
        image_url: imageUrl, // 하위 호환성을 위해 첫 번째 이미지 URL 유지
        image_urls: finalImageUrls, // 다중 이미지 URL 배열
        analysis_model: MODEL_SEQUENCE[0],
        status: 'processing'
      })
      .select('id, image_url, image_urls')
      .single();

    if (sessionError) {
      console.error('Step 2: Session insert error', sessionError);
      throw sessionError;
    }

    createdSessionId = sessionData.id;

    // 저장된 데이터 검증
    console.log('Step 2: Session created', {
      sessionId: createdSessionId,
      insertedImageUrl: sessionData.image_url,
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

        const taxonomyByDepthKey = new Map<string, { code: string | null; cefr: string | null; difficulty: number | null }>();
        const taxonomyByCode = new Map<string, { depth1: string | null; depth2: string | null; depth3: string | null; depth4: string | null; code: string | null; cefr: string | null; difficulty: number | null }>();
        const makeDepthKey = (d1: string, d2: string, d3: string, d4: string) => `${d1}␟${d2}␟${d3}␟${d4}`;
        const cleanOrNull = (v: unknown) => {
          if (v === undefined || v === null) return null;
          const s = String(v).trim();
          return s ? s : null;
        };

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

        const prompt = buildPrompt(taxonomyData, userLanguage, imageList.length);
        console.log(`[Background] Step 3a completed: Taxonomy data loaded, prompt length: ${prompt.length}`);

        // 3. Gemini API로 분석 (여러 이미지를 한 번에 전송)
        console.log(`[Background] Step 3b: Analyzing ${imageList.length} image(s) with Gemini...`, { sessionId: createdSessionId });
        const ai = new GoogleGenAI({ apiKey: geminiApiKey });

        // 모든 이미지를 parts 배열에 추가
        console.log(`[Background] Step 3b: Preparing ${imageList.length} image(s) for Gemini API...`, {
          sessionId: createdSessionId,
          imageListLength: imageList.length,
          imageFileNames: imageList.map((img, idx) => ({ index: idx, fileName: img.fileName, hasBase64: !!img.imageBase64, base64Length: img.imageBase64?.length || 0 }))
        });

        const parts: any[] = [{ text: prompt }];
        for (let i = 0; i < imageList.length; i++) {
          const img = imageList[i];
          if (!img.imageBase64) {
            console.error(`[Background] Step 3b: Image ${i} (${img.fileName}) has no base64 data!`, { sessionId: createdSessionId });
            throw new Error(`Image ${i} (${img.fileName}) has no base64 data`);
          }
          const pageNumber = i + 1;
          const pageCaption = `Page ${pageNumber} of ${imageList.length}. ${i === 0 ? 'Start of problem set.' : 'Continues from previous page.'} ${i === imageList.length - 1 ? 'This is the last page.' : 'Next page follows.'}`;
          parts.push({ text: pageCaption });
          parts.push({ inlineData: { data: img.imageBase64, mimeType: img.mimeType } });
          console.log(`[Background] Step 3b: Added image ${i + 1}/${imageList.length} to parts array with caption`, {
            sessionId: createdSessionId,
            fileName: img.fileName,
            mimeType: img.mimeType,
            base64Length: img.imageBase64.length,
            pageCaption,
          });
        }

        console.log(`[Background] Step 3b: Calling Gemini API with ${imageList.length} image(s)...`, {
          sessionId: createdSessionId,
          partsLength: parts.length,
          expectedImages: imageList.length,
          actualImages: parts.filter((p: any) => !!p.inlineData).length, // image parts only
        });

        // parts 배열 검증
        if (!parts || !Array.isArray(parts) || parts.length === 0) {
          throw new Error(`Invalid parts array: ${JSON.stringify(parts)}`);
        }

        const inlineDataCount = parts.filter((p: any) => !!p.inlineData).length;
        if (inlineDataCount !== imageList.length) {
          console.error(`[Background] Step 3b: Parts array inlineData count mismatch! Expected ${imageList.length}, got ${inlineDataCount}`, { sessionId: createdSessionId });
          throw new Error(`Parts array inlineData count mismatch: expected ${imageList.length}, got ${inlineDataCount}`);
        }

        // 모델 호출 + 파싱 + (0문항 포함) 검증까지 포함해서 ordered failover
        let usedModel: string = MODEL_SEQUENCE[0];
        let responseText: string = '';
        let result: any = null;
        let validatedItems: any[] = [];
        const modelAttemptErrors: Array<{ model: string; error: any }> = [];

        for (let i = 0; i < MODEL_SEQUENCE.length; i++) {
          const model = MODEL_SEQUENCE[i];
          const policy = MODEL_RETRY_POLICY[model];

          // 세션에 현재 시도 모델 기록 (UI에서 표시)
          try {
            await supabase
              .from('sessions')
              .update({ analysis_model: model })
              .eq('id', createdSessionId);
          } catch (e) {
            console.error(`[Background] Failed to update analysis_model`, { sessionId: createdSessionId, model, error: e });
          }

          try {
            console.log(`[Background] Step 3b: Trying model ${i + 1}/${MODEL_SEQUENCE.length}: ${model}`, {
              sessionId: createdSessionId,
              maxRetries: policy?.maxRetries,
              baseDelayMs: policy?.baseDelayMs,
              temperature: EXTRACTION_TEMPERATURE,
            });

            const attempt = await generateWithRetry({
              ai,
              model,
              contents: { parts },
              sessionId: createdSessionId,
              maxRetries: policy?.maxRetries ?? 2,
              baseDelayMs: policy?.baseDelayMs ?? 3000,
              temperature: EXTRACTION_TEMPERATURE,
            });

            const response = attempt.response;

            // 응답 텍스트 추출 (content 없는 경우는 "성공"으로 보지 말고 다음 모델로 failover)
            let candidateText: string = '';
            if (response?.text) {
              candidateText = typeof response.text === 'function'
                ? await response.text()
                : response.text;
            } else if (response?.response?.text) {
              candidateText = typeof response.response.text === 'function'
                ? await response.response.text()
                : response.response.text;
            } else if (response?.candidates?.[0]?.content?.parts?.[0]?.text) {
              candidateText = response.candidates[0].content.parts[0].text;
            } else {
              const finishReason = response?.candidates?.[0]?.finishReason ?? null;
              throw new StageError(
                'extract_call',
                `Model returned no content (model=${model})`,
                {
                  model,
                  finishReason,
                  hasCandidates: !!response?.candidates,
                  candidatesLength: response?.candidates?.length,
                  firstCandidate: response?.candidates?.[0]
                    ? {
                      finishReason: response.candidates[0].finishReason,
                      hasContent: !!response.candidates[0].content,
                      hasParts: !!response.candidates[0].content?.parts,
                    }
                    : null,
                }
              );
            }

            if (!candidateText || typeof candidateText !== 'string') {
              throw new StageError(
                'extract_call',
                `Invalid response text (model=${model})`,
                { model, responseTextType: typeof candidateText, responseTextLength: candidateText?.length }
              );
            }

            // JSON 파싱 + 최소 유효성 검사 (여기서 0문항이면 다음 모델로 넘어감)
            const jsonString = candidateText.replace(/```json/g, '').replace(/```/g, '').trim();
            let parsed: any;
            try {
              parsed = JSON.parse(jsonString);
            } catch (parseError: any) {
              throw new StageError(
                'extract_parse',
                `JSON parse failed (model=${model}): ${parseError.message}`,
                { model, jsonStringPreview: jsonString.substring(0, 800) }
              );
            }

            if (!parsed || !Array.isArray(parsed.items)) {
              throw new StageError(
                'extract_parse',
                `Invalid response format: items is missing (model=${model})`,
                { model, parsedKeys: parsed ? Object.keys(parsed) : null, jsonStringPreview: jsonString.substring(0, 800) }
              );
            }

            const candidateValidated = validateAndSplitProblems(parsed.items);

            if (candidateValidated && candidateValidated.length > 0) {
              // 추가 검증: 선택지, 문제 번호 순서/중복, taxonomy 유효성
              validateExtractedItems({
                items: candidateValidated,
                taxonomyByDepthKey,
                taxonomyByCode,
              });
            } else {
              console.warn(`[Background] Step 3b: Model returned 0 items (model=${model}). Accepting empty extraction to avoid hallucination.`, {
                sessionId: createdSessionId,
                model,
                responseTextPreview: jsonString.substring(0, 400),
              });
            }

            // 성공
            usedModel = model;
            responseText = candidateText;
            result = parsed;
            validatedItems = candidateValidated;
            break;
          } catch (err: any) {
            modelAttemptErrors.push({ model, error: err });
            console.warn(`[Background] Step 3b: Model attempt failed, moving to next (model=${model})`, {
              sessionId: createdSessionId,
              modelIndex: i,
              stage: err instanceof StageError ? err.stage : null,
              error: err instanceof StageError ? err.details : summarizeError(err),
            });

            const isLast = i === MODEL_SEQUENCE.length - 1;
            if (isLast) {
              throw new StageError(
                err instanceof StageError ? err.stage : 'extract_call',
                `All model attempts failed (last=${model})`,
                {
                  modelSequence: MODEL_SEQUENCE,
                  attempts: modelAttemptErrors.map(({ model: m, error }) => ({
                    model: m,
                    stage: error instanceof StageError ? error.stage : null,
                    error: error instanceof StageError ? error.details : summarizeError(error),
                  })),
                }
              );
            }
          }
        }

        console.log(`[Background] Step 3 completed: Model response received`, {
          sessionId: createdSessionId,
          usedModel,
          responseLength: responseText.length,
          rawItems: Array.isArray(result?.items) ? result.items.length : null,
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

        // 4. 문제 저장 (메타데이터 포함)
        console.log(`[Background] Step 4: Save problems to database...`, { sessionId: createdSessionId, itemCount: validatedItems.length });
        const items = validatedItems;
        // 여러 이미지에서 온 문제들이 중복된 index를 가질 수 있으므로, 배열 인덱스를 사용하여 고유한 index_in_image 보장
        const problemsPayload = items.map((it: any, idx: number) => ({
          session_id: createdSessionId,
          index_in_image: idx, // 항상 배열 인덱스 사용 (0부터 순차적으로 증가)
          stem: it.question_text || '',
          choices: (it.choices || []).map((c: any) => {
            // choices가 문자열 배열인 경우와 객체 배열인 경우 모두 처리
            if (typeof c === 'string') {
              return { text: c };
            }
            return { text: c.text || c };
          }),
          problem_metadata: it.metadata || {
            difficulty: '중',
            word_difficulty: 5,
            problem_type: '분석 대기',
            analysis: '분석 정보 없음'
          }
        }));

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

        // 5. AI 분석 결과를 labels에 저장 (user_mark는 null로 - 사용자 검수 대기)
        console.log(`[Background] Step 5: Save AI analysis results to labels (pending user review)...`, { sessionId: createdSessionId, problemCount: problems?.length || 0 });
        // index_in_image를 키로 사용하되, 배열 인덱스와 매칭되므로 중복 없음
        const idByIndex = new Map<number, string>();
        for (const row of problems || []) {
          // 중복 체크: 같은 index_in_image가 이미 있으면 경고 (이론적으로는 발생하지 않아야 함)
          if (idByIndex.has(row.index_in_image)) {
            console.error(`[Background] Step 5: Duplicate index_in_image detected: ${row.index_in_image}. This should not happen!`, { sessionId: createdSessionId, problemId: row.id });
          }
          idByIndex.set(row.index_in_image, row.id);
        }

        // 각 문제에 대해 taxonomy 조회하여 code, CEFR, 난이도 추가
        // items 배열의 인덱스와 problems 배열의 index_in_image가 일치하므로, 배열 인덱스를 직접 사용
        const labelsPayload = await Promise.all(items.map(async (it: any, idx: number) => {
          // user_marked_correctness가 "Unknown"인 경우 is_correct를 null로 설정
          const rawMark = it.user_marked_correctness;
          const isUnknown = rawMark && String(rawMark).trim().toLowerCase() === 'unknown';

          let isCorrect: boolean | null = null;
          if (!isUnknown) {
            const normalizedMark = normalizeMark(rawMark);
            isCorrect = normalizedMark === 'O'; // AI 분석 결과 저장 (O면 true, X면 false)
          }
          // Unknown인 경우는 null 유지 (사용자 검수 필요)

          const classification = it.classification || {};

          // ✅ taxonomy 분류: AI는 depth1~4를 출력하고, 서버는 depth→code로 정규화/보강한다.
          // cleanOrNull은 Step 3a에서 정의한 것을 사용(closure)

          const rawDepth1 = cleanOrNull(classification.depth1 ?? classification['depth1']);
          const rawDepth2 = cleanOrNull(classification.depth2 ?? classification['depth2']);
          const rawDepth3 = cleanOrNull(classification.depth3 ?? classification['depth3']);
          const rawDepth4 = cleanOrNull(classification.depth4 ?? classification['depth4']);

          const rawCode = cleanOrNull(classification.code ?? classification['code']);

          let depth1: string | null = rawDepth1;
          let depth2: string | null = rawDepth2;
          let depth3: string | null = rawDepth3;
          let depth4: string | null = rawDepth4;

          let taxonomyCode: string | null = null;
          let taxonomyCefr: string | null = null;
          let taxonomyDifficulty: number | null = null;

          // 1) depth1~4가 모두 있으면 → depth로 code/cefr/difficulty 조회
          const hasAnyDepth = !!(depth1 || depth2 || depth3 || depth4);
          const hasAllDepth = !!(depth1 && depth2 && depth3 && depth4);

          if (hasAllDepth) {
            const mapped = taxonomyByDepthKey.get(makeDepthKey(depth1!, depth2!, depth3!, depth4!));
            taxonomyCode = mapped?.code ?? null;
            taxonomyCefr = mapped?.cefr ?? null;
            taxonomyDifficulty = mapped?.difficulty ?? null;
            if (!taxonomyCode) {
              console.warn(`Taxonomy mapping failed for depth: ${depth1}/${depth2}/${depth3}/${depth4}`);
              // 기준표 밖의 값일 가능성이 높으므로 무효 처리
              depth1 = depth2 = depth3 = depth4 = null;
            }
          } else if (hasAnyDepth) {
            // depth 일부만 있는 경우는 애매하므로 무효 처리
            console.warn(`Partial depth provided. Invalid taxonomy depth path: ${depth1}/${depth2}/${depth3}/${depth4}`);
            depth1 = depth2 = depth3 = depth4 = null;
          }

          // 2) (호환) depth가 없고 code만 있으면 → code로 depth를 복원
          if (!taxonomyCode && rawCode) {
            const mapped = taxonomyByCode.get(rawCode);
            if (mapped) {
              taxonomyCode = mapped.code ?? null;
              taxonomyCefr = mapped.cefr ?? null;
              taxonomyDifficulty = mapped.difficulty ?? null;
              depth1 = mapped.depth1 ?? null;
              depth2 = mapped.depth2 ?? null;
              depth3 = mapped.depth3 ?? null;
              depth4 = mapped.depth4 ?? null;
            } else {
              console.warn(`Invalid taxonomy code: "${rawCode}" (not found)`);
            }
          }

          // classification에 code, CEFR, 난이도 추가 (유효한 값만 저장)
          // 빈 문자열도 null로 변환하여 저장 (gemma 모델이 빈 문자열을 반환하는 경우 대비)
          const enrichedClassification = {
            depth1: depth1,
            depth2: depth2,
            depth3: depth3,
            depth4: depth4,

            // 정규화된 taxonomy 코드/난이도
            code: taxonomyCode,
            CEFR: taxonomyCefr,
            난이도: taxonomyDifficulty,
          };

          // 배열 인덱스를 직접 사용 (problemsPayload에서 index_in_image: idx로 설정했으므로)
          const problemId = idByIndex.get(idx);
          if (!problemId) {
            console.error(`[Background] Step 5: Problem ID not found for array index ${idx}. This should not happen!`, {
              sessionId: createdSessionId,
              idByIndexSize: idByIndex.size,
              idByIndexKeys: Array.from(idByIndex.keys()),
              itemsLength: items.length
            });
            return null;
          }

          return {
            problem_id: problemId,
            user_answer: it.user_answer || '',
            user_mark: null, // 사용자 검수 전이므로 null
            is_correct: isCorrect, // AI 분석 결과 저장 (O면 true, X면 false, Unknown이면 null)
            classification: enrichedClassification,
          };
        }));

        // null 값 필터링 (problemId를 찾지 못한 항목 제외)
        const validLabelsPayload = labelsPayload.filter((label): label is NonNullable<typeof label> => label !== null);

        if (validLabelsPayload.length === 0) {
          console.warn(`[Background] Step 5 warning: No valid labels to insert`, { sessionId: createdSessionId, labelsPayloadLength: labelsPayload.length });
        } else {
          console.log(`[Background] Step 5: Inserting ${validLabelsPayload.length} labels...`, { sessionId: createdSessionId });
          const { error: labelsError } = await supabase.from('labels').insert(validLabelsPayload);
          if (labelsError) {
            console.error(`[Background] Step 5 error: Labels insert error`, { sessionId: createdSessionId, error: labelsError, validLabelsPayloadCount: validLabelsPayload.length });
            throw new StageError('insert_labels', 'Labels insert failed', { validLabelsPayloadCount: validLabelsPayload.length, error: summarizeError(labelsError) });
          }
        }

        console.log(`[Background] Step 5 completed: AI analysis results saved (pending user review)`, { sessionId: createdSessionId });

        // ✅ 사용자 퀵라벨링 카드 노출을 위해, 문제/라벨 저장이 끝나면 먼저 completed로 전환
        // (Step 6 메타데이터 생성 실패/지연과 UI 노출을 분리)
        if (problems && problems.length > 0) try {
          const { error: earlyStatusError } = await supabase
            .from('sessions')
            .update({ status: 'completed' })
            .eq('id', createdSessionId)
            .eq('status', 'processing');
          if (earlyStatusError) {
            console.error(`[Background] Step 5.5: Status early update error`, { sessionId: createdSessionId, error: earlyStatusError });
          } else {
            console.log(`[Background] Step 5.5: Session status updated to completed (early)`, { sessionId: createdSessionId });
          }
        } catch (e) {
          console.error(`[Background] Step 5.5: Status early update exception`, { sessionId: createdSessionId, error: e });
        }

        // 6. 문제 메타데이터 생성 및 저장
        console.log(`[Background] Step 6: Generate problem metadata...`, { sessionId: createdSessionId });

        if (!problems || problems.length === 0) {
          console.log(`[Background] Step 6 skipped: No problems to process`, { sessionId: createdSessionId });
        } else {
          const ai = new GoogleGenAI({ apiKey: geminiApiKey });

          // 문제와 원본 아이템을 매핑
          // items 배열의 인덱스와 problems의 index_in_image가 일치하므로, 배열 인덱스를 직접 사용
          const problemItemMap = new Map<number, any>();
          for (let i = 0; i < items.length; i++) {
            problemItemMap.set(i, items[i]);
          }

          // 문제와 labels를 매핑 (classification 정보 가져오기 위해)
          const problemLabelsMap = new Map<string, any>();
          for (const label of validLabelsPayload) {
            problemLabelsMap.set(label.problem_id, label);
          }

          console.log(`[Background] Step 6: Preparing batch metadata generation for ${problems.length} problems...`, { sessionId: createdSessionId });

          // Step 6은 "문제 수만큼 Gemini 호출" 시 rate limit/시간 초과로 통째로 실패하기 쉬움.
          // -> 한 번의 호출로 배열(JSON)로 받는 배치 방식으로 안정화.
          const batchInputs: Array<{
            problem_id: string;
            problem_type: string;
            stem: string;
            choices: string;
            user_answer: string;
            is_correct: boolean | null;
          }> = [];
          const problemTypeById = new Map<string, string>();

          for (const p of problems) {
            const originalItem = problemItemMap.get(p.index_in_image);
            const label = problemLabelsMap.get(p.id);

            if (!originalItem) continue;
            const stem = String(p.stem || '').trim();
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

            const choices = (p.choices || []).map((c: any) => c.text || c).join('\n');
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

          if (batchInputs.length === 0) {
            console.log(`[Background] Step 6 skipped: No valid problems to generate metadata`, { sessionId: createdSessionId });
          } else {
            const formattedList = batchInputs.map((it, idx) => {
              const correctness = it.is_correct === null ? (userLanguage === 'ko' ? '미상' : 'Unknown') : (it.is_correct ? (userLanguage === 'ko' ? '정답' : 'Correct') : (userLanguage === 'ko' ? '오답' : 'Incorrect'));
              return userLanguage === 'ko'
                ? `#${idx + 1}\nproblem_id: ${it.problem_id}\n문제 유형: ${it.problem_type}\n문제 내용:\n${it.stem}\n선택지:\n${it.choices}\n사용자 답안: ${it.user_answer}\n정답 여부: ${correctness}\n`
                : `#${idx + 1}\nproblem_id: ${it.problem_id}\nProblem Type: ${it.problem_type}\nProblem:\n${it.stem}\nChoices:\n${it.choices}\nUser Answer: ${it.user_answer}\nIs Correct: ${correctness}\n`;
            }).join('\n');

            const metadataPrompt = userLanguage === 'ko'
              ? `아래 영어 문제 목록에 대해 메타데이터를 생성해주세요.\n\n- 반드시 **JSON 배열만** 응답하세요 (설명/마크다운/코드펜스 금지).\n- 각 항목은 반드시 입력의 problem_id를 그대로 포함해야 합니다.\n\n응답 형식:\n[\n  {\n    \"problem_id\": \"...\",\n    \"difficulty\": \"상\" | \"중\" | \"하\",\n    \"word_difficulty\": 1-9 사이의 숫자,\n    \"analysis\": \"문제에 대한 상세 분석 정보 (한국어)\"\n  }\n]\n\n난이도 기준:\n- 상: 고등학교 수준 이상의 어려운 문제\n- 중: 중학교 수준의 문제\n- 하: 초등학교 수준의 쉬운 문제\n\n단어 난이도 기준:\n- 1-3: 초등학교 수준의 쉬운 단어\n- 4-6: 중학교 수준의 보통 단어\n- 7-9: 고등학교 수준 이상의 어려운 단어\n\n문제 목록:\n${formattedList}`
              : `Generate metadata for the following English problems.\n\n- Respond with **JSON array only** (no explanations/markdown/code fences).\n- Each item must include the exact problem_id from the input.\n\nResponse format:\n[\n  {\n    \"problem_id\": \"...\",\n    \"difficulty\": \"high\" | \"medium\" | \"low\",\n    \"word_difficulty\": 1-9,\n    \"analysis\": \"Detailed analysis (English)\"\n  }\n]\n\nProblems:\n${formattedList}`;

            let successCount = 0;
            let errorCount = 0;

            try {
              console.log(`[Background] Step 6: Calling Gemini for batch metadata (${batchInputs.length} problems)...`, { sessionId: createdSessionId });
              const metadataResponse = await ai.models.generateContent({
                model: METADATA_MODEL,
                contents: { parts: [{ text: metadataPrompt }] },
                generationConfig: {
                  responseMimeType: "application/json",
                  temperature: 0.0,
                },
              });

              let metadataText: string = '';
              if (metadataResponse?.text) {
                metadataText = typeof metadataResponse.text === 'function'
                  ? await metadataResponse.text()
                  : metadataResponse.text;
              } else if (metadataResponse?.response?.text) {
                metadataText = typeof metadataResponse.response.text === 'function'
                  ? await metadataResponse.response.text()
                  : metadataResponse.response.text;
              } else if (metadataResponse?.candidates?.[0]?.content?.parts?.[0]?.text) {
                metadataText = metadataResponse.candidates[0].content.parts[0].text;
              }

              if (!metadataText || typeof metadataText !== 'string') {
                throw new Error('Invalid metadata response text');
              }

              const jsonString = metadataText.replace(/```json/g, '').replace(/```/g, '').trim();
              let parsed: any;
              try {
                parsed = JSON.parse(jsonString);
              } catch {
                const arrMatch = jsonString.match(/\[[\s\S]*\]/);
                if (!arrMatch) throw new Error('No JSON array found in metadata response');
                parsed = JSON.parse(arrMatch[0]);
              }

              if (!Array.isArray(parsed)) {
                throw new Error('Metadata response is not an array');
              }

              for (const row of parsed) {
                const problemId = String(row?.problem_id || '').trim();
                if (!problemId) {
                  errorCount++;
                  continue;
                }
                const problemType = problemTypeById.get(problemId) || (userLanguage === 'ko' ? '분류 없음' : 'Unclassified');

                // 난이도 정규화
                let difficulty = row?.difficulty;
                if (userLanguage === 'en') {
                  const valid = ['high', 'medium', 'low'];
                  if (!valid.includes(difficulty)) {
                    if (difficulty === '상') difficulty = 'high';
                    else if (difficulty === '중') difficulty = 'medium';
                    else if (difficulty === '하') difficulty = 'low';
                    else difficulty = 'medium';
                  }
                } else {
                  const valid = ['상', '중', '하'];
                  if (!valid.includes(difficulty)) {
                    if (difficulty === 'high') difficulty = '상';
                    else if (difficulty === 'medium') difficulty = '중';
                    else if (difficulty === 'low') difficulty = '하';
                    else difficulty = '중';
                  }
                }

                // 단어 난이도 1-9
                const wdNum = Number(row?.word_difficulty);
                const wordDifficulty = (!isNaN(wdNum) && wdNum >= 1 && wdNum <= 9) ? Math.round(wdNum) : 5;

                const analysis = typeof row?.analysis === 'string' ? row.analysis : '';

                const { error: updateError } = await supabase
                  .from('problems')
                  .update({
                    problem_metadata: {
                      difficulty,
                      word_difficulty: wordDifficulty,
                      problem_type: problemType,
                      analysis,
                    }
                  })
                  .eq('id', problemId);

                if (updateError) {
                  console.error(`[Background] Step 6: Error updating metadata for problem ${problemId}:`, updateError, { sessionId: createdSessionId });
                  errorCount++;
                  continue;
                }
                successCount++;
              }

              console.log(`[Background] Step 6 completed: Batch metadata saved for ${successCount}/${batchInputs.length} problems (${errorCount} errors)`, { sessionId: createdSessionId });
            } catch (error) {
              console.error(`[Background] Step 6: Batch metadata generation failed:`, error, { sessionId: createdSessionId });
            }
          }
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
