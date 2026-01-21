import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { GoogleGenAI } from "https://esm.sh/@google/genai@1.21.0";
import { createServiceSupabaseClient } from "../_shared/supabaseClient.ts";
import { requireEnv } from "../_shared/env.ts";
import { CORS_HEADERS, handleOptions, jsonResponse, errorResponse } from "../_shared/http.ts";
import { loadTaxonomyData, findTaxonomyByDepth } from "../_shared/taxonomy.ts";
import { generateWithRetry, parseJsonResponse, extractTextFromResponse } from "../_shared/aiClient.ts";
import { summarizeError } from "../_shared/errors.ts";

function buildPrompt(classificationData: { structure: string; allValues: { depth1: string[]; depth2: string[]; depth3: string[]; depth4: string[] } }) {
  const { structure, allValues } = classificationData;

  return `
# 영어 문제 분류 작업

## 📋 분류 기준표

### 계층 구조
\`\`\`
${structure}
\`\`\`

## ⚠️ 절대 규칙

### 🚫 금지 사항
1. 위 계층 구조에 없는 값을 생성하거나 사용하지 마세요.
2. 공백이나 특수문자(·)를 변경하지 마세요.
   - ❌ "문장유형" (잘못됨 - 공백 누락)
   - ✅ "문장 유형·시제·상" (올바름 - 정확히 일치)
3. 임의의 값이나 약어를 사용하지 마세요.
   - ❌ "어휘" (잘못됨 - 약어)
   - ❌ "시제와 동사 활용" (잘못됨 - 목록에 없음)
   - ✅ "어휘·연결" (올바름 - 계층 구조에 있음)

### ✅ 필수 사항
1. 위 계층 구조에서 값을 찾아 **정확히 복사**해서 사용하세요.
2. 공백, 특수문자(·), 대소문자를 **정확히 일치**시켜야 합니다.
3. 계층 구조를 따라 depth1 → depth2 → depth3 → depth4 순서로 선택하세요.

## 📝 작업 절차

1. 문제 텍스트를 읽고 핵심 문법 요소를 파악하세요.
2. 위 계층 구조에서 각 depth에 맞는 값을 찾으세요.
3. 선택한 값이 계층 구조에 정확히 존재하는지 확인하세요.
4. JSON 형식으로 출력하세요.

## 📤 출력 형식

다음 JSON 형식으로만 출력하세요:

\`\`\`json
{
  "depth1": "위 계층 구조의 depth1 값 중 하나를 정확히 복사",
  "depth2": "위 계층 구조의 depth2 값 중 하나를 정확히 복사",
  "depth3": "위 계층 구조의 depth3 값 중 하나를 정확히 복사",
  "depth4": "위 계층 구조의 depth4 값 중 하나를 정확히 복사",
  "분류_신뢰도": "높음" | "보통" | "낮음"
}
\`\`\`

## 🔴 최종 확인

출력하기 전에 다음을 확인하세요:
- [ ] 선택한 값이 위 계층 구조에 정확히 존재하는가?
- [ ] 공백과 특수문자(·)가 정확히 일치하는가?
- [ ] 계층 구조에 없는 값을 사용하지 않았는가?

위 규칙을 엄격히 준수하여 분류하세요.
`;
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return handleOptions();
  }

  if (req.method !== 'POST') {
    return errorResponse('Method not allowed', 405);
  }

  try {
    const { userId, batchSize = 100, language } = await req.json();

    if (!userId) {
      return errorResponse('Missing required field: userId', 400);
    }

    const supabase = createServiceSupabaseClient();
    const geminiApiKey = requireEnv('GEMINI_API_KEY');

    // 1. 사용자의 모든 문제 조회
    console.log('Step 1: Fetching user problems');
    // DB Schema Change: problems.stem has been moved to problems.content->>'stem'
    // but here we select *, so we just need to adapt usage.
    // Actually in the original code: .select(`..., problems!inner(id, stem, ...)`)
    // If stem column is deleted, this reclassify function will fail unless we update the query.
    // However, for safety, let's select '*' from problems or just select 'content' if possible.
    // But Supabase query syntax for joining is strict.
    // Let's rely on '*' for problems to avoid listing missing columns.
    const { data: labels, error: labelsError } = await supabase
      .from('labels')
      .select(`
        id,
        problem_id,
        classification,
        problems!inner (
          id,
          content,
          sessions!inner (
            user_id
          )
        )
      `)
      .eq('problems.sessions.user_id', userId);

    if (labelsError) throw labelsError;

    if (!labels || labels.length === 0) {
      return jsonResponse({
        success: true,
        message: 'No problems to reclassify',
        total: 0,
        processed: 0
      });
    }

    console.log(`Step 1 completed: Found ${labels.length} problems`);

    // 2. Taxonomy 데이터 로드
    console.log('Step 2: Loading taxonomy data');
    const userLanguage: 'ko' | 'en' = language === 'en' ? 'en' : 'ko';

    const taxonomyData = await loadTaxonomyData(supabase, userLanguage);
    const prompt = buildPrompt(taxonomyData);
    const ai = new GoogleGenAI({ apiKey: geminiApiKey });
    const sessionId = `reclassify-${userId}-${Date.now()}`;
    const modelName = 'gemini-2.5-flash';

    // 3. 배치 처리
    let processed = 0;
    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < labels.length; i += batchSize) {
      const batch = labels.slice(i, i + batchSize);
      console.log(`Processing batch ${Math.floor(i / batchSize) + 1}: ${batch.length} problems`);

      await Promise.all(batch.map(async (label: any) => {
        try {
          // DB 스키마 대응: content JSONB 우선 사용
          const problem = label.problems;
          const stem = problem?.stem || problem?.content?.stem;

          if (!stem || stem.trim() === '') {
            console.warn(`Skipping problem ${label.problem_id}: empty stem`);
            return;
          }

          // Gemini로 재분류 (재시도 로직 사용)
          const result = await generateWithRetry({
            ai,
            model: modelName,
            contents: { parts: [{ text: `${prompt}\n\n문제: ${stem}` }] },
            sessionId,
            maxRetries: 2,
            baseDelayMs: 2000,
            temperature: 0.1 // 분류 작업이므로 temperature 낮게 설정
          });

          const responseText = await extractTextFromResponse(result.response, modelName);
          const classification: any = parseJsonResponse(responseText, modelName);

          // Gemini가 반환한 원본 값
          const rawDepth1 = (classification.depth1 || '').trim();
          const rawDepth2 = (classification.depth2 || '').trim();
          const rawDepth3 = (classification.depth3 || '').trim();
          const rawDepth4 = (classification.depth4 || '').trim();

          // 유효성 검증: DB에 있는 값인지 확인
          const validDepth1 = taxonomyData.allValues.depth1.includes(rawDepth1) ? rawDepth1 : '';
          const validDepth2 = taxonomyData.allValues.depth2.includes(rawDepth2) ? rawDepth2 : '';
          const validDepth3 = taxonomyData.allValues.depth3.includes(rawDepth3) ? rawDepth3 : '';
          const validDepth4 = taxonomyData.allValues.depth4.includes(rawDepth4) ? rawDepth4 : '';

          // 유효하지 않은 값이 있으면 경고
          if (!validDepth1 && rawDepth1) console.warn(`Invalid depth1: "${rawDepth1}"`);

          // 유효한 값으로만 taxonomy 조회
          const taxonomy = await findTaxonomyByDepth(
            supabase,
            validDepth1,
            validDepth2,
            validDepth3,
            validDepth4,
            userLanguage
          );

          // 분류 신뢰도 결정
          let confidence = classification['분류_신뢰도'] || '보통';
          if (!validDepth1 || !taxonomy.code) {
            confidence = '낮음';
          }

          // classification 업데이트 (유효한 값만 저장)
          const enrichedClassification = {
            depth1: validDepth1 || null,
            depth2: validDepth2 || null,
            depth3: validDepth3 || null,
            depth4: validDepth4 || null,
            code: taxonomy.code,
            CEFR: taxonomy.cefr,
            난이도: taxonomy.difficulty,
            분류_신뢰도: confidence,
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
            successCount++; // 분류는 저장됨
          }
        } catch (error: any) {
          console.error(`Error processing label ${label.id}:`, summarizeError(error));
          failCount++;
        }
      }));

      processed += batch.length;
    }

    console.log(`Reclassification completed: ${successCount} success, ${failCount} failed`);

    return jsonResponse({
      success: true,
      total: labels.length,
      processed,
      successCount,
      failCount,
    });

  } catch (error: any) {
    console.error('Error in reclassify-problems function:', error);
    return errorResponse(
      error.message || 'Internal server error',
      500,
      summarizeError(error)
    );
  }
});

