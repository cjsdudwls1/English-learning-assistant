// @ts-nocheck
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { GoogleGenAI } from "https://esm.sh/@google/genai@1.21.0"
import { createServiceSupabaseClient } from './_shared/supabaseClient.ts'
import { requireEnv } from './_shared/env.ts'
import { errorResponse, handleOptions, jsonResponse } from './_shared/http.ts'
import { loadTaxonomyData, fetchTaxonomyByCode } from './_shared/taxonomy.ts'

// 2단계 프롬프트 로직: Step 1 (Raw OCR) + Step 2 (Extraction)
function buildPrompt(classificationData: { structure: string; optionsText: string; codes: string[] }, language: 'ko' | 'en' = 'ko', imageCount: number = 1) {
  const { structure, optionsText, codes } = classificationData;
  const allowedCodes = JSON.stringify(codes);
  
  return `
## Role
당신은 시험 문제 이미지를 분석하여 디지털 데이터로 변환하는 AI 전문가입니다.
${imageCount > 1 ? `사용자가 업로드한 **${imageCount}장의 이미지**는 하나의 시험지가 연결된 것입니다.` : ''}

## Critical Processing Rules

### Layout & Reading Order
1. **다단(Multi-Column) 레이아웃을 즉시 감지하세요.**
2. **엄격하게 위에서 아래로, 왼쪽에서 오른쪽으로 읽으세요.**
3. **한 단이 불완전한 문장으로 끝나면**, 다음 단의 상단과 시각적으로 연결하세요.
4. **⚠️ 불완전한 문제 감지 (Critical):**
   - 텍스트가 마침표(.)로 끝났더라도, **객관식 보기(①, ②, ③...)나 지문 (A), (B), (C)가 발견되지 않았다면**, 반드시 **오른쪽 단 상단**이나 **다음 이미지 상단**에서 나머지를 찾아 연결하세요.
   - 문장이 끝났다고 해서 문제가 끝난 것이 아닙니다. **보기나 지문이 없으면 절대 멈추지 마세요.**

### Grouped Question Separation ([n~m])
- 범위형 문항(예: "[36~37]" 또는 "[38-39]")을 만나면, 반드시 **개별 문제 객체로 분리**해야 합니다.
- **CRITICAL:** 공유된 지문/맥락은 각 문제 객체의 \`question_text\` 필드에 **완전히 복사**해야 합니다. 참조하지 말고 복사하세요.
- 범위 표시(예: "[36~37]")는 문제 내용에 포함시키지 마세요.

### Continuity Across Images
- 페이지 하단의 텍스트가 잘렸다면, \`page_ended_incomplete: true\`를 설정하세요.
- 잘린 텍스트를 환각하거나 완성하지 마세요. 보이는 것만 정확히 추출하세요.
- 이미지가 잘려서 읽을 수 없으면 \`[UNREADABLE]\`로 표시하세요. **절대 내용을 상상하거나 보충하지 마세요.**

### Deduplication
- 동일한 문제 번호(예: "36")를 두 번 생성하지 마세요.
- "36~37" 또는 "[36-37]" 같은 범위 표시는 문제 번호가 아닙니다. 이를 개별 문제로 분리하는 지시로만 사용하세요.

## Classification Criteria
\`\`\`
${structure}
\`\`\`
* 분류는 **taxonomy 옵션(code) 중 하나를 선택**하는 방식으로 하세요. (절대 임의 텍스트 생성 금지)
* 선택 규칙:
  - \`classification.code\`는 반드시 아래 **허용 코드 목록** 중 하나여야 합니다.
  - 확신이 없으면 \`classification.code\`는 \`null\`로 두세요.

### Allowed codes (must choose from this list)
${allowedCodes}

### Taxonomy options (code → depth path)
${optionsText}

## Output Format (JSON Only)
반드시 아래 형식의 JSON만 응답하세요:

\`\`\`json
{
  "layout_type": "single_column" | "multi_column",
  "page_ended_incomplete": boolean,
  "last_text_snippet": "string (페이지 하단의 마지막 5-10단어, 이미지 연결용)",
  "raw_text_summary": "전체 텍스트 흐름 요약 (다단 연결 및 중복 확인용)",
  "items": [
    {
      "index": 0,
      "problem_number": "36",
      "question_text": "문제의 전체 지문과 질문 내용 (지문이 길 경우 합쳐서 기술)",
      "choices": ["① Choice 1", "② Choice 2", "③ Choice 3", "④ Choice 4", "⑤ Choice 5"],
      "user_marked_correctness": "O" | "X" | "Unknown",
      "user_answer": "3",
      "classification": {
        "code": "허용 코드 중 1개 또는 null"
      }
    }
  ]
}
\`\`\`

## Field Writing Rules
- **problem_number**: 숫자만 추출 (문자열). 범위형 문항([38-39])은 반드시 두 개의 독립된 문제로 분리.
- **question_text**: 문제 제목, 본문, 지문 내용을 모두 포함. 단, "[36~37]..." 같은 안내 문구는 제거.
  - **⚠️ 중요:** 텍스트가 마침표로 끝나도 보기(①, ②...)나 지문(A, B, C)이 없으면 오른쪽 단/다음 페이지에서 찾아 연결.
  - **⚠️ 환각 금지:** 이미지가 잘려서 읽을 수 없으면 "[UNREADABLE]"로 표시. 절대 내용을 상상하거나 보충하지 마세요.
- **choices**: 보기 문항이 있다면 배열로 포함. (없으면 빈 배열 [])
  - 보기가 없으면 오른쪽 단 상단이나 다음 이미지에서 찾아야 합니다.
- **user_marked_correctness**: "O" (정답/동그라미), "X" (오답/가위표/빗금), "Unknown" (표시 없음).
- **classification**: 반드시 허용 코드에서만 선택. 불확실하면 code=null.
`;
}

function normalizeMark(raw: unknown): 'O' | 'X' {
  if (raw === undefined || raw === null) return 'X';
  const value = String(raw).trim().toLowerCase();
  const truthy = new Set(['o', '✓', 'v', 'correct', 'true', '정답', '맞음', 'ok', '⭕', 'circle', 'check', 'checkmark']);
  if (truthy.has(value)) return 'O';
  return 'X';
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
          parts.push({ inlineData: { data: img.imageBase64, mimeType: img.mimeType } });
          console.log(`[Background] Step 3b: Added image ${i + 1}/${imageList.length} to parts array:`, { 
            sessionId: createdSessionId,
            fileName: img.fileName,
            mimeType: img.mimeType,
            base64Length: img.imageBase64.length
          });
        }

        console.log(`[Background] Step 3b: Calling Gemini API with ${imageList.length} image(s)...`, { 
          sessionId: createdSessionId,
          partsLength: parts.length,
          expectedImages: imageList.length,
          actualImages: parts.length - 1 // parts[0] is text prompt
        });
        
        // parts 배열 검증
        if (!parts || !Array.isArray(parts) || parts.length === 0) {
          throw new Error(`Invalid parts array: ${JSON.stringify(parts)}`);
        }
        
        if (parts.length - 1 !== imageList.length) {
          console.error(`[Background] Step 3b: Parts array length mismatch! Expected ${imageList.length + 1} parts (1 text + ${imageList.length} images), got ${parts.length}`, { sessionId: createdSessionId });
          throw new Error(`Parts array length mismatch: expected ${imageList.length + 1}, got ${parts.length}`);
        }
        
        // Gemini API 호출 (503 오류 재시도 로직 포함)
        const MAX_RETRIES = 5;
        const BASE_DELAY = 5000; // 5초 기본 대기
        let attempt = 0;
        let response: any;
        let responseText: string = '';
        
        while (attempt < MAX_RETRIES) {
          try {
            console.log(`[Background] Step 3b: Gemini API call attempt ${attempt + 1}/${MAX_RETRIES}...`, { sessionId: createdSessionId });
            
            response = await ai.models.generateContent({
              model: 'gemini-2.5-flash',
              contents: { parts },
              generationConfig: {
                responseMimeType: "application/json",
                temperature: 0.1,
              },
            });
            
            // 성공했으면 반복문 탈출
            break;
          } catch (apiError: any) {
            attempt++;
            
            // 에러 정보 파싱
            const errorCode = apiError?.status || apiError?.error?.code || 0;
            const errorMessage = apiError?.message || apiError?.error?.message || String(apiError);
            const errorStatus = apiError?.error?.status || '';
            
            console.error(`[Background] Step 3b: Gemini API error (attempt ${attempt}/${MAX_RETRIES}):`, {
              sessionId: createdSessionId,
              errorCode,
              errorStatus,
              errorMessage: errorMessage.substring(0, 200),
            });
            
            // 503, 429, 타임아웃 오류인지 확인
            const isRateLimit = errorCode === 429 || errorMessage.toLowerCase().includes('rate limit') || errorMessage.toLowerCase().includes('quota');
            const isServerOverload = errorCode === 503 || errorMessage.toLowerCase().includes('overloaded') || errorMessage.toLowerCase().includes('unavailable') || errorStatus === 'UNAVAILABLE';
            const isTimeout = errorMessage.toLowerCase().includes('timeout') || errorCode === 504;
            
            // 마지막 시도였거나 재시도할 가치가 없는 오류면 throw
            if (attempt >= MAX_RETRIES || (!isRateLimit && !isServerOverload && !isTimeout)) {
              console.error(`[Background] Step 3b: Gemini API failed after ${attempt} attempts`, { sessionId: createdSessionId });
              throw apiError;
            }
            
            // 재시도 가능한 오류면 대기 후 재시도 (Exponential Backoff)
            const delay = BASE_DELAY * Math.pow(2, attempt - 1);
            console.warn(`[Background] Step 3b: Retrying in ${delay/1000}s... (attempt ${attempt}/${MAX_RETRIES})`, { sessionId: createdSessionId });
            await new Promise(resolve => setTimeout(resolve, delay));
          }
        }
        
        // 응답이 없으면 에러
        if (!response) {
          throw new Error('Gemini API 호출 실패: 응답이 없습니다.');
        }

        // 여러 경로로 텍스트 추출 시도
        if (response?.text) {
          responseText = typeof response.text === 'function' 
            ? await response.text() 
            : response.text;
        } else if (response?.response?.text) {
          responseText = typeof response.response.text === 'function' 
            ? await response.response.text() 
            : response.response.text;
        } else if (response?.candidates?.[0]?.content?.parts?.[0]?.text) {
          responseText = response.candidates[0].content.parts[0].text;
        } else {
          // RECITATION 등으로 content가 없는 경우 빈 응답 생성
          const finishReason = response?.candidates?.[0]?.finishReason;
          if (finishReason === 'RECITATION' || !response?.candidates?.[0]?.content) {
            console.warn(`[Background] Step 3b: No content in response (finishReason: ${finishReason}), creating empty result`, { 
              sessionId: createdSessionId
            });
            responseText = JSON.stringify({ items: [] });
          } else {
            // 응답 구조를 로깅하고 에러 발생
            console.error(`[Background] Step 3b error: Unexpected response structure`, { 
              sessionId: createdSessionId,
              hasCandidates: !!response?.candidates,
              candidatesLength: response?.candidates?.length,
              firstCandidate: response?.candidates?.[0] ? {
                finishReason: response.candidates[0].finishReason,
                hasContent: !!response.candidates[0].content,
                hasParts: !!response.candidates[0].content?.parts
              } : null,
              response: JSON.stringify(response, null, 2).substring(0, 1000)
            });
            throw new Error('Gemini API 응답에서 텍스트를 찾을 수 없습니다. 응답 구조가 예상과 다릅니다.');
          }
        }
        
        if (!responseText || typeof responseText !== 'string') {
          console.error(`[Background] Step 3b error: Invalid response text`, { 
            sessionId: createdSessionId, 
            responseTextType: typeof responseText,
            responseTextLength: responseText?.length
          });
          throw new Error('Invalid response from Gemini API: response.text is not a string');
        }
        
        console.log(`[Background] Step 3 completed: Gemini response received`, { sessionId: createdSessionId, responseLength: responseText.length });
    
        // JSON 파싱
        console.log(`[Background] Step 3c: Parsing JSON response...`, { sessionId: createdSessionId });
        const jsonString = responseText.replace(/```json/g, '').replace(/```/g, '').trim();
        let result: any;
        try {
          result = JSON.parse(jsonString);
        } catch (parseError: any) {
          console.error(`[Background] Step 3c error: JSON parse failed`, { sessionId: createdSessionId, error: parseError.message, jsonStringPreview: jsonString.substring(0, 500) });
          throw new Error(`JSON 파싱 실패: ${parseError.message}`);
        }

        if (!result || !Array.isArray(result.items)) {
          console.error(`[Background] Step 3c error: Invalid response format`, { sessionId: createdSessionId, hasResult: !!result, hasItems: !!result?.items, itemsIsArray: Array.isArray(result?.items) });
          throw new Error('AI 응답 형식 오류: items 배열이 없습니다.');
        }

        // raw_text_context 확인 (CoT 강제 확인)
        if (result.raw_text_context) {
          console.log(`[Background] Step 3c: raw_text_context found (length: ${result.raw_text_context.length})`, { sessionId: createdSessionId });
        } else {
          console.warn(`[Background] Step 3c: raw_text_context missing - AI may have skipped Step 1`, { sessionId: createdSessionId });
        }

        console.log(`[Background] Step 3 completed: Parsed ${result.items.length} items from analysis`, { sessionId: createdSessionId });

        // 유효성 검사 및 문제 분리 (범위 표시가 있는 경우 분리)
        const validatedItems = validateAndSplitProblems(result.items);
        if (validatedItems.length !== result.items.length) {
          console.log(`[Background] Step 3 validation: Split ${result.items.length} items into ${validatedItems.length} items`, { sessionId: createdSessionId });
        }

        // ✅ 문제를 하나도 추출하지 못한 경우: UI에서 "사라지는 completed(0문제)" 상태를 만들지 않도록 실패 처리
        if (!validatedItems || validatedItems.length === 0) {
          console.error(`[Background] No problems extracted. Marking session as failed.`, { sessionId: createdSessionId });
          try {
            await supabase
              .from('sessions')
              .update({ status: 'failed' })
              .eq('id', createdSessionId);
          } catch (e) {
            console.error(`[Background] Failed to update session status to failed (no problems)`, { sessionId: createdSessionId, error: e });
          }
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
          throw problemsError;
        }

        console.log(`[Background] Step 4 completed: Inserted ${problems?.length || 0} problems`, { sessionId: createdSessionId });

        if (!problems || problems.length === 0) {
          console.error(`[Background] Step 4 produced 0 problems. Marking session as failed.`, { sessionId: createdSessionId });
          try {
            await supabase
              .from('sessions')
              .update({ status: 'failed' })
              .eq('id', createdSessionId);
          } catch (e) {
            console.error(`[Background] Failed to update session status to failed (0 inserted)`, { sessionId: createdSessionId, error: e });
          }
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
    const allowedTaxonomyCodes = new Set<string>(taxonomyData.codes || []);
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
      
      // taxonomy 기반 선택형: code만 선택하도록 강제하고, 서버에서 code→depth path로 정규화
      const rawCode = String(classification.code || classification['code'] || '').trim();
      const validCode = rawCode && allowedTaxonomyCodes.has(rawCode) ? rawCode : null;
      if (!validCode && rawCode) {
        console.warn(`Invalid taxonomy code: "${rawCode}" (not in allowed codes)`);
      }

      const taxonomyRow = validCode ? await fetchTaxonomyByCode(supabase, validCode) : null;
      const depth1 = userLanguage === 'en' ? taxonomyRow?.depth1_en : taxonomyRow?.depth1;
      const depth2 = userLanguage === 'en' ? taxonomyRow?.depth2_en : taxonomyRow?.depth2;
      const depth3 = userLanguage === 'en' ? taxonomyRow?.depth3_en : taxonomyRow?.depth3;
      const depth4 = userLanguage === 'en' ? taxonomyRow?.depth4_en : taxonomyRow?.depth4;
      
      // classification에 code, CEFR, 난이도 추가 (유효한 값만 저장)
      const enrichedClassification = {
        '1Depth': depth1 || null,
        '2Depth': depth2 || null,
        '3Depth': depth3 || null,
        '4Depth': depth4 || null,
        code: validCode,
        CEFR: taxonomyRow?.cefr ?? null,
        난이도: taxonomyRow?.difficulty ?? null,
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
            throw labelsError;
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
              classification['1Depth'],
              classification['2Depth'],
              classification['3Depth'],
              classification['4Depth'],
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
                model: 'gemini-2.5-flash',
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
        
        // 백그라운드 분석 실패 시 세션 상태를 failed로 업데이트
        try {
          console.log(`[Background] Updating session status to failed...`, { sessionId: createdSessionId });
          const { error: statusError } = await supabase
            .from('sessions')
            .update({ status: 'failed' })
            .eq('id', createdSessionId);
          
          if (statusError) {
            console.error(`[Background] Failed to update session status to failed`, { sessionId: createdSessionId, error: statusError });
          } else {
            console.log(`[Background] Session status updated to failed due to background error`, { sessionId: createdSessionId });
          }
        } catch (statusError: any) {
          console.error(`[Background] Exception while updating session status to failed`, { sessionId: createdSessionId, error: statusError });
        }
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
      try {
        console.log('Updating session status to failed...');
        await supabase
          .from('sessions')
          .update({ status: 'failed' })
          .eq('id', createdSessionId);
        console.log('Session status updated to failed');
      } catch (statusError) {
        console.error('Failed to update session status to failed:', statusError);
      }
    }
    
    return errorResponse(error.message || 'Internal server error', 500, error.toString());
  }
});