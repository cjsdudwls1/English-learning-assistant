// @ts-nocheck
import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { GoogleGenAI } from "https://esm.sh/@google/genai@1.21.0"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// 에러 파싱 함수 (인라인으로 포함)
function parseApiError(error: unknown): { message: string; code: number; status: string } {
  // Error 객체인 경우
  if (error instanceof Error) {
    const message = error.message;
    
    // JSON 문자열인 경우 파싱 시도
    if (message.includes('{') && message.includes('}')) {
      try {
        const parsed = JSON.parse(message);
        if (parsed.error) {
          const errorObj = parsed.error;
          return {
            message: errorObj.message || message,
            code: errorObj.code || errorObj.status || 500,
            status: String(errorObj.status || 'UNAVAILABLE')
          };
        }
      } catch {
        // JSON 파싱 실패 시 원본 메시지 사용
      }
    }
    
    // 타임아웃 에러 확인
    if (message.includes('timeout') || message.includes('Timeout') || message.includes('TIMEOUT')) {
      return {
        message: 'Request timeout: The AI service took too long to respond. Please try generating fewer problems at once.',
        code: 504,
        status: 'TIMEOUT'
      };
    }
    
    return {
      message,
      code: 500,
      status: 'ERROR'
    };
  }
  
  // 객체 형태의 에러 처리
  const err = error as any;
  
  // 중첩된 error 객체 처리
  let errorMessage = 'Unknown error';
  let errorCode = 500;
  let errorStatus = 'UNAVAILABLE';
  
  // 다양한 에러 구조 지원
  if (err?.error) {
    const errorObj = err.error;
    errorMessage = errorObj.message || errorObj.error?.message || errorMessage;
    errorCode = errorObj.code || errorObj.status || errorCode;
    errorStatus = errorObj.status || errorStatus;
  } else {
    errorMessage = err?.message || err?.error?.message || err?.error?.error?.message || err?.details?.[0]?.message || errorMessage;
    errorCode = err?.code || err?.status || err?.error?.code || err?.error?.status || errorCode;
    errorStatus = err?.status || err?.error?.status || errorStatus;
  }
  
  // 숫자가 아닌 경우 파싱 시도
  if (typeof errorCode !== 'number') {
    const parsedCode = parseInt(String(errorCode));
    if (!isNaN(parsedCode)) {
      errorCode = parsedCode;
    }
  }
  
  return {
    message: errorMessage,
    code: errorCode,
    status: String(errorStatus)
  };
}

// Gemini 응답에서 텍스트(JSON 포함) 안전 추출
async function extractModelText(resp: any): Promise<string> {
  if (!resp) return '';
  try {
    if (typeof resp.text === 'function') {
      return String(await resp.text());
    }
    if (typeof resp.text === 'string') {
      return resp.text;
    }
    if (resp?.response?.text) {
      const t = resp.response.text;
      return typeof t === 'function' ? String(await t()) : String(t);
    }
    const candidateText = resp?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (candidateText) return String(candidateText);
  } catch {
    // ignore and fallback
  }
  return String(resp ?? '');
}

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

type ImageInput = { imageBase64: string; mimeType: string; fileName: string };

function buildPrompt(
  classificationData: { structure: string; allValues: { depth1: string[]; depth2: string[]; depth3: string[]; depth4: string[] } },
  language: 'ko' | 'en' = 'ko',
  imageCount = 1
) {
  const { structure, allValues } = classificationData;
  
  // 언어에 따라 프롬프트 언어 변경 (현재는 한국어 프롬프트만 있으므로 영어일 때는 영어로 번역 필요)
  const isEnglish = language === 'en';
  
  return `
### 1. 페르소나 (Persona) ###
당신은 두 가지 전문성을 겸비한 최고 수준의 AI 전문가입니다:
1.  **손글씨 OCR 전문가**: 불규칙한 필기, 겹쳐 쓴 글씨, 다양한 필기구의 흔적까지 분석하여 디지털 텍스트로 변환하는 데 특화되어 있습니다. 펜의 압력, 기울기, 획의 연결성과 같은 미세한 특징을 파악하여 문맥 기반으로 모호한 글자를 추론하는 능력이 뛰어납니다.
2.  **영어 교육 평가 전문가**: 다양한 유형의 영어 문제를 이해하고, 교육과정 분류 체계에 따라 문제의 핵심 의도를 파악하여 정확하게 분류할 수 있습니다.

### 2. 과업 (Task) ###
사용자가 업로드한 영어 문제 이미지 ${imageCount > 1 ? `${imageCount}장` : '한 장'}을 종합적으로 분석하여, 이미지 내의 모든 텍스트와 손글씨를 인식하고, 문제 유형을 분류한 뒤, 분석된 모든 정보를 지정된 JSON 형식에 맞춰 단 하나의 결과물로 출력해야 합니다.

### 3. 맥락 (Context) ###
- **입력 데이터 1 (이미지/이미지들)**: 사용자가 촬영하거나 업로드한 영어 문제 이미지 파일(1장 또는 여러 장). 이 이미지에는 인쇄된 문제 텍스트, 객관식 보기, 그리고 사용자가 손으로 작성한 답안 및 채점 표시(O, X, △, ✓, 취소선 등)가 포함되어 있습니다.
- **입력 데이터 2 (분류 기준표)**: 문제 유형을 분류하기 위한 기준이 되는 데이터입니다.

${imageCount > 1 ? `- **중요(멀티 이미지 연속성)**: 업로드된 ${imageCount}장은 **하나의 시험지/학습지의 연속된 페이지**입니다. 한 문항이 두 장에 걸쳐 있을 수 있으니, **페이지 경계를 넘어 문항을 이어 붙여 하나의 문항으로 완성**하세요. (중복 문항 생성 금지)` : ''}

**분류 기준표 계층 구조:**
\`\`\`
${structure}
\`\`\`

**⚠️ 절대 규칙:**
- 위 계층 구조에 나와있는 정확한 depth1, depth2, depth3, depth4 값만 사용하세요.
- 공백이나 특수문자(·)를 변경하지 마세요. (예: ❌ "문장유형" → ✅ "문장 유형·시제·상")
- 임의의 값이나 약어를 사용하지 마세요. (예: ❌ "어휘" → ✅ "어휘·연결")
- 계층 구조를 정확히 따라야 합니다 (depth1 → depth2 → depth3 → depth4).
- **미분류 금지**: "1Depth~4Depth"는 절대 비우지 마세요(빈 문자열/NULL/누락 금지).
- **반드시 taxonomy의 정확한 1개 leaf 조합(1Depth~4Depth)을 선택**하세요.

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
- 왜 그렇게 분류했는지에 대한 구체적인 근거를 한 문장으로 요약합니다.

**[4단계: 후처리]**
- 인식된 모든 텍스트(특히 손글씨)에 대해 영어 사전을 기반으로 맞춤법 교정을 시도합니다. 만약 단어를 교정했다면, 해당 사실을 기록해 둡니다.

### 5. 출력 명세 (Output Specification) ###
이미지 ${imageCount > 1 ? `${imageCount}장(연속 페이지)` : '한 장'}에 여러 문항이 있을 수 있으므로, 반드시 아래 구조의 JSON 객체 하나만 출력하세요.

\`\`\`json
{
  "items": [
    {
      "index": 0,
      "사용자가_직접_채점한_정오답": "O | X",
      "문제내용": { "text": "..." },
      "문제_보기": [ { "text": "① ..." } ],
      "사용자가_기술한_정답": {
        "text": "...",
        "auto_corrected": false,
        "alternate_interpretations": ["..."]
      },
      "문제_유형_분류": {
        "1Depth": "...",
        "2Depth": "...",
        "3Depth": "...",
        "4Depth": "..."
      },
      "분류_근거": "..."
    }
  ]
}
\`\`\`

### 6. 제약 및 예외 처리 (Constraints & Error Handling) ###
- **이미지 품질 저하**: 이미지가 너무 흐릿하거나 빛 반사가 심해 내용을 판독할 수 없는 경우, JSON의 모든 값을 "인식불가"로 채우세요.
- **비영어 문제**: 분석 결과, 내용이 영어가 아니라고 판단되면 JSON의 모든 값을 "영어 문제 아님"으로 채우세요.
- **분류 모호성**: 문제 유형 분류가 애매하여 두 개 이상의 카테고리에 걸쳐 있다고 판단될 경우, 가장 가능성이 높은 하나를 선택하세요.
- **문항 연속(멀티 이미지)**: 한 문항이 여러 이미지에 걸쳐 있으면, **문제내용/보기/답안 정보를 합쳐서 하나의 item으로** 구성하세요. 같은 문항을 중복으로 items에 넣지 마세요.
- **불필요한 정보**: 프롬프트에 명시되지 않은 어떠한 정보도 추가로 생성하거나 출력하지 마세요.
`;
}

function normalizeMark(raw: unknown): 'O' | 'X' {
  if (raw === undefined || raw === null) return 'X';
  const value = String(raw).trim().toLowerCase();
  const truthy = new Set(['o', '✓', 'v', 'correct', 'true', '정답', '맞음', 'ok', '⭕', 'circle', 'check', 'checkmark']);
  if (truthy.has(value)) return 'O';
  return 'X';
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

type DepthTuple = { depth1: string; depth2: string; depth3: string; depth4: string };

function extractDepthsFromClassification(classification: any): DepthTuple {
  return {
    depth1: isNonEmptyString(classification?.['1Depth']) ? String(classification['1Depth']).trim() : '',
    depth2: isNonEmptyString(classification?.['2Depth']) ? String(classification['2Depth']).trim() : '',
    depth3: isNonEmptyString(classification?.['3Depth']) ? String(classification['3Depth']).trim() : '',
    depth4: isNonEmptyString(classification?.['4Depth']) ? String(classification['4Depth']).trim() : '',
  };
}

function buildReclassificationPrompt(params: {
  taxonomyStructure: string;
  language: 'ko' | 'en';
  problemStem: string;
  problemChoices: string[];
  userAnswer: string;
  previousDepths?: Partial<DepthTuple>;
  failureReason?: string;
}): string {
  const {
    taxonomyStructure,
    language,
    problemStem,
    problemChoices,
    userAnswer,
    previousDepths,
    failureReason,
  } = params;

  const choicesText = (problemChoices || []).filter(Boolean).join('\n');
  const prev = previousDepths ? `이전 분류(무효/누락): ${JSON.stringify(previousDepths)}` : '';
  const reason = failureReason ? `무효 사유: ${failureReason}` : '';

  if (language === 'en') {
    return `
You MUST pick exactly ONE valid taxonomy leaf (1Depth~4Depth) from the taxonomy tree below.
Never return blank/null/missing fields. Do not invent values. Keep spaces/symbols exactly as in the tree.
If ambiguous, still choose the best one.

TAXONOMY TREE:
\`\`\`
${taxonomyStructure}
\`\`\`

PROBLEM:
${problemStem}

CHOICES (if any):
${choicesText}

USER ANSWER (may be empty):
${userAnswer}

${prev}
${reason}

Return ONLY this JSON object (no markdown, no extra keys):
{
  "1Depth": "...",
  "2Depth": "...",
  "3Depth": "...",
  "4Depth": "..."
}
    `.trim();
  }

  return `
반드시 아래 taxonomy 트리에서 **정확히 1개 leaf 조합(1Depth~4Depth)**을 선택해야 합니다.
- 1Depth~4Depth는 절대 비우지 마세요(빈 문자열/NULL/누락 금지).
- 트리에 없는 값을 만들지 마세요.
- 공백/특수문자(·)를 변경하지 마세요.
- 애매하면 그래도 1개를 선택하세요.

TAXONOMY TREE:
\`\`\`
${taxonomyStructure}
\`\`\`

문제:
${problemStem}

보기(있으면):
${choicesText}

사용자 답안(없을 수 있음):
${userAnswer}

${prev}
${reason}

오직 아래 JSON 객체만 출력하세요(마크다운/설명/추가 키 금지):
{
  "1Depth": "...",
  "2Depth": "...",
  "3Depth": "...",
  "4Depth": "..."
}
  `.trim();
}

async function reclassifyUntilValid(params: {
  supabase: any;
  ai: any;
  taxonomyData: { structure: string };
  language: 'ko' | 'en';
  problemStem: string;
  problemChoices: string[];
  userAnswer: string;
  initialClassification: any;
  maxAttempts: number;
}): Promise<{ depths: DepthTuple; taxonomy: { code: string; cefr: string | null; difficulty: number | null } }> {
  const { supabase, ai, taxonomyData, language, problemStem, problemChoices, userAnswer, initialClassification, maxAttempts } = params;

  let lastDepths = extractDepthsFromClassification(initialClassification);
  let lastFailureReason = '';

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const taxonomy = await findTaxonomyByDepth(
      supabase,
      lastDepths.depth1,
      lastDepths.depth2,
      lastDepths.depth3,
      lastDepths.depth4,
      language
    );

    if (taxonomy?.code) {
      return {
        depths: lastDepths,
        taxonomy: { code: taxonomy.code, cefr: taxonomy.cefr, difficulty: taxonomy.difficulty },
      };
    }

    lastFailureReason = (!lastDepths.depth1 || !lastDepths.depth2 || !lastDepths.depth3 || !lastDepths.depth4)
      ? 'One or more depth fields are missing/blank'
      : 'Depth combination not found in taxonomy table';

    console.warn(`[Background] Classification invalid. Requesting Gemini reclassification...`, {
      attempt: attempt + 1,
      maxAttempts,
      reason: lastFailureReason,
      previous: lastDepths,
    });

    const prompt = buildReclassificationPrompt({
      taxonomyStructure: taxonomyData.structure,
      language,
      problemStem,
      problemChoices,
      userAnswer,
      previousDepths: lastDepths,
      failureReason: lastFailureReason,
    });

    const resp = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: { parts: [{ text: prompt }] },
      generationConfig: {
        responseMimeType: "application/json",
        temperature: 0.0,
      },
    });

    const raw = await extractModelText(resp);
    const cleaned = String(raw).replace(/```json/g, '').replace(/```/g, '').trim();
    let parsed: any;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        lastDepths = { depth1: '', depth2: '', depth3: '', depth4: '' };
        continue;
      }
      parsed = JSON.parse(jsonMatch[0]);
    }

    lastDepths = extractDepthsFromClassification(parsed);
  }

  // ✅ 끝까지 실패하면 "미분류"로 저장하지 않고 실패 처리(세션 failed로 전환됨)
  throw new Error(`Classification failed after ${maxAttempts} attempts: ${lastFailureReason}`);
}

// 백그라운드 작업 함수: Gemini API 호출 및 DB 저장
async function analyzeImageInBackground(
  sessionId: string,
  images: ImageInput[],
  userLanguage: 'ko' | 'en',
  geminiApiKey: string
): Promise<void> {
  const supabase = createServiceSupabaseClient();
  
  try {
    // 3. Taxonomy 데이터 로드
    console.log('[Background] Step 3a: Loading taxonomy data from database...', { language: userLanguage });
    const taxonomyData = await loadTaxonomyData(supabase, userLanguage);
    const imageCount = Array.isArray(images) ? images.length : 0;
    if (!Array.isArray(images) || images.length === 0) {
      throw new Error('No images provided to background analysis');
    }
    const prompt = buildPrompt(taxonomyData, userLanguage, imageCount);
    
    // 3. Gemini API로 분석 (재시도 로직 적용)
    console.log('[Background] Step 3b: Analyzing image(s) with Gemini...', { imageCount });
    const ai = new GoogleGenAI({ apiKey: geminiApiKey });

    const parts: any[] = [{ text: prompt }];
    for (let i = 0; i < images.length; i++) {
      const img = images[i];
      if (!img?.imageBase64) {
        throw new Error(`Image ${i} has no base64 data`);
      }
      parts.push({ inlineData: { data: img.imageBase64, mimeType: img.mimeType } });
    }

    let responseText: string = '';
    
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
          contents: { parts },
          generationConfig: {
            responseMimeType: "application/json",
            temperature: 0.0,
          },
        });
        
        console.log(`[Background] Attempt ${attempt + 1}/${MAX_RETRIES}: Starting Gemini API call with ${timeoutMs/1000}s timeout...`);
        const startTime = Date.now();
        
        const response = await Promise.race([apiPromise, timeoutPromise]);
        const elapsedTime = Date.now() - startTime;
        
        console.log(`[Background] Gemini API call completed in ${elapsedTime}ms`);
        responseText = await extractModelText(response);
        if (typeof responseText !== 'string') responseText = String(responseText ?? '');
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
    if (!responseText || typeof responseText !== 'string') {
      throw new Error('Empty response text from Gemini');
    }
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

    // ✅ 문제를 하나도 추출하지 못한 경우: UI에서 "사라지는 completed(0문제)" 상태를 만들지 않도록 실패 처리
    if (!result.items || result.items.length === 0) {
      console.error('[Background] No problems extracted. Marking session as failed.');
      try {
        await supabase
          .from('sessions')
          .update({ status: 'failed' })
          .eq('id', sessionId);
      } catch (e) {
        console.error('[Background] Failed to update session status to failed (no problems):', e);
      }
      return;
    }

    // 4. 문제 저장
    console.log('[Background] Step 4: Save problems to database...');
    const items = result.items;
    const problemsPayload = items.map((it: any, idx: number) => ({
      session_id: sessionId,
      index_in_image: it.index ?? idx,
      stem: it.문제내용?.text || '',
      choices: (it.문제_보기 || []).map((c: any) => ({ text: c.text })),
      // Step 6(메타데이터 생성)가 실패/지연되어도 UI가 깨지지 않도록 기본값을 먼저 저장
      // Step 6에서 성공 시 실제 분석값으로 overwrite됨
      problem_metadata: {
        difficulty: '중',
        word_difficulty: 5,
        problem_type: '분석 대기',
        analysis: '분석 정보 없음',
      },
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

    if (!problems || problems.length === 0) {
      console.error('[Background] Step 4 produced 0 problems. Marking session as failed.');
      try {
        await supabase
          .from('sessions')
          .update({ status: 'failed' })
          .eq('id', sessionId);
      } catch (e) {
        console.error('[Background] Failed to update session status to failed (0 inserted):', e);
      }
      return;
    }

    // 5. AI 분석 결과를 labels에 저장 (user_mark는 null로 - 사용자 검수 대기)
    console.log('[Background] Step 5: Save AI analysis results to labels (pending user review)...');
    const idByIndex = new Map<number, string>();
    for (const row of problems || []) {
      idByIndex.set(row.index_in_image, row.id);
    }

    // ✅ 미분류(=depth/code 비어있음) 절대 방지:
    // - taxonomy table에서 code로 매핑되는 "정확한 1개 leaf 조합"만 저장
    // - 누락/무효 시 Gemini에게 재요청(보정/재분류)해서 끝까지 채움
    const labelsPayload: any[] = [];
    const aiForReclassify = new GoogleGenAI({ apiKey: geminiApiKey });

    for (let idx = 0; idx < items.length; idx++) {
      const it: any = items[idx];
      const normalizedMark = normalizeMark(it.사용자가_직접_채점한_정오답);
      const classification = it.문제_유형_분류 || {};

      const problemStem = it.문제내용?.text || '';
      const problemChoices = (it.문제_보기 || []).map((c: any) => String(c?.text || '')).filter(Boolean);
      const userAnswer = it.사용자가_기술한_정답?.text || '';

      const { depths, taxonomy } = await reclassifyUntilValid({
        supabase,
        ai: aiForReclassify,
        taxonomyData,
        language: userLanguage,
        problemStem,
        problemChoices,
        userAnswer,
        initialClassification: classification,
        maxAttempts: 4,
      });

      const enrichedClassification = {
        '1Depth': depths.depth1,
        '2Depth': depths.depth2,
        '3Depth': depths.depth3,
        '4Depth': depths.depth4,
        code: taxonomy.code,
        CEFR: taxonomy.cefr,
        난이도: taxonomy.difficulty,
      };

      labelsPayload.push({
        problem_id: idByIndex.get(it.index ?? idx)!,
        user_answer: userAnswer,
        user_mark: null, // 사용자 검수 전이므로 null
        is_correct: normalizedMark === 'O', // AI 분석 결과 저장
        classification: enrichedClassification,
      });
    }

    const { error: labelsError } = await supabase.from('labels').insert(labelsPayload);
    if (labelsError) {
      console.error('[Background] Step 5 error: Labels insert error:', labelsError);
      throw labelsError;
    }

    console.log('[Background] Step 5 completed: AI analysis results saved (pending user review)');

    // 6. 문제 메타데이터 생성 및 저장
    console.log('[Background] Step 6: Generate problem metadata...');
    
    if (!problems || problems.length === 0) {
      console.log('[Background] Step 6 skipped: No problems to process');
    } else {
      const ai = new GoogleGenAI({ apiKey: geminiApiKey });
      
      // 문제와 원본 아이템을 매핑
      const problemItemMap = new Map<number, any>();
      for (const item of items) {
        const itemIndex = item.index ?? items.indexOf(item);
        problemItemMap.set(itemIndex, item);
      }
      
      console.log(`[Background] Step 6: Processing ${problems.length} problems for metadata generation...`);
      
      // 각 문제에 대해 메타데이터 생성 (순차적으로 처리하여 rate limit 방지)
      let successCount = 0;
      let errorCount = 0;
      
      for (let i = 0; i < problems.length; i++) {
        const p = problems[i];
        const originalItem = problemItemMap.get(p.index_in_image);
        
        if (!originalItem) {
          console.warn(`[Background] Step 6: Original item not found for problem ${p.id} (index: ${p.index_in_image})`);
          errorCount++;
          continue;
        }

        const problemStem = originalItem.문제내용?.text || '';
        const problemChoices = (originalItem.문제_보기 || []).map((c: any) => c.text).join('\n');
        const userAnswer = originalItem.사용자가_기술한_정답?.text || '';
        const isCorrect = normalizeMark(originalItem.사용자가_직접_채점한_정오답) === 'O';

        // 문제 내용이 없으면 스킵
        if (!problemStem || problemStem.trim() === '') {
          console.warn(`[Background] Step 6: Problem ${p.id} has no stem, skipping metadata generation`);
          errorCount++;
          continue;
        }

        // 메타데이터 생성 프롬프트
        const metadataPrompt = userLanguage === 'ko' 
          ? `다음 영어 문제를 분석하여 메타데이터를 생성해주세요.

문제 내용:
${problemStem}

선택지:
${problemChoices}

사용자 답안: ${userAnswer}
정답 여부: ${isCorrect ? '정답' : '오답'}

다음 형식의 JSON으로 응답해주세요:
{
  "difficulty": "상" | "중" | "하",
  "word_difficulty": 1-9 사이의 숫자,
  "problem_type": "문제 유형에 대한 설명 (예: 문법, 어휘, 독해 등)",
  "analysis": "문제에 대한 상세 분석 정보"
}

난이도 기준:
- 상: 고등학교 수준 이상의 어려운 문제
- 중: 중학교 수준의 문제
- 하: 초등학교 수준의 쉬운 문제

단어 난이도 기준:
- 1-3: 초등학교 수준의 쉬운 단어
- 4-6: 중학교 수준의 보통 단어
- 7-9: 고등학교 수준 이상의 어려운 단어

JSON 형식으로만 응답해주세요.`
          : `Analyze the following English problem and generate metadata.

Problem:
${problemStem}

Choices:
${problemChoices}

User Answer: ${userAnswer}
Is Correct: ${isCorrect ? 'Correct' : 'Incorrect'}

Please respond in the following JSON format:
{
  "difficulty": "high" | "medium" | "low",
  "word_difficulty": number between 1-9,
  "problem_type": "Description of problem type (e.g., grammar, vocabulary, reading comprehension)",
  "analysis": "Detailed analysis of the problem"
}

Difficulty criteria:
- high: High school level or above
- medium: Middle school level
- low: Elementary school level

Word difficulty criteria:
- 1-3: Elementary school level words
- 4-6: Middle school level words
- 7-9: High school level or above words

Respond only in JSON format.`;

        try {
          console.log(`[Background] Step 6: Generating metadata for problem ${p.id} (${i + 1}/${problems.length})...`);
          
          const metadataResponse = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: { parts: [{ text: metadataPrompt }] },
            generationConfig: {
              responseMimeType: "application/json",
              temperature: 0.0, // 일관성 보장
            },
          });

          let metadata: any;
          try {
            const metadataTextRaw = await extractModelText(metadataResponse);
            const metadataText = metadataTextRaw.replace(/```json/g, '').replace(/```/g, '').trim();
            // 1) JSON 전체 파싱 우선
            try {
              metadata = JSON.parse(metadataText);
            } catch {
              // 2) 그래도 실패하면 {...}만 추출해 파싱 (fallback)
              const jsonMatch = metadataText.match(/\{[\s\S]*\}/);
              if (!jsonMatch) throw new Error('No JSON object found in metadata response');
              metadata = JSON.parse(jsonMatch[0]);
            }
          } catch (parseError) {
            console.error(`[Background] Step 6: JSON parse error for problem ${p.id}:`, parseError);
            try {
              const preview = (await extractModelText(metadataResponse)).slice(0, 500);
              console.error(`[Background] Step 6: Response preview: ${preview}`);
            } catch {
              // ignore
            }
            errorCount++;
            continue;
          }
          
          // 난이도 변환 (영어 -> 한국어)
          if (userLanguage === 'en') {
            if (metadata.difficulty === 'high') metadata.difficulty = '상';
            else if (metadata.difficulty === 'medium') metadata.difficulty = '중';
            else if (metadata.difficulty === 'low') metadata.difficulty = '하';
          }

          // 난이도 유효성 검증
          const validDifficulties = ['상', '중', '하'];
          if (!validDifficulties.includes(metadata.difficulty)) {
            console.warn(`[Background] Step 6: Invalid difficulty "${metadata.difficulty}" for problem ${p.id}, defaulting to "중"`);
            metadata.difficulty = '중';
          }

          // 단어 난이도 유효성 검증 (1-9 범위)
          const wordDifficulty = Number(metadata.word_difficulty);
          if (isNaN(wordDifficulty) || wordDifficulty < 1 || wordDifficulty > 9) {
            console.warn(`[Background] Step 6: Invalid word_difficulty "${metadata.word_difficulty}" for problem ${p.id}, defaulting to 5`);
            metadata.word_difficulty = 5;
          } else {
            metadata.word_difficulty = Math.round(wordDifficulty);
          }

          // 메타데이터 저장
          const { error: updateError } = await supabase
            .from('problems')
            .update({ 
              problem_metadata: {
                difficulty: metadata.difficulty || '중',
                word_difficulty: metadata.word_difficulty || 5,
                problem_type: metadata.problem_type || '',
                analysis: metadata.analysis || '',
              }
            })
            .eq('id', p.id);

          if (updateError) {
            console.error(`[Background] Step 6: Error updating metadata for problem ${p.id}:`, updateError);
            errorCount++;
            continue;
          }

          console.log(`[Background] Step 6: Metadata saved for problem ${p.id} (difficulty: ${metadata.difficulty}, word_difficulty: ${metadata.word_difficulty})`);
          successCount++;
        } catch (error) {
          console.error(`[Background] Step 6: Error generating/saving metadata for problem ${p.id}:`, error);
          if (error instanceof Error) {
            console.error(`[Background] Step 6: Error message: ${error.message}`);
            console.error(`[Background] Step 6: Error stack: ${error.stack}`);
          }
          errorCount++;
          // 개별 문제 실패해도 계속 진행
        }
      }

      console.log(`[Background] Step 6 completed: Generated metadata for ${successCount}/${problems.length} problems (${errorCount} errors)`);
    }

    // 7. 세션 상태를 completed로 업데이트
    console.log('[Background] Step 7: Update session status to completed...');
    const { error: statusUpdateError } = await supabase
      .from('sessions')
      .update({ status: 'completed' })
      .eq('id', sessionId)
      // 사용자 라벨링이 이미 끝나 labeled로 바뀐 경우 되돌리지 않도록 가드
      .eq('status', 'processing');

    if (statusUpdateError) {
      console.error('[Background] Step 7 error: Status update error:', statusUpdateError);
      // 상태 업데이트 실패해도 분석은 완료되었으므로 계속 진행
    } else {
      console.log('[Background] Step 7 completed: Session status updated to completed');
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

    // 요청 본문 파싱(에러 처리 포함)
    let requestData: any;
    try {
      requestData = await req.json();
    } catch (parseError: any) {
      console.error('Failed to parse request body:', parseError);
      return errorResponse(`Failed to parse request body: ${parseError?.message || 'Unknown error'}`, 400);
    }

    const { imageBase64, mimeType, userId, fileName, language, images } = requestData || {};

    // 다중 이미지 배열 또는 단일 이미지 지원 (하위 호환성)
    let imageList: ImageInput[] = [];

    if (Array.isArray(images) && images.length > 0) {
      imageList = images.map((img: any, index: number) => {
        let base64Data = String(img?.imageBase64 || '');
        if (base64Data.includes(',')) {
          base64Data = base64Data.split(',')[1];
        }
        return {
          imageBase64: base64Data,
          mimeType: String(img?.mimeType || 'image/jpeg'),
          fileName: String(img?.fileName || `image_${index}.jpg`),
        };
      });
    } else if (imageBase64) {
      let base64Data = String(imageBase64 || '');
      if (base64Data.includes(',')) {
        base64Data = base64Data.split(',')[1];
      }
      imageList = [{
        imageBase64: base64Data,
        mimeType: String(mimeType || 'image/jpeg'),
        fileName: String(fileName || 'image.jpg'),
      }];
    }

    console.log('Request data:', {
      userId,
      language,
      imageCount: imageList.length,
      fileNames: imageList.map((it) => it.fileName).slice(0, 5),
    });

    if (!userId || imageList.length === 0) {
      console.log('Missing required fields');
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

    const imageUrls: string[] = [];
    for (let i = 0; i < imageList.length; i++) {
      const img = imageList[i];
      const safeName = (img.fileName || `image_${i}.jpg`).replace(/[^a-zA-Z0-9_.-]/g, '_');
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

    const imageUrl = imageUrls[0];
    console.log(`Step 1 completed: ${imageList.length} image(s) uploaded, main imageUrl:`, imageUrl);

    // 2. 세션 생성
    console.log('Step 2: Create session...');
    // image_urls 컬럼이 없는 환경도 있을 수 있어, 실패 시 단일 컬럼(image_url)로 폴백
    const insertPayloadWithUrls: any = {
      user_id: userId,
      image_url: imageUrl,
      image_urls: imageUrls,
      status: 'processing'
    };

    let sessionData: any | null = null;
    let sessionError: any | null = null;

    {
      const res = await supabase
        .from('sessions')
        .insert(insertPayloadWithUrls)
        .select('id')
        .single();
      sessionData = res.data;
      sessionError = res.error;
    }

    if (sessionError) {
      const msg = String(sessionError?.message || sessionError);
      const looksLikeMissingColumn = msg.toLowerCase().includes('image_urls') && msg.toLowerCase().includes('column');
      if (looksLikeMissingColumn) {
        console.warn('Step 2: image_urls column missing. Falling back to image_url only.', { message: msg });
        const res2 = await supabase
          .from('sessions')
          .insert({
            user_id: userId,
            image_url: imageUrl,
            status: 'processing'
          })
          .select('id')
          .single();
        if (res2.error) throw res2.error;
        sessionData = res2.data;
        sessionError = null;
      } else {
        throw sessionError;
      }
    }

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
        imageList,
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
});