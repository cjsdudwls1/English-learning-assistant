# Edge Functions 상세

## 개요

Supabase Edge Functions는 Deno 런타임에서 실행된다. 모든 AI 호출은 서버 사이드에서만 처리된다.

## 함수 목록

| 함수명 | 역할 | 입력 | 출력 |
|--------|------|------|------|
| `generate-similar-problems` | 원본 문제와 유사한 새 문제 생성 | 원본 문제 데이터 | 생성된 문제 (Realtime 스트리밍) |
| `generate-example` | 예시 문장 생성 | 단어/문법 항목 | 예시 문장 |
| `generate-report` | 학습 리포트 생성 | 세션/문제 데이터 | 분석 리포트 |
| `generate-problems-by-type` | 유형별 문제 생성 | 문제 유형 + 조건 | 생성된 문제 |
| `reclassify-problems` | 문제 재분류 | 문제 데이터 | 업데이트된 분류 |
| `test-bbox` | 바운딩 박스 테스트 | 이미지 + 좌표 | 테스트 결과 |

## 공유 모듈 (`_shared/`)

| 파일 | 역할 |
|------|------|
| `aiClientFactory.ts` | AI 클라이언트 생성 (Vertex AI 우선, Gemini API Key 폴백) |
| `aiClient.ts` | AI 클라이언트 인터페이스 정의 |
| `vertexClient.ts` | Vertex AI REST API 클라이언트 |
| `vertexAuth.ts` | Vertex AI 서비스 계정 인증 (JWT → Access Token) |
| `models.ts` | 모델 시퀀스 + 재시도 정책 정의 |
| `prompts.ts` | 모든 AI 프롬프트 템플릿 |
| `validation.ts` | AI 응답 검증 로직 |
| `errors.ts` | 에러 타입 정의 + 처리 |
| `taxonomy.ts` | 문제 분류 체계 (taxonomy) 매핑 |
| `supabaseClient.ts` | Supabase 서비스 역할 클라이언트 (싱글턴) |
| `usageLogger.ts` | 토큰 사용량 로깅 |
| `env.ts` | 환경변수 읽기 유틸리티 |
| `http.ts` | HTTP 응답 헬퍼 |

## 환경변수

Edge Functions에서 사용하는 환경변수 (Supabase Dashboard에서 설정):

| 변수명 | 용도 |
|--------|------|
| `VERTEX_PROJECT_ID` | Google Cloud 프로젝트 ID |
| `VERTEX_LOCATION` | Vertex AI 리전 (예: us-central1) |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | 서비스 계정 JSON 키 |
| `GEMINI_API_KEY` | Gemini API 키 (Vertex AI 폴백용) |
| `SUPABASE_URL` | Supabase 프로젝트 URL |
| `SUPABASE_SERVICE_ROLE_KEY` | 서비스 역할 키 (RLS 바이패스) |

## 제약 사항

- Deno 런타임 기반: Node.js 패키지 직접 사용 불가 (npm: 접두어 또는 esm.sh 필요)
- 실행 시간 제한: 기본 60초 (Wall-clock time)
- 메모리 제한: 256MB
- 동기 대기 루프 (`while + sleep`) 사용 금지 → async 패턴 사용
