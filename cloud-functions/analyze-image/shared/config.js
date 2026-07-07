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

/** thinking 토큰 예산. 기본 undefined(=모델 기본 thinking 유지, 현행 동작 보존).
 *  - 실측(2026-05-30, _08 Pass A): thinking이 응답시간의 ~68% 차지.
 *    2.5-flash 24.8s→7.9s, 3.5-flash 25.0s→7.9s (thinkingBudget=0 시 3배↑).
 *    출력 토큰(cand)은 거의 불변(1602↔1562) → 추출량 유지 기대.
 *  - prod 타임아웃(60/90s)의 증폭기: thinking이 baseline을 25s로 높여 부하 큐잉 시
 *    쉽게 타임아웃→폴백(약한 모델)→정확도·latency·비용 동시 악화.
 *  - env THINKING_BUDGET=0 으로 끄되, 정확도 영향은 eval A/B 검증 후 prod 적용.
 *    (gemini-3.x 일부는 0 미허용 가능 → eval에서 에러 관측 필요) */
export const THINKING_BUDGET = (process.env.THINKING_BUDGET !== undefined && process.env.THINKING_BUDGET !== '')
  ? parseInt(process.env.THINKING_BUDGET, 10)
  : undefined;

/** §4 user_answer 교차뷰 확인(consensus). 기본 OFF → prod 30명 동시부하 무영향.
 *  ON(=‘1’) 시: answerArea 기반 비-null user_answer를 fullCrop(다른 뷰)으로 1회 교차확인,
 *  불일치하면 null(기권, 정밀도 우선). 문항당 +1 호출 상한(N×아님).
 */
export const USER_ANSWER_CONSENSUS = process.env.USER_ANSWER_CONSENSUS === '1';

/** correct_answer 추론 소스. 기본 'crop'(행위보존) → prod 무영향.
 *  - 'crop'    : 문항별 fullCrop으로 correct 추론(문항 N개 → N호출).
 *  - 'fullpage': correct 크롭 호출 생략 → full-image fallback이 풀페이지 1회로 채우고,
 *                풀페이지가 놓친 잔여(null)만 문항별 크롭으로 보충.
 *  eval(gold 5장×N=3, docai on) 실측:
 *   · 호출 -25%(10.9→8.2/pg), 토큰 -15%(37.8k→32.2k/pg)
 *   · correct precision 1.0 유지(=confident-wrong 0). crop은 어법지 Q4를 2/3런 오답(precision↓).
 *   · correct recall은 어법지류에서 미세 손실(Pass0 bbox 누락 문항 Q5가 abstain) — 안전한 실패.
 *   · user_answer/text는 crop과 동등(노이즈 범위).
 *  env CORRECT_SOURCE=fullpage 로 점진 적용. */
export const CORRECT_SOURCE = process.env.CORRECT_SOURCE === 'fullpage' ? 'fullpage' : 'crop';

/** 단순 2-스텝 파이프라인 스위치(기본 ON).
 *  ON: Gemini 3.5 Flash 단일 호출로 페이지 전체 통합 추출(문제/지문/보기/손글씨답/정답)
 *      → Gemini 3.x Flash 분류(executePassC). 기존 4-Pass(processPage) 대체.
 *  롤백: env SIMPLE_PIPELINE=0 이면 기존 processPage 경로로 즉시 복귀(코드 보존).
 */
export const SIMPLE_PIPELINE = process.env.SIMPLE_PIPELINE !== '0';

/** Pass 0/B/C에서 사용하는 경량 모델 시퀀스 (GA 우선)
 *  - 실험(2026-05-25): Pass 0 1순위를 3.1-flash-lite로 바꾸면 분할 품질이 회귀.
 *    Q37(36~37 지문공유) 마크를 fallback에서 복구 못 함(2.5는 2/2 복구), Q41/42 병합.
 *    → 2.5-flash 1순위 유지. 자세한 근거: jobs/60bf0b52 실험 로그.
 */
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
// default 60s→90s: 밀집 지문(연속 지문 페이지) 등에서 gemini-2.5-flash가
// 60s 안에 못 끝내고 폴백으로 넘어가던 간헐 실패 완화. 워커 timeout=540s라 여유 충분.
export const API_TIMEOUT_MS = {
  withTools: 120_000,
  gemini3: 90_000,
  default: 90_000,
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
