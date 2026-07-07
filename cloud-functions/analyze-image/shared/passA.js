/**
 * Pass A: 구조 추출 — 이미지에서 문제/지문/선택지 추출 (+ Document AI Pre-OCR)
 */

import { callDocumentAI } from './documentAiClient.js';
import { callModelWithFailover } from './aiClient.js';
import * as config from './config.js';
import { buildPrompt } from './prompts.js';

/**
 * Pass A: 구조 추출 - 이미지에서 문제/지문/선택지 추출
 */
export async function executePassA({ ai, sessionId, imageBase64, mimeType, pageNum, totalPages, taxonomyData, preferredModel }) {
  // Document AI Pre-OCR: 환경변수가 설정된 경우에만 실행
  let ocrPages = [];
  // 선택지 원문자(①②③④⑤) 위치 심볼(0~1000). processPage에서 answer_area_bbox 결정화에 사용.
  let ocrSymbols = [];

  if (config.DOCUMENT_AI_ENABLED) {
    try {
      console.log(`[PreOCR] Document AI Pre-OCR 시작 (Session: ${sessionId}, Page: ${pageNum}/${totalPages})`);
      const docAiResult = await callDocumentAI(imageBase64, mimeType);

      // Document AI 반환값 {text, pages}를 buildPrompt가 요구하는 형식으로 변환
      // buildPrompt의 ocrPages: Array<{page: number, text: string}>
      if (docAiResult.text && docAiResult.text.trim().length > 0) {
        ocrPages = [{ page: pageNum, text: docAiResult.text }];
        console.log(`[PreOCR] Document AI 성공: ${docAiResult.text.length}자 추출 (페이지 ${pageNum})`);
      } else {
        console.warn(`[PreOCR] Document AI가 텍스트를 반환하지 않음, Gemini 직접 OCR로 fallback`);
      }
      if (Array.isArray(docAiResult.symbols)) {
        ocrSymbols = docAiResult.symbols;
      }
    } catch (error) {
      console.error(`[PreOCR] Document AI 호출 실패, Gemini 직접 OCR로 fallback:`, error?.message);
      ocrPages = [];
      ocrSymbols = [];
    }
  }

  const prompt = buildPrompt(taxonomyData, 'ko', 1, ocrPages);

  const parts = [
    { text: prompt },
    { text: `Page ${pageNum} of ${totalPages}. Extract all printed text and structure from this exam page image.` },
    { inlineData: { data: imageBase64, mimeType } },
  ];
  const result = await callModelWithFailover({ ai, sessionId, parts, preferredModel });
  // 원문자 심볼을 상위(processPage)로 전달해 answer_area_bbox를 결정적으로 산출하게 한다.
  return { ...result, ocrSymbols };
}
