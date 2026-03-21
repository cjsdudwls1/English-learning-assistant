# CLAUDE.md — Supabase Edge Functions

이 디렉토리는 Supabase Edge Functions (Deno 런타임) 프로젝트이다.

## 함수 목록

| 함수 | 역할 |
|------|------|
| `generate-similar-problems` | 원본 문제 기반 유사 문제 생성 |
| `generate-example` | 예시 문장 생성 |
| `generate-report` | 학습 리포트 생성 |
| `generate-problems-by-type` | 유형별 문제 생성 |
| `reclassify-problems` | 문제 재분류 |
| `test-bbox` | 바운딩 박스 테스트 |

## 공유 모듈 (`_shared/`)

- `aiClientFactory.ts` → Vertex AI 우선, Gemini API Key 폴백
- `aiClient.ts` → AI 클라이언트 인터페이스
- `vertexClient.ts` / `vertexAuth.ts` → Vertex AI REST API + 인증
- `models.ts` → 모델 시퀀스 + 재시도 정책
- `prompts.ts` → AI 프롬프트 템플릿
- `validation.ts` → AI 응답 검증
- `taxonomy.ts` → 문제 분류 체계 매핑

## 규칙

- Deno 런타임: Node.js 패키지 직접 사용 불가 (npm: 접두어 또는 esm.sh 필요)
- 실행 시간 제한: 기본 60초
- 동기 대기 루프 (`while + sleep`) 사용 금지 → async 패턴 사용
- API 키는 Supabase Dashboard의 환경변수로 관리
- 새 함수 추가 시 `_shared/`의 팩토리 패턴을 반드시 재사용

## 상세 문서

- 전체 상세: `docs/edge-functions.md`
- AI 모델 시퀀스: `_shared/models.ts`
- 프롬프트 템플릿: `_shared/prompts.ts`

## 배포

```bash
# 프로젝트 루트에서 실행
npx supabase functions deploy <함수명>
```

자세한 배포 절차: `.agents/workflows/배포.md`
