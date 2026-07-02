import crypto from 'crypto';

// 토큰 캐시 (1시간 유효, 갱신 마진 5분)
let cachedToken = null;

/**
 * Base64URL 인코딩 함수 (문자열 또는 Buffer 모두 지원)
 */
function base64url(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input);
  return buf.toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

/**
 * 서비스 계정 JSON을 사용하여 Google OAuth 2.0 Access Token을 발급받습니다.
 */
async function getAccessToken(serviceAccountJson) {
  // 만료 5분 전까지는 캐시 재사용
  if (cachedToken && Date.now() < cachedToken.expiresAt - 300_000) {
    return cachedToken.token;
  }

  const credentials = JSON.parse(serviceAccountJson);
  const { client_email, private_key } = credentials;

  const header = {
    alg: 'RS256',
    typ: 'JWT'
  };

  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: client_email,
    scope: 'https://www.googleapis.com/auth/cloud-platform',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now
  };

  const encodedHeader = base64url(JSON.stringify(header));
  const encodedPayload = base64url(JSON.stringify(payload));
  
  const unsignedToken = `${encodedHeader}.${encodedPayload}`;
  
  const sign = crypto.createSign('RSA-SHA256');
  sign.update(unsignedToken);
  sign.end();
  
  // sign.sign()은 Buffer를 반환하므로 base64url이 Buffer를 직접 처리해야 함
  const signature = base64url(sign.sign(private_key));
  const jwt = `${unsignedToken}.${signature}`;

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt
    })
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`[DocumentAI] Access Token 발급 실패 (${response.status}): ${err.substring(0, 500)}`);
  }

  const data = await response.json();
  cachedToken = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in * 1000),
  };
  console.log(`[DocumentAI] Access Token 발급 완료, 유효기간: ${data.expires_in}초`);
  return data.access_token;
}

// 선택지 원문자(circled numbers). ⑥~⑩까지 포함(일부 시험 6지선다 대비).
const CIRCLED_NUMBERS = '①②③④⑤⑥⑦⑧⑨⑩';

/**
 * Document AI 토큰에서 선택지 원문자(①②③④⑤) 심볼의 위치를 추출한다.
 * - 좌표는 0~1000 정규화(프롬프트/bbox 스케일과 동일) → 그대로 bbox 계산에 사용 가능.
 * - 학생이 원문자 위에 손그림 마크(동그라미)를 쳐서 그 원문자 글리프가 OCR에서 누락될 수
 *   있으나(실측 Q25 ④), 나머지 원문자들의 bounding으로 answer_area는 충분히 결정된다.
 * @returns {Array<{char, x1, y1, x2, y2}>} 원문자 심볼 목록(0~1000 스케일)
 */
function extractCircledSymbols(pages, fullText) {
  const symbols = [];
  for (const page of pages || []) {
    for (const tok of (page.tokens || [])) {
      const seg = tok.layout?.textAnchor?.textSegments?.[0];
      if (!seg) continue;
      const start = Number(seg.startIndex || 0);
      const end = Number(seg.endIndex || 0);
      const txt = fullText.substring(start, end);
      const ch = [...txt].find((c) => CIRCLED_NUMBERS.includes(c));
      if (!ch) continue;
      const verts = tok.layout?.boundingPoly?.normalizedVertices || [];
      if (verts.length < 2) continue;
      const xs = verts.map((p) => (p.x || 0) * 1000);
      const ys = verts.map((p) => (p.y || 0) * 1000);
      symbols.push({
        char: ch,
        x1: Math.min(...xs), y1: Math.min(...ys),
        x2: Math.max(...xs), y2: Math.max(...ys),
      });
    }
  }
  return symbols;
}

/**
 * Document AI 프로세서를 호출하여 이미지에서 텍스트 및 페이지 정보를 추출합니다.
 * @param {string} imageBase64 - Base64 인코딩된 이미지 문자열 (접두사 제외)
 * @param {string} mimeType - 이미지의 MIME 타입 (예: 'image/jpeg')
 * @param {Object} options - 추가 옵션
 * @returns {Promise<{text: string, pages: Array, symbols: Array}>} 추출된 텍스트/페이지/원문자 심볼
 */
export async function callDocumentAI(imageBase64, mimeType, options = {}) {
  try {
    console.log(`[DocumentAI] Document AI 호출 시작`);
    
    // 환경변수에서 서비스 계정 정보 로드
    const serviceAccountJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
    if (!serviceAccountJson) {
      throw new Error('[DocumentAI] GOOGLE_SERVICE_ACCOUNT_JSON 환경변수가 설정되지 않았습니다.');
    }
    
    // 프로젝트 ID 추출 (JSON 파싱 후 없으면 환경변수 또는 기본값 사용)
    let projectId;
    try {
      const credentials = JSON.parse(serviceAccountJson);
      projectId = credentials.project_id || process.env.GOOGLE_CLOUD_PROJECT || 'gen-lang-client-0516945872';
    } catch (e) {
      projectId = process.env.GOOGLE_CLOUD_PROJECT || 'gen-lang-client-0516945872';
    }

    const processorId = process.env.DOCUMENT_AI_PROCESSOR_ID;
    if (!processorId) {
      throw new Error('[DocumentAI] DOCUMENT_AI_PROCESSOR_ID 환경변수가 설정되지 않았습니다.');
    }

    const location = process.env.DOCUMENT_AI_LOCATION || 'us';

    console.log(`[DocumentAI] Access Token 발급 요청`);
    const accessToken = await getAccessToken(serviceAccountJson);
    
    const endpoint = `https://${location}-documentai.googleapis.com/v1/projects/${projectId}/locations/${location}/processors/${processorId}:process`;

    const requestBody = {
      skipHumanReview: true,
      rawDocument: {
        mimeType: mimeType,
        content: imageBase64
      },
      // pages.tokens 추가: 선택지 원문자(①②③④⑤)의 결정적 위치를 얻어 answer_area_bbox를
      // Pass 0(비결정적 LLM) 대신 결정적으로 산출하기 위함. 동일 process 호출이라 추가 비용 없음.
      fieldMask: 'text,pages.blocks,pages.paragraphs,pages.lines,pages.tokens,pages.pageNumber,pages.dimension',
      processOptions: {
        ocrConfig: {
          // NOTE: enableImageQualityScores 제거 — 산출물(품질점수)을 코드에서 소비하지 않고
          // fieldMask에도 미포함이라 반환조차 안 됨. add-on 과금($6/1000p)만 발생하던 순수 낭비.
          // 저화질 재촬영 유도 등 실제 소비 기능을 붙일 때 fieldMask와 함께 되살릴 것.
          hints: {
            languageHints: ['ko', 'en']
          }
        }
      }
    };

    console.log(`[DocumentAI] API 요청 전송: ${endpoint}`);
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`[DocumentAI] API 호출 실패 (${response.status}): ${errorText.substring(0, 500)}`);
    }

    const data = await response.json();
    const fullText = data.document?.text || '';
    const pages = data.document?.pages || [];
    const blockCount = pages.reduce((sum, p) => sum + (p.blocks?.length || 0), 0);
    const lineCount = pages.reduce((sum, p) => sum + (p.lines?.length || 0), 0);
    const symbols = extractCircledSymbols(pages, fullText);
    console.log(`[DocumentAI] 호출 완료: ${fullText.length}자, ${pages.length}페이지, ${blockCount}블록, ${lineCount}라인, ${symbols.length}원문자`);

    return {
      text: fullText,
      pages: pages,
      symbols: symbols
    };
  } catch (error) {
    console.error(`[DocumentAI] 에러 발생: ${error.message}`);
    throw error;
  }
}
