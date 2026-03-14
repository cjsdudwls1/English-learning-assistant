// 바운딩 박스 검출 테스트용 Edge Function
// 이미지를 받아서 각 문제의 답안 영역 좌표를 반환
import { createAIClient } from '../_shared/aiClientFactory.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { imageBase64, mimeType } = await req.json();

    if (!imageBase64 || !mimeType) {
      return new Response(
        JSON.stringify({ error: 'imageBase64와 mimeType이 필요합니다' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // AI 클라이언트 생성 (Vertex AI 시크릿 사용)
    const { ai, provider } = createAIClient();
    console.log(`[BBox Test] AI provider: ${provider}`);

    // 바운딩 박스 검출 프롬프트
    const prompt = `You are analyzing an English exam page image.

Your task: For each problem (question) visible on this page, identify the ANSWER MARKING AREA - the region where a student would circle, check, or write their answer.

For multiple choice questions, the answer area is where the choice numbers (①②③④⑤) are located.
For short answer questions, the answer area is the blank line or box where students write.

Return the bounding box coordinates for each problem's answer area.
Coordinates should be in NORMALIZED format: values from 0 to 1000, where (0,0) is the top-left corner and (1000,1000) is the bottom-right corner.

Output JSON only:
{
  "problems": [
    {
      "problem_number": "25",
      "answer_area_bbox": {
        "x1": 100,
        "y1": 200,
        "x2": 400,
        "y2": 300
      },
      "description": "Multiple choice ①②③④⑤ area for Q25"
    }
  ],
  "image_dimensions_note": "Coordinates are normalized 0-1000"
}`;

    const contents = {
      parts: [
        { text: prompt },
        { inlineData: { data: imageBase64, mimeType } },
      ],
    };

    console.log(`[BBox Test] Sending request to Gemini...`);

    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents,
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 1.0,
      },
    });

    // 응답 텍스트 추출
    let responseText = '';
    const candidates = (response as any)?.candidates;
    if (candidates?.[0]?.content?.parts?.[0]?.text) {
      responseText = candidates[0].content.parts[0].text;
    }

    console.log(`[BBox Test] Response (${responseText.length} chars):`, responseText.substring(0, 2000));

    // JSON 파싱
    let parsed;
    try {
      const cleaned = responseText.replace(/```json/g, '').replace(/```/g, '').trim();
      parsed = JSON.parse(cleaned);
    } catch (e) {
      parsed = { raw: responseText, parseError: (e as Error).message };
    }

    return new Response(
      JSON.stringify({
        provider,
        model: 'gemini-3-flash-preview',
        bounding_boxes: parsed,
      }, null, 2),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[BBox Test] Error:', error);
    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
