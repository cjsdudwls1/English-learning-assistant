import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { GoogleGenAI } from "https://esm.sh/@google/genai@1.21.0"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Max-Age': '86400',
};

// Taxonomy 데이터를 DB에서 동적으로 로드하는 함수
async function loadTaxonomyData(supabase: any): Promise<{ structure: string; allValues: { depth1: string[]; depth2: string[]; depth3: string[]; depth4: string[] } }> {
  const { data, error } = await supabase
    .from('taxonomy')
    .select('depth1, depth2, depth3, depth4')
    .order('depth1, depth2, depth3, depth4');
  
  if (error) throw error;
  
  const structure: any = {};
  const allValues: { depth1: Set<string>; depth2: Set<string>; depth3: Set<string>; depth4: Set<string> } = {
    depth1: new Set(),
    depth2: new Set(),
    depth3: new Set(),
    depth4: new Set(),
  };
  
  for (const row of data || []) {
    const d1 = row.depth1 || '';
    const d2 = row.depth2 || '';
    const d3 = row.depth3 || '';
    const d4 = row.depth4 || '';
    
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
  
  return {
    structure: formatStructure(structure),
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
  depth4: string
): Promise<{ code: string | null; cefr: string | null; difficulty: number | null }> {
  const { data, error } = await supabase
    .from('taxonomy')
    .select('code, cefr, difficulty')
    .eq('depth1', depth1)
    .eq('depth2', depth2)
    .eq('depth3', depth3)
    .eq('depth4', depth4)
    .single();
  
  if (error || !data) {
    return { code: null, cefr: null, difficulty: null };
  }
  
  return {
    code: data.code || null,
    cefr: data.cefr || null,
    difficulty: data.difficulty || null,
  };
}

function buildPrompt(classificationData: { structure: string; allValues: { depth1: string[]; depth2: string[]; depth3: string[]; depth4: string[] } }) {
  const { structure, allValues } = classificationData;
  
  return `
### 1. 페르소나 (Persona) ###
당신은 영어 교육 평가 전문가입니다. 다양한 유형의 영어 문제를 이해하고, 교육과정 분류 체계에 따라 문제의 핵심 의도를 파악하여 정확하게 분류할 수 있습니다.

### 2. 과업 (Task) ###
주어진 영어 문제 텍스트를 분석하여, 아래 분류 기준표에 따라 문제의 유형을 "1Depth"부터 "4Depth"까지 정확하게 분류하세요.

### 3. 맥락 (Context) ###
**분류 기준표 계층 구조**:
\`\`\`
${structure}
\`\`\`

**사용 가능한 분류 값 목록** (반드시 아래 목록의 값만 사용하세요):

**1Depth 가능한 값** (정확히 일치해야 함):
${allValues.depth1.map(v => `- "${v}"`).join('\n')}

**2Depth 가능한 값** (정확히 일치해야 함):
${allValues.depth2.map(v => `- "${v}"`).join('\n')}

**3Depth 가능한 값** (정확히 일치해야 함):
${allValues.depth3.map(v => `- "${v}"`).join('\n')}

**4Depth 가능한 값** (정확히 일치해야 함):
${allValues.depth4.map(v => `- "${v}"`).join('\n')}

### 4. 단계별 지시 (Step-by-Step Instructions) ###

**[1단계: 문제 텍스트 분석]**
- 주어진 문제 텍스트를 자세히 읽고 분석합니다.
- 문제의 핵심 문법 요소, 어휘, 구조를 파악합니다.

**[2단계: 분류 기준표 매칭]**
- 위 "사용 가능한 분류 값 목록"에서 문제의 핵심 요소와 가장 일치하는 분류를 찾습니다.
- **절대 규칙**: 
  - 위 "사용 가능한 분류 값 목록"에 나와있는 정확한 문자열만 사용하세요.
  - 공백, 특수문자(· 등)를 포함하여 정확히 일치해야 합니다.
  - 예: "문장 유형·시제·상" (올바름) vs "문장유형" (잘못됨 - 공백과 특수문자 누락)
  - 예: "시제와 상" (올바름) vs "시제와 동사 활용" (잘못됨 - 목록에 없음)
- 목록에 없는 값은 절대 생성하지 마세요.
- "..." 같은 임의의 값은 절대 사용하지 마세요.

**[3단계: 분류 검증]**
- 선택한 각 depth 값이 위 "사용 가능한 분류 값 목록"에 정확히 존재하는지 확인합니다.
- 존재하지 않는 분류라면 다시 검토하여 정확한 분류를 찾습니다.
- 계층 구조를 따라야 합니다 (depth1 → depth2 → depth3 → depth4).

### 5. 출력 명세 (Output Specification) ###
다음 JSON 형식으로 출력하세요. **반드시 위 "사용 가능한 분류 값 목록"에 있는 정확한 값만 사용하세요.**

\`\`\`json
{
  "1Depth": "위 목록의 depth1 값 중 하나 (정확히 일치)",
  "2Depth": "위 목록의 depth2 값 중 하나 (정확히 일치)",
  "3Depth": "위 목록의 depth3 값 중 하나 (정확히 일치)",
  "4Depth": "위 목록의 depth4 값 중 하나 (정확히 일치)",
  "분류_신뢰도": "높음" | "보통" | "낮음"
}
\`\`\`

### 6. 제약 및 예외 처리 (Constraints & Error Handling) ###
- **절대 규칙**: 위 "사용 가능한 분류 값 목록"에 없는 값은 절대 사용하지 마세요.
- **문자열 정확성**: 공백, 특수문자(· 등)를 포함하여 목록의 값과 정확히 일치해야 합니다.
- **잘못된 예시**: 
  - ❌ "문장유형" (공백 누락)
  - ❌ "시제와 동사 활용" (목록에 없음)
  - ❌ "..." (임의의 값)
- **올바른 예시**:
  - ✅ "문장 유형·시제·상" (목록에 있는 정확한 값)
  - ✅ "시제와 상" (목록에 있는 정확한 값)
- **분류 불가능한 경우**: 목록에 정확히 일치하는 분류를 찾을 수 없다면, "분류_신뢰도"를 "낮음"으로 설정하되, 가장 가까운 분류를 사용하세요.
`;
}

serve(async (req) => {
  // OPTIONS 요청 처리
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { 
      status: 405, 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
    });
  }

  try {
    const { userId, batchSize = 100 } = await req.json();

    if (!userId) {
      return new Response(JSON.stringify({ error: 'Missing required field: userId' }), { 
        status: 400, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      });
    }

    // Supabase 클라이언트 생성
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const geminiApiKey = Deno.env.get('GEMINI_API_KEY');

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Missing Supabase environment variables');
    }

    if (!geminiApiKey) {
      throw new Error('GEMINI_API_KEY environment variable is not set');
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // 1. 사용자의 모든 문제 조회
    console.log('Step 1: Fetching user problems');
    const { data: labels, error: labelsError } = await supabase
      .from('labels')
      .select(`
        id,
        problem_id,
        classification,
        problems!inner (
          id,
          stem,
          sessions!inner (
            user_id
          )
        )
      `)
      .eq('problems.sessions.user_id', userId);

    if (labelsError) throw labelsError;

    if (!labels || labels.length === 0) {
      return new Response(JSON.stringify({ 
        success: true,
        message: 'No problems to reclassify',
        total: 0,
        processed: 0
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    console.log(`Step 1 completed: Found ${labels.length} problems`);

    // 2. Taxonomy 데이터 로드
    console.log('Step 2: Loading taxonomy data');
    const taxonomyData = await loadTaxonomyData(supabase);
    const prompt = buildPrompt(taxonomyData);
    const ai = new GoogleGenAI({ apiKey: geminiApiKey });

    // 3. 배치 처리
    let processed = 0;
    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < labels.length; i += batchSize) {
      const batch = labels.slice(i, i + batchSize);
      console.log(`Processing batch ${Math.floor(i / batchSize) + 1}: ${batch.length} problems`);

      await Promise.all(batch.map(async (label: any) => {
        try {
          const stem = label.problems?.stem;
          if (!stem || stem.trim() === '') {
            console.warn(`Skipping problem ${label.problem_id}: empty stem`);
            return;
          }

          // Gemini로 재분류
          const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: { parts: [{ text: `${prompt}\n\n문제: ${stem}` }] },
          });

          const responseText = response.text;
          const jsonString = responseText.replace(/```json/g, '').replace(/```/g, '').trim();
          const classification = JSON.parse(jsonString);

          // 분류 값 검증: taxonomy에 실제로 존재하는지 확인
          const depth1 = classification['1Depth'] || '';
          const depth2 = classification['2Depth'] || '';
          const depth3 = classification['3Depth'] || '';
          const depth4 = classification['4Depth'] || '';

          // Taxonomy 조회
          const taxonomy = await findTaxonomyByDepth(
            supabase,
            depth1,
            depth2,
            depth3,
            depth4
          );

          // taxonomy에 존재하지 않는 경우 스킵하거나 재시도
          if (!taxonomy.code) {
            console.warn(`Taxonomy not found for depth: ${depth1}/${depth2}/${depth3}/${depth4}. Skipping update.`);
            failCount++;
            return; // 이 문제는 스킵하고 다음으로 진행
          }

          // classification 업데이트
          const enrichedClassification = {
            ...classification,
            code: taxonomy.code,
            CEFR: taxonomy.cefr,
            난이도: taxonomy.difficulty,
          };

          // DB 업데이트
          const { error: updateError } = await supabase
            .from('labels')
            .update({ classification: enrichedClassification })
            .eq('id', label.id);

          if (updateError) throw updateError;

          successCount++;
        } catch (error) {
          console.error(`Error processing label ${label.id}:`, error);
          failCount++;
        }
      }));

      processed += batch.length;
    }

    console.log(`Reclassification completed: ${successCount} success, ${failCount} failed`);

    return new Response(JSON.stringify({
      success: true,
      total: labels.length,
      processed,
      successCount,
      failCount,
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error: any) {
    console.error('Error in reclassify-problems function:', error);
    
    return new Response(JSON.stringify({ 
      error: error.message || 'Internal server error',
      details: error.toString()
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

