import { Handler, HandlerEvent } from '@netlify/functions';
import { GoogleGenAI } from '@google/genai';
import { createClient } from '@supabase/supabase-js';
import { classificationData } from '../../constants';

const GEMINI_API_KEY = process.env.VITE_GEMINI_API_KEY || '';
const SUPABASE_URL = process.env.VITE_SUPABASE_URL || '';
const SUPABASE_SERVICE_KEY = process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || '';

const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const prompt = `
### 1. 페르소나 (Persona) ###
당신은 두 가지 전문성을 겸비한 최고 수준의 AI 전문가입니다:
1.  **손글씨 OCR 전문가**: 불규칙한 필기, 겹쳐 쓴 글씨, 다양한 필기구의 흔적까지 분석하여 디지털 텍스트로 변환하는 데 특화되어 있습니다. 펜의 압력, 기울기, 획의 연결성과 같은 미세한 특징을 파악하여 문맥 기반으로 모호한 글자를 추론하는 능력이 뛰어납니다.
2.  **영어 교육 평가 전문가**: 다양한 유형의 영어 문제를 이해하고, 교육과정 분류 체계에 따라 문제의 핵심 의도를 파악하여 정확하게 분류할 수 있습니다.

### 2. 과업 (Task) ###
사용자가 업로드한 영어 문제 이미지 한 장을 종합적으로 분석하여, 이미지 내의 모든 텍스트와 손글씨를 인식하고, 문제 유형을 분류한 뒤, 분석된 모든 정보를 지정된 JSON 형식에 맞춰 단 하나의 결과물로 출력해야 합니다.

### 3. 맥락 (Context) ###
- **입력 데이터 1 (이미지)**: 사용자가 촬영하거나 업로드한 영어 문제 이미지 파일. 이 이미지에는 인쇄된 문제 텍스트, 객관식 보기, 그리고 사용자가 손으로 작성한 답안 및 채점 표시(O, X, △, ✓, 취소선 등)가 포함되어 있습니다.
- **입력 데이터 2 (분류 기준표)**: 문제 유형을 분류하기 위한 기준이 되는 데이터입니다.
\`\`\`
${classificationData}
\`\`\`

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

export const handler: Handler = async (event: HandlerEvent) => {
  // CORS 헤더
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };

  // OPTIONS 요청 처리
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const { imageBase64, mimeType, userId, fileName } = JSON.parse(event.body || '{}');

    if (!imageBase64 || !userId) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing required fields' }) };
    }

    // 1. 이미지를 Storage에 업로드
    const timestamp = Date.now();
    const safeName = (fileName || 'image.jpg').replace(/[^a-zA-Z0-9_.-]/g, '_');
    
    const { data: userData } = await supabase.auth.admin.getUserById(userId);
    const email = userData.user?.email || userId;
    const emailLocal = email.split('@')[0].replace(/[^a-zA-Z0-9_-]/g, '_');
    const path = `${emailLocal}/${timestamp}_${safeName}`;
    
    const buffer = Buffer.from(imageBase64, 'base64');
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('problem-images')
      .upload(path, buffer, {
        contentType: mimeType,
        cacheControl: '3600',
        upsert: false,
      });

    if (uploadError) throw uploadError;

    const { data: urlData } = supabase.storage.from('problem-images').getPublicUrl(uploadData.path);
    const imageUrl = urlData.publicUrl;

    // 2. 세션 생성
    const { data: sessionData, error: sessionError } = await supabase
      .from('sessions')
      .insert({ user_id: userId, image_url: imageUrl })
      .select('id')
      .single();

    if (sessionError) throw sessionError;
    const sessionId = sessionData.id;

    // 3. Gemini 분석
    const imagePart = { inlineData: { data: imageBase64, mimeType } };
    const textPart = { text: prompt };

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: { parts: [textPart, imagePart] },
    });

    const responseText = response.text;
    const jsonString = responseText.replace(/```json/g, '').replace(/```/g, '').trim();
    const result = JSON.parse(jsonString);

    if (!result || !Array.isArray(result.items)) {
      throw new Error('AI 응답 형식 오류');
    }

    // 4. 문제 저장
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

    if (problemsError) throw problemsError;

    // 5. 라벨 저장
    const idByIndex = new Map<number, string>();
    for (const row of problems || []) {
      idByIndex.set(row.index_in_image, row.id);
    }

    const labelsPayload = items.map((it: any, idx: number) => {
      const normalizedMark = normalizeMark(it.사용자가_직접_채점한_정오답);
      return {
        problem_id: idByIndex.get(it.index ?? idx)!,
        user_answer: it.사용자가_기술한_정답?.text || '',
        user_mark: normalizedMark,
        is_correct: normalizedMark === 'O',
        classification: it.문제_유형_분류 || {},
        confidence: {
          stem: it.문제내용?.confidence_score || 1.0,
          answer: it.사용자가_기술한_정답?.confidence_score || 1.0,
          choices: (it.문제_보기 || []).map((c: any) => c.confidence_score || 1.0),
        },
      };
    });

    const { error: labelsError } = await supabase.from('labels').insert(labelsPayload);
    if (labelsError) throw labelsError;

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, sessionId }),
    };
  } catch (error: any) {
    console.error('Error in analyze-image function:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: error.message || 'Internal server error' }),
    };
  }
};

