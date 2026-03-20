/**
 * 설정/상수 모듈
 * - Vertex AI 프로젝트/위치 설정
 * - AI 모델 시퀀스 및 재시도 정책
 * - 추출 온도 설정
 * - 타임아웃 설정
 */

// Vertex AI 설정 (서비스계정 JSON 키 인증)
export const VERTEX_PROJECT_ID = process.env.VERTEX_PROJECT_ID || 'gen-lang-client-0516945872';
export const VERTEX_LOCATION = process.env.VERTEX_LOCATION || 'global';

/** 구조 추출(Pass A)용 모델 시퀀스 */
export const MODEL_SEQUENCE = [
  'gemini-3-flash-preview',
  'gemini-3.1-flash-lite-preview',
  'gemini-2.5-flash',
  'gemini-2.5-pro',
];

export const MODEL_RETRY_POLICY = {
  'gemini-3-flash-preview': { maxRetries: 1, baseDelayMs: 3000 },
  'gemini-3.1-flash-lite-preview': { maxRetries: 1, baseDelayMs: 3000 },
  'gemini-2.5-flash': { maxRetries: 2, baseDelayMs: 3000 },
  'gemini-2.5-pro': { maxRetries: 1, baseDelayMs: 4000 },
};

export const EXTRACTION_TEMPERATURE = 0.0;

/** Pass 0/B/C에서 사용하는 경량 모델 시퀀스 */
export const LIGHTWEIGHT_MODEL_SEQUENCE = [
  'gemini-3-flash-preview',
  'gemini-3.1-flash-lite-preview',
  'gemini-2.5-flash',
];

// API 호출 타임아웃 (밀리초)
export const API_TIMEOUT_MS = {
  withTools: 120_000,
  gemini3: 90_000,
  default: 60_000,
};

/** 분류 JSON 스키마 (Pass C responseJsonSchema) */
export const CLASSIFICATION_SCHEMA = {
  type: 'OBJECT',
  properties: {
    classifications: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          problem_number: { type: 'STRING' },
          classification: {
            type: 'OBJECT',
            properties: {
              depth1: { type: 'STRING' },
              depth2: { type: 'STRING' },
              depth3: { type: 'STRING' },
              depth4: { type: 'STRING' },
            },
          },
          metadata: {
            type: 'OBJECT',
            properties: {
              difficulty: { type: 'STRING' },
              word_difficulty: { type: 'NUMBER' },
              analysis: { type: 'STRING' },
            },
          },
        },
        required: ['problem_number', 'classification', 'metadata'],
      },
    },
  },
  required: ['classifications'],
};
