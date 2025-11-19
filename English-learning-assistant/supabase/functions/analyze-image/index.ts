// @ts-nocheck
import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { GoogleGenAI } from "https://esm.sh/@google/genai@1.21.0"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { parseApiError } from '../_shared/errorHandling.ts'

// EdgeRuntime 타입 정의 (Supabase Edge Functions에서 제공)
declare const EdgeRuntime: {
  waitUntil(promise: Promise<any>): void;
};

// 공유 유틸리티 함수들
function requireEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) {
    throw new Error(`${name} environment variable is not set`);
  }
  return value;
}

function createServiceSupabaseClient() {
  const supabaseUrl = requireEnv('SUPABASE_URL');
  const supabaseServiceKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
  return createClient(supabaseUrl, supabaseServiceKey);
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS, PUT, DELETE',
  'Access-Control-Max-Age': '86400',
};

function jsonResponse<T>(body: T, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

function errorResponse(message: string, status = 500, details?: unknown): Response {
  return jsonResponse({ error: message, details }, status);
}

function handleOptions(): Response {
  return new Response(null, { status: 200, headers: CORS_HEADERS });
}

// Taxonomy 데이터를 DB에서 동적으로 로드하는 함수
async function loadTaxonomyData(supabase: any, language: 'ko' | 'en' = 'ko'): Promise<{ structure: string; allValues: { depth1: string[]; depth2: string[]; depth3: string[]; depth4: string[] } }> {
  console.log('Loading taxonomy data from database...', { language });
  
  const depth1Col = language === 'en' ? 'depth1_en' : 'depth1';
  const depth2Col = language === 'en' ? 'depth2_en' : 'depth2';
  const depth3Col = language === 'en' ? 'depth3_en' : 'depth3';
  const depth4Col = language === 'en' ? 'depth4_en' : 'depth4';
  
  const { data, error } = await supabase
    .from('taxonomy')
    .select(`${depth1Col}, ${depth2Col}, ${depth3Col}, ${depth4Col}`)
    .order(`${depth1Col}, ${depth2Col}, ${depth3Col}, ${depth4Col}`);
  
  if (error) {
    console.error('Error loading taxonomy:', error);
    throw error;
  }
  
  // 계층 구조로 변환
  const structure: any = {};
  const allValues: { depth1: Set<string>; depth2: Set<string>; depth3: Set<string>; depth4: Set<string> } = {
    depth1: new Set(),
    depth2: new Set(),
    depth3: new Set(),
    depth4: new Set(),
  };
  
  for (const row of data || []) {
    const d1 = row[depth1Col] || '';
    const d2 = row[depth2Col] || '';
    const d3 = row[depth3Col] || '';
    const d4 = row[depth4Col] || '';
    
    if (d1) allValues.depth1.add(d1);
    if (d2) allValues.depth2.add(d2);
    if (d3) allValues.depth3.add(d3);
    if (d4) allValues.depth4.add(d4);
    
    if (!structure[d1]) structure[d1] = {};
    if (!structure[d1][d2]) structure[d1][d2] = {};
    if (!structure[d1][d2][d3]) structure[d1][d2][d3] = [];
    if (d4 && !structure[d1][d2][d3].includes(d4)) {
      structure[d1][d2][d3].push(d4);
    }
  }
  
  // 문자열로 변환
  function formatStructure(obj: any, indent = 0): string {
    let result = '';
    const spaces = '  '.repeat(indent);
    
    for (const [key, value] of Object.entries(obj)) {
      result += spaces + key + '\n';
      if (typeof value === 'object' && !Array.isArray(value)) {
        result += formatStructure(value, indent + 1);
      } else if (Array.isArray(value)) {
        value.forEach((item: string) => {
          result += spaces + '  ' + item + '\n';
        });
      }
    }
    
    return result;
  }
  
  const taxonomyTree = formatStructure(structure);
  console.log('Taxonomy data loaded:', taxonomyTree.substring(0, 200) + '...');
  
  return {
    structure: taxonomyTree,
    allValues: {
      depth1: Array.from(allValues.depth1).sort(),
      depth2: Array.from(allValues.depth2).sort(),
      depth3: Array.from(allValues.depth3).sort(),
      depth4: Array.from(allValues.depth4).sort(),
    },
  };
}

// depth1~4로 taxonomy 조회하여 code, CEFR, 난이도 찾기
async function findTaxonomyByDepth(
  supabase: any,
  depth1: string,
  depth2: string,
  depth3: string,
  depth4: string,
  language: 'ko' | 'en' = 'ko'
): Promise<{ code: string | null; cefr: string | null; difficulty: number | null }> {
  const depth1Col = language === 'en' ? 'depth1_en' : 'depth1';
  const depth2Col = language === 'en' ? 'depth2_en' : 'depth2';
  const depth3Col = language === 'en' ? 'depth3_en' : 'depth3';
  const depth4Col = language === 'en' ? 'depth4_en' : 'depth4';
  
  const { data, error } = await supabase
    .from('taxonomy')
    .select('code, cefr, difficulty')
    .eq(depth1Col, depth1)
    .eq(depth2Col, depth2)
    .eq(depth3Col, depth3)
    .eq(depth4Col, depth4)
    .single();
  
  if (error || !data) {
    if (error && error.code !== 'PGRST116') {
      console.warn('Taxonomy lookup error:', error);
    }
    return { code: null, cefr: null, difficulty: null };
  }
  
  return {
    code: data.code || null,
    cefr: data.cefr || null,
    difficulty: data.difficulty || null,
  };
}

function buildPrompt(classificationData: { structure: string; allValues: { depth1: string[]; depth2: string[]; depth3: string[]; depth4: string[] } }, language: 'ko' | 'en' = 'ko') {
  const { structure, allValues } = classificationData;
  
  // 언어에 따라 프롬프트 언어 변경 (현재는 한국어 프롬프트만 있으므로 영어일 때는 영어로 번역 필요)
  const isEnglish = language === 'en';
  
  return `
### 1. 페르소나 (Persona) ###
당신은 두 가지 전문성을 겸비한 최고 수준의 AI 전문가입니다:
1.  **손글씨 OCR 전문가**: 불규칙한 필기, 겹쳐 쓴 글씨, 다양한 필기구의 흔적까지 분석하여 디지털 텍스트로 변환하는 데 특화되어 있습니다. 펜의 압력, 기울기, 획의 연결성과 같은 미세한 특징을 파악하여 문맥 기반으로 모호한 글자를 추론하는 능력이 뛰어납니다.
2.  **영어 교육 평가 전문가**: 다양한 유형의 영어 문제를 이해하고, 교육과정 분류 체계에 따라 문제의 핵심 의도를 파악하여 정확하게 분류할 수 있습니다.

### 2. 과업 (Task) ###
사용자가 업로드한 영어 문제 이미지 한 장을 종합적으로 분석하여, 이미지 내의 모든 텍스트와 손글씨를 인식하고, 문제 유형을 분류한 뒤, 분석된 모든 정보를 지정된 JSON 형식에 맞춰 단 하나의 결과물로 출력해야 합니다.

### 3. 맥락 (Context) ###
- **입력 데이터 1 (이미지)**: 사용자가 촬영하거나 업로드한 영어 문제 이미지 파일. 이 이미지에는 인쇄된 문제 텍스트, 객관식 보기, 그리고 사용자가 손으로 작성한 답안 및 채점 표시(O, X, △, ✓, 취소선 등)가 포함되어 있습니다.
- **입력 데이터 2 (분류 기준표)**: 문제 유형을 분류하기 위한 기준이 되는 데이터입니다.

**분류 기준표 계층 구조:**
\`\`\`
${structure}
\`\`\`

**⚠️ 절대 규칙:**
- 위 계층 구조에 나와있는 정확한 depth1, depth2, depth3, depth4 값만 사용하세요.
- 공백이나 특수문자(·)를 변경하지 마세요. (예: ❌ "문장유형" → ✅ "문장 유형·시제·상")
- 임의의 값이나 약어를 사용하지 마세요. (예: ❌ "어휘" → ✅ "어휘·연결")
- 계층 구조를 정확히 따라야 합니다 (depth1 → depth2 → depth3 → depth4).

### 4. 단계별 지시 (Step-by-Step Instructions / Chain-of-Thought) ###
다음 단계를 순서대로, 그리고 신중하게 수행하여 최종 결과물을 도출하세요.

**[1단계: 이미지 전처리 및 영역 구분]**
- 이미지 전체를 스캔하여 인쇄된 텍스트 영역(문제 본문, 보기)과 손글씨가 있을 가능성이 높은 영역(답안 작성란, 채점 마킹 영역)을 명확하게 구분하세요.

**[2단계: 텍스트 및 마킹 인식]**
- **인쇄 텍스트 추출**: 문제 본문과 객관식 보기(예: ①, ②, ③, ④, ⑤) 텍스트를 정확하게 추출합니다.
- **손글씨 답안 인식**:
    - **컨텍스트 활용**: 주변 인쇄 텍스트(문제 내용)의 맥락과 일반적인 영어 문법 규칙을 활용하여 사용자가 작성한 답안을 추론합니다.
    - **특징 분석**: 획의 시작점, 끝점, 글자 간 간격, 크기 비율을 분석하여 유사 문자(예: 1/l, 0/O, 5/S)를 정밀하게 구분합니다.
    - **다중 해석 처리**: 만약 손글씨가 불명확하여 여러 가지로 해석될 수 있다면(예: '3'인지 '5'인지 모호한 경우), 가장 가능성이 높은 답을 기본값으로 하되, 가능한 모든 대체 해석을 수집해 둡니다.
- **채점 마킹 인식**: 이미지에 표시된 채점 마크를 인식하되, 최종 출력에서는 반드시 다음 규칙을 따릅니다.
    - 최종 값은 오직 "O" 또는 "X" 둘 중 하나만 사용합니다.
    - 원형/체크/정답 표식은 모두 "O"로 통일합니다.
    - 교차선/오답 표식은 모두 "X"로 통일합니다.
    - 그 외 표식(△, 취소선 등)이 보이더라도 상황 판단하여 "O" 또는 "X" 중 하나로 결정합니다.

**[3단계: 문제 유형 분류]**
- [2단계]에서 추출한 문제 텍스트를 기반으로, 주어진 분류 기준표를 참조하여 문제의 유형을 "1Depth"부터 "4Depth"까지 분류합니다.
- 분류의 정확도에 대한 자체적인 신뢰도를 '높음', '보통', '낮음' 중 하나로 평가하고, 왜 그렇게 분류했는지에 대한 구체적인 근거를 한 문장으로 요약합니다.

**[4단계: 후처리 및 신뢰도 평가]**
- 인식된 모든 텍스트(특히 손글씨)에 대해 영어 사전을 기반으로 맞춤법 교정을 시도합니다. 만약 단어를 교정했다면, 해당 사실을 기록해 둡니다.
- 추출 및 분석된 각 데이터 항목(문제내용, 사용자 답안 등)에 대해 개별적인 인식 신뢰도(Confidence Score)를 백분율로 평가합니다.

### 5. 출력 명세 (Output Specification) ###
이미지 한 장에 여러 문항이 있을 수 있으므로, 반드시 아래 구조의 JSON 객체 하나만 출력하세요.

\`\`\`json
{
  "items": [
    {
      "index": 0,
      "사용자가_직접_채점한_정오답": "O | X",
      "문제내용": { "text": "...", "confidence_score": 0.98 },
      "문제_보기": [ { "text": "① ...", "confidence_score": 0.99 } ],
      "사용자가_기술한_정답": {
        "text": "...",
        "confidence_score": 0.85,
        "auto_corrected": false,
        "alternate_interpretations": ["..."]
      },
      "문제_유형_분류": {
        "1Depth": "...",
        "2Depth": "...",
        "3Depth": "...",
        "4Depth": "...",
        "분류_신뢰도": "높음"
      },
      "분류_근거": "..."
    }
  ]
}
\`\`\`

### 6. 제약 및 예외 처리 (Constraints & Error Handling) ###
- **이미지 품질 저하**: 이미지가 너무 흐릿하거나 빛 반사가 심해 내용을 판독할 수 없는 경우, JSON의 모든 값을 "인식불가"로 채우세요.
- **비영어 문제**: 분석 결과, 내용이 영어가 아니라고 판단되면 JSON의 모든 값을 "영어 문제 아님"으로 채우세요.
- **분류 모호성**: 문제 유형 분류가 애매하여 두 개 이상의 카테고리에 걸쳐 있다고 판단될 경우, 가장 가능성이 높은 하나를 선택하되, "분류_신뢰도"를 "낮음"으로 설정하세요.
- **불필요한 정보**: 프롬프트에 명시되지 않은 어떠한 정보도 추가로 생성하거나 출력하지 마세요.
`;

function normalizeMark(raw: unknown): 'O' | 'X' {
  if (raw === undefined || raw === null) return 'X';
  const value = String(raw).trim().toLowerCase();
  const truthy = new Set(['o', '✓', 'v', 'correct', 'true', '정답', '맞음', 'ok', '⭕', 'circle', 'check', 'checkmark']);
  if (truthy.has(value)) return 'O';
  return 'X';
}

// 백그라운드 작업 함수: Gemini API 호출 및 DB 저장
async function analyzeImageInBackground(
  sessionId: string,
  imageBase64: string,
  mimeType: string,
  userLanguage: 'ko' | 'en',
  geminiApiKey: string
): Promise<void> {
  const supabase = createServiceSupabaseClient();
  
  try {
    // 3. Taxonomy 데이터 로드
    console.log('[Background] Step 3a: Loading taxonomy data from database...', { language: userLanguage });
    const taxonomyData = await loadTaxonomyData(supabase, userLanguage);
    const prompt = buildPrompt(taxonomyData, userLanguage);
    
    // 3. Gemini API로 분석 (재시도 로직 적용)
    console.log('[Background] Step 3b: Analyzing image with Gemini...');
    const ai = new GoogleGenAI({ apiKey: geminiApiKey });

    const imagePart = { inlineData: { data: imageBase64, mimeType } };
    const textPart = { text: prompt };

    let responseText: string;
    
    // 재시도 설정
    const MAX_RETRIES = 5; // 최대 5번까지 재시도
    const BASE_DELAY = 5000; // 기본 5초 대기 (서버 복구 시간 고려)

    let attempt = 0;
    while (attempt < MAX_RETRIES) {
      try {
        const timeoutMs = 50000; // 50초 타임아웃
        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error('Gemini API request timeout')), timeoutMs);
        });
        
        const apiPromise = ai.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: { parts: [textPart, imagePart] },
        });
        
        console.log(`[Background] Attempt ${attempt + 1}/${MAX_RETRIES}: Starting Gemini API call with ${timeoutMs/1000}s timeout...`);
        const startTime = Date.now();
        
        const response = await Promise.race([apiPromise, timeoutPromise]);
        const elapsedTime = Date.now() - startTime;
        
        console.log(`[Background] Gemini API call completed in ${elapsedTime}ms`);
        responseText = response.text;
        console.log('[Background] Step 3 completed: Gemini response received, length:', responseText.length);
        
        // 성공했으면 반복문 탈출
        break;
      } catch (apiError: any) {
        attempt++;
        
        // 에러 정보 상세 로깅
        console.error(`[Background] Gemini API error (attempt ${attempt}/${MAX_RETRIES}):`, apiError);
        console.error(`[Background] Error type:`, typeof apiError);
        console.error(`[Background] Error keys:`, apiError ? Object.keys(apiError) : 'N/A');
        if (apiError?.error) {
          console.error(`[Background] Nested error:`, apiError.error);
        }
        
        // 에러 정보 파싱 (공통 유틸리티 사용)
        const parsedError = parseApiError(apiError);
        const errorMessage = parsedError.message;
        const errorCode = parsedError.code;
        const errorStatus = parsedError.status;
        
        console.log(`[Background] Parsed error - code: ${errorCode}, status: ${errorStatus}, message: ${errorMessage.substring(0, 100)}`);
        
        const isRateLimit = errorCode === 429 || errorMessage.includes('429') || errorMessage.toLowerCase().includes('rate limit') || errorMessage.toLowerCase().includes('quota');
        const isServerOverload = errorCode === 503 || errorMessage.includes('503') || errorMessage.toLowerCase().includes('overloaded') || errorMessage.toLowerCase().includes('unavailable') || errorStatus === 'UNAVAILABLE';
        const isTimeout = errorMessage.includes('timeout') || errorMessage.includes('Timeout') || errorMessage.includes('TIMEOUT') || errorCode === 504;
        
        console.log(`[Background] Error classification - RateLimit: ${isRateLimit}, ServerOverload: ${isServerOverload}, Timeout: ${isTimeout}`);
        
        // 마지막 시도였거나, 재시도할 가치가 없는 에러라면 throw
        if (attempt >= MAX_RETRIES || (!isRateLimit && !isServerOverload && !isTimeout)) {
          console.error(`[Background] Gemini API failed after ${attempt} attempts:`, { code: errorCode, status: errorStatus, message: errorMessage });
          throw new Error(`Gemini API error: ${errorMessage}`);
        }
        
        // 429, 503, 또는 타임아웃이면 잠시 대기 후 재시도 (Exponential Backoff)
        // 1번째: 5초, 2번째: 10초, 3번째: 20초, 4번째: 40초 대기
        const delay = BASE_DELAY * Math.pow(2, attempt - 1);
        console.warn(`[Background] Hit rate limit/overload/timeout (code: ${errorCode}, status: ${errorStatus}). Retrying in ${delay/1000}s... (Attempt ${attempt}/${MAX_RETRIES})`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
    
    // JSON 파싱
    const jsonString = responseText.replace(/```json/g, '').replace(/```/g, '').trim();
    let result: any;
    try {
      result = JSON.parse(jsonString);
    } catch (parseError) {
      console.error('[Background] JSON parsing error:', parseError);
      console.error('[Background] Response text:', responseText.substring(0, 500));
      throw new Error(`Failed to parse AI response as JSON: ${parseError instanceof Error ? parseError.message : 'Unknown parsing error'}`);
    }

    if (!result || !Array.isArray(result.items)) {
      throw new Error('AI 응답 형식 오류: items 배열이 없습니다.');
    }

    console.log(`[Background] Step 3 completed: Parsed ${result.items.length} items from analysis`);

    // 4. 문제 저장
    console.log('[Background] Step 4: Save problems to database...');
    const items = result.items;
    const problemsPayload = items.map((it: any, idx: number) => ({
      session_id: sessionId,
      index_in_image: it.index ?? idx,
      stem: it.문제내용?.text || '',
      choices: (it.문제_보기 || []).map((c: any) => ({ text: c.text, confidence: c.confidence_score })),
    }));

    const { data: problems, error: problemsError } = await supabase
      .from('problems')
      .insert(problemsPayload)
      .select('id, index_in_image');

    if (problemsError) {
      console.error('[Background] Step 4 error: Problems insert error:', problemsError);
      throw problemsError;
    }

    console.log(`[Background] Step 4 completed: Inserted ${problems?.length || 0} problems`);

    // 5. AI 분석 결과를 labels에 저장 (user_mark는 null로 - 사용자 검수 대기)
    console.log('[Background] Step 5: Save AI analysis results to labels (pending user review)...');
    const idByIndex = new Map<number, string>();
    for (const row of problems || []) {
      idByIndex.set(row.index_in_image, row.id);
    }

    // 각 문제에 대해 taxonomy 조회하여 code, CEFR, 난이도 추가
    const labelsPayload = await Promise.all(items.map(async (it: any, idx: number) => {
      const normalizedMark = normalizeMark(it.사용자가_직접_채점한_정오답);
      const classification = it.문제_유형_분류 || {};
      
      // Gemini가 반환한 원본 값
      const rawDepth1 = (classification['1Depth'] || '').trim();
      const rawDepth2 = (classification['2Depth'] || '').trim();
      const rawDepth3 = (classification['3Depth'] || '').trim();
      const rawDepth4 = (classification['4Depth'] || '').trim();
      
      // 유효성 검증: DB에 있는 값인지 확인
      const validDepth1 = taxonomyData.allValues.depth1.includes(rawDepth1) ? rawDepth1 : '';
      const validDepth2 = taxonomyData.allValues.depth2.includes(rawDepth2) ? rawDepth2 : '';
      const validDepth3 = taxonomyData.allValues.depth3.includes(rawDepth3) ? rawDepth3 : '';
      const validDepth4 = taxonomyData.allValues.depth4.includes(rawDepth4) ? rawDepth4 : '';
      
      // 유효하지 않은 값이 있으면 경고
      if (!validDepth1 && rawDepth1) {
        console.warn(`[Background] Invalid depth1: "${rawDepth1}" - not in taxonomy. Valid values: ${taxonomyData.allValues.depth1.slice(0, 3).join(', ')}...`);
      }
      if (!validDepth2 && rawDepth2) {
        console.warn(`[Background] Invalid depth2: "${rawDepth2}" - not in taxonomy`);
      }
      if (!validDepth3 && rawDepth3) {
        console.warn(`[Background] Invalid depth3: "${rawDepth3}" - not in taxonomy`);
      }
      if (!validDepth4 && rawDepth4) {
        console.warn(`[Background] Invalid depth4: "${rawDepth4}" - not in taxonomy`);
      }
      
      // 유효한 값으로만 taxonomy 조회
      const taxonomy = await findTaxonomyByDepth(
        supabase,
        validDepth1,
        validDepth2,
        validDepth3,
        validDepth4,
        userLanguage
      );
      
      // classification에 code, CEFR, 난이도 추가 (유효한 값만 저장)
      const enrichedClassification = {
        '1Depth': validDepth1 || null,
        '2Depth': validDepth2 || null,
        '3Depth': validDepth3 || null,
        '4Depth': validDepth4 || null,
        code: taxonomy.code,
        CEFR: taxonomy.cefr,
        난이도: taxonomy.difficulty,
        분류_신뢰도: classification['분류_신뢰도'] || '보통',
      };
      
      // 유효하지 않은 값이 있거나 매핑 실패 시 신뢰도 하락
      if (!validDepth1 || !taxonomy.code) {
        enrichedClassification['분류_신뢰도'] = '낮음';
        if (!validDepth1) {
          console.warn(`[Background] Invalid classification: depth1="${rawDepth1}" is not in taxonomy. Saving with null.`);
        }
      }
      
      return {
        problem_id: idByIndex.get(it.index ?? idx)!,
        user_answer: it.사용자가_기술한_정답?.text || '',
        user_mark: null, // 사용자 검수 전이므로 null
        is_correct: normalizedMark === 'O', // AI 분석 결과 저장
        classification: enrichedClassification,
        confidence: {
          stem: it.문제내용?.confidence_score || 1.0,
          answer: it.사용자가_기술한_정답?.confidence_score || 1.0,
          choices: (it.문제_보기 || []).map((c: any) => c.confidence_score || 1.0),
        },
      };
    }));

    const { error: labelsError } = await supabase.from('labels').insert(labelsPayload);
    if (labelsError) {
      console.error('[Background] Step 5 error: Labels insert error:', labelsError);
      throw labelsError;
    }

    console.log('[Background] Step 5 completed: AI analysis results saved (pending user review)');

    // 6. 세션 상태를 completed로 업데이트
    console.log('[Background] Step 6: Update session status to completed...');
    const { error: statusUpdateError } = await supabase
      .from('sessions')
      .update({ status: 'completed' })
      .eq('id', sessionId);

    if (statusUpdateError) {
      console.error('[Background] Step 6 error: Status update error:', statusUpdateError);
      // 상태 업데이트 실패해도 분석은 완료되었으므로 계속 진행
    } else {
      console.log('[Background] Step 6 completed: Session status updated to completed');
    }

    console.log('[Background] Background analysis completed for session:', sessionId);
  } catch (error) {
    console.error('[Background] Error in background task:', error);
    console.error('[Background] Error stack:', error instanceof Error ? error.stack : 'No stack trace');
    
    // 백그라운드 분석 실패 시 세션 상태를 failed로 업데이트
    try {
      await supabase
        .from('sessions')
        .update({ status: 'failed' })
        .eq('id', sessionId);
      console.log('[Background] Session status updated to failed due to background error');
    } catch (statusError) {
      console.error('[Background] Failed to update session status to failed:', statusError);
    }
  }
}

Deno.serve(async (req) => {
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

    const { imageBase64, mimeType, userId, fileName, language } = await req.json();
    console.log('Request data:', {
      hasImageBase64: !!imageBase64,
      mimeType,
      userId,
      fileName,
      language,
    });

    if (!imageBase64 || !userId) {
      console.log('Missing required fields');
      return errorResponse('Missing required fields: imageBase64, userId', 400);
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

    // 1. 이미지를 Storage에 업로드
    console.log('Step 1: Upload image to storage...');
    const timestamp = Date.now();
    const safeName = (fileName || 'image.jpg').replace(/[^a-zA-Z0-9_.-]/g, '_');
    const { data: userData } = await supabase.auth.admin.getUserById(userId);
    const email = userData.user?.email || userId;
    const emailLocal = email.split('@')[0].replace(/[^a-zA-Z0-9_-]/g, '_');
    const path = `${emailLocal}/${timestamp}_${safeName}`;
    
    const buffer = new Uint8Array(atob(imageBase64).split('').map(c => c.charCodeAt(0)));
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('problem-images')
      .upload(path, buffer, {
        contentType: mimeType,
        cacheControl: '3600',
        upsert: false
      });

    if (uploadError) throw uploadError;
    
    const { data: urlData } = supabase.storage.from('problem-images').getPublicUrl(uploadData.path);
    const imageUrl = urlData.publicUrl;
    console.log('Step 1 completed: Image uploaded to', imageUrl);

    // 2. 세션 생성
    console.log('Step 2: Create session...');
    const { data: sessionData, error: sessionError } = await supabase
      .from('sessions')
      .insert({
        user_id: userId,
        image_url: imageUrl,
        status: 'processing'
      })
      .select('id')
      .single();

    if (sessionError) throw sessionError;
    createdSessionId = sessionData.id;
    console.log('Step 2 completed: Session created with ID', createdSessionId);

    // 세션 생성 후 즉시 sessionId 반환 (분석은 백그라운드에서 계속)
    const response = jsonResponse({
      success: true,
      sessionId: createdSessionId,
      message: 'Session created, analysis in progress',
    });

    // 백그라운드 작업 시작
    EdgeRuntime.waitUntil(
      analyzeImageInBackground(
        createdSessionId,
        imageBase64,
        mimeType,
        userLanguage,
        geminiApiKey
      )
    );

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
});}