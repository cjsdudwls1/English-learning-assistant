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
# 영어 문제 분류 작업

## 📋 분류 기준표

### 계층 구조
\`\`\`
${structure}
\`\`\`

### ✅ 사용 가능한 값 목록 (반드시 아래 목록에서만 선택하세요)

**1Depth - 정확히 아래 중 하나만 사용:**
${allValues.depth1.map((v, i) => `${i + 1}. "${v}"`).join('\n')}

**2Depth - 정확히 아래 중 하나만 사용:**
${allValues.depth2.map((v, i) => `${i + 1}. "${v}"`).join('\n')}

**3Depth - 정확히 아래 중 하나만 사용:**
${allValues.depth3.map((v, i) => `${i + 1}. "${v}"`).join('\n')}

**4Depth - 정확히 아래 중 하나만 사용:**
${allValues.depth4.map((v, i) => `${i + 1}. "${v}"`).join('\n')}

## ⚠️ 절대 규칙

### 🚫 금지 사항
1. 목록에 없는 값을 생성하거나 사용하지 마세요.
2. 공백이나 특수문자(·)를 변경하지 마세요.
   - ❌ "문장유형" (잘못됨)
   - ✅ "문장 유형·시제·상" (올바름)
3. 임의의 값이나 약어를 사용하지 마세요.
   - ❌ "시제와 동사 활용" (목록에 없음)
   - ❌ "..." (임의의 값)
   - ✅ "시제와 상" (목록에 있음)

### ✅ 필수 사항
1. 위 목록에서 값을 찾아 **정확히 복사**해서 사용하세요.
2. 공백, 특수문자(·), 대소문자를 **정확히 일치**시켜야 합니다.
3. 계층 구조를 따라 depth1 → depth2 → depth3 → depth4 순서로 선택하세요.

## 📝 작업 절차

1. 문제 텍스트를 읽고 핵심 문법 요소를 파악하세요.
2. 위 "사용 가능한 값 목록"에서 각 depth에 맞는 값을 찾으세요.
3. 선택한 값이 목록에 정확히 존재하는지 확인하세요.
4. JSON 형식으로 출력하세요.

## 📤 출력 형식

다음 JSON 형식으로만 출력하세요:

\`\`\`json
{
  "1Depth": "위 목록의 depth1 값 중 하나를 정확히 복사",
  "2Depth": "위 목록의 depth2 값 중 하나를 정확히 복사",
  "3Depth": "위 목록의 depth3 값 중 하나를 정확히 복사",
  "4Depth": "위 목록의 depth4 값 중 하나를 정확히 복사",
  "분류_신뢰도": "높음" | "보통" | "낮음"
}
\`\`\`

## 🔴 최종 확인

출력하기 전에 다음을 확인하세요:
- [ ] 선택한 값이 위 "사용 가능한 값 목록"에 정확히 존재하는가?
- [ ] 공백과 특수문자(·)가 정확히 일치하는가?
- [ ] 목록에 없는 값을 사용하지 않았는가?

위 규칙을 엄격히 준수하여 분류하세요.
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

          // Gemini가 반환한 값 (프롬프트 최적화로 정확한 값이 반환되어야 함)
          const depth1 = (classification['1Depth'] || '').trim();
          const depth2 = (classification['2Depth'] || '').trim();
          const depth3 = (classification['3Depth'] || '').trim();
          const depth4 = (classification['4Depth'] || '').trim();

          // Taxonomy 조회
          const taxonomy = await findTaxonomyByDepth(
            supabase,
            depth1,
            depth2,
            depth3,
            depth4
          );

          // 분류 신뢰도 결정
          let confidence = classification['분류_신뢰도'] || '보통';
          if (!taxonomy.code) {
            confidence = '낮음';
            console.warn(`Taxonomy not found for: ${depth1}/${depth2}/${depth3}/${depth4}`);
          }

          // classification 업데이트 (무조건 분류 - taxonomy.code가 없어도 저장)
          const enrichedClassification = {
            '1Depth': depth1,
            '2Depth': depth2,
            '3Depth': depth3,
            '4Depth': depth4,
            'code': taxonomy.code,
            'CEFR': taxonomy.cefr,
            '난이도': taxonomy.difficulty,
            '분류_신뢰도': confidence,
          };

          // DB 업데이트 (무조건 수행)
          const { error: updateError } = await supabase
            .from('labels')
            .update({ classification: enrichedClassification })
            .eq('id', label.id);

          if (updateError) {
            console.error(`Failed to update label ${label.id}:`, updateError);
            throw updateError;
          }

          if (taxonomy.code) {
            successCount++;
          } else {
            console.warn(`Classification saved but no taxonomy code found for: ${depth1}/${depth2}/${depth3}/${depth4}`);
            successCount++; // 여전히 성공으로 카운트 (분류는 저장됨)
          }
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

