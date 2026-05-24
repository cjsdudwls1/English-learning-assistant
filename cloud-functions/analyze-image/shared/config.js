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

// Document AI 설정
export const DOCUMENT_AI_PROCESSOR_ID = process.env.DOCUMENT_AI_PROCESSOR_ID;
export const DOCUMENT_AI_LOCATION = process.env.DOCUMENT_AI_LOCATION || 'us';
export const DOCUMENT_AI_ENABLED = Boolean(DOCUMENT_AI_PROCESSOR_ID);

/** 구조 추출(Pass A)용 모델 시퀀스
 *  - 30명 동시 부하 대응: GA 모델 우선 (preview는 250 RPM 한도로 burst 시 fetch failed 발생)
 *  - gemini-flash-latest(별칭)/preview 모델은 마지막 폴백으로만 사용
 */
export const MODEL_SEQUENCE = [
  'gemini-2.5-flash',
  'gemini-3.1-flash-lite',
  'gemini-3-flash-preview',
];

export const MODEL_RETRY_POLICY = {
  'gemini-3.5-flash': { maxRetries: 2, baseDelayMs: 2000 },
  'gemini-2.5-flash': { maxRetries: 2, baseDelayMs: 2000 },
  'gemini-3.1-flash-lite': { maxRetries: 2, baseDelayMs: 2000 },
  'gemini-3-flash-preview': { maxRetries: 1, baseDelayMs: 1500 },
  'gemini-flash-latest': { maxRetries: 1, baseDelayMs: 2000 },
};

export const EXTRACTION_TEMPERATURE = 0.0;

/** Pass 0/B/C에서 사용하는 경량 모델 시퀀스 (GA 우선) */
export const LIGHTWEIGHT_MODEL_SEQUENCE = [
  'gemini-2.5-flash',
  'gemini-3.1-flash-lite',
  'gemini-3-flash-preview',
];

/** 정답 추론(correct_answer) 전용 모델 시퀀스 — 정확도 우선
 *  - 정답 추론은 '문제당 1회' 저빈도 호출 → 최상위 추론 모델을 1순위로 써도 부하 영향 작음
 *  - gemini-3.5-flash(GA, 2026-05): 최신·최강 Flash, near-Pro 추론력
 *  - 폴백 3.1-flash-lite(GA): 공식 벤치 기준 2.5-flash 추론 상회(GPQA 86.9% vs 79%)
 *  - 폴백 2.5-flash(GA): 최종 안전망
 *  - preview 모델 제외: Vertex DSQ 공유풀 제약으로 burst 시 429 위험(실측 이력)
 */
export const ANSWER_MODEL_SEQUENCE = [
  'gemini-3.5-flash',
  'gemini-3.1-flash-lite',
  'gemini-2.5-flash',
];

/** 사용자 답안(user_answer) 필기 마크 인식 전용 — 정밀 '지각' 우선
 *  - 실측 2건에서 구형 gemini-2.5-flash가 마크를 인접 번호로 confident-wrong:
 *    · Q28(학생 마크=①, 좁은 선택지 크롭) → "②"  · Q40(동그라미=③, 전체이미지) → "①"
 *    둘 다 temperature=0.0에서도 3회 일관 오답 → 지각 작업에서 신뢰 불가, 시퀀스에서 제외.
 *    '자신있는 오답'은 채점 보조 도구에서 null보다 해롭다.
 *  - gemini-3.5-flash(신중·near-Pro 지각, 애매하면 정직하게 null) 1순위, GA 폴백
 *    3.1-flash-lite. 동일 입력에서 둘 다 2.5-flash보다 정확. user_answer도 문제당 1회
 *    저빈도 호출이라 최상위 모델 1순위 부하 영향 작음.
 *  - preview 모델 제외: burst 시 429 위험(실측 이력) → GA 모델만.
 */
export const USER_ANSWER_MODEL_SEQUENCE = [
  'gemini-3.5-flash',
  'gemini-3.1-flash-lite',
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
