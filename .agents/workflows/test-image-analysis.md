---
description: 이미지 분석 테스트 - 로컬 이미지를 API로 직접 업로드하여 분석 결과를 확인합니다
---

# 이미지 분석 E2E 테스트

로컬 이미지 파일을 Supabase Edge Function에 직접 전송하여 분석 결과를 확인하는 워크플로우입니다.
브라우저 없이 터미널에서 완전 자동으로 실행됩니다.

## 사전 요구사항

- Node.js 설치
- 테스트 이미지 파일 경로
- CWD: `English-learning-assistant/` (Git 루트)
- Edge Function이 `--no-verify-jwt`로 배포되어 있어야 함 (publishable key 호환)

## 실행 방법

### 1. 테스트 스크립트 실행

// turbo
```
node .agents/scripts/test-analyze-image.mjs "<이미지_파일_경로>"
```

**예시:**
```
node English-learning-assistant/.agents/scripts/test-analyze-image.mjs "C:\cheon\cheon_wokespace\edu\test_image\이어지는 지문\KakaoTalk_20251202_101043325_07.jpg"
```

여러 이미지를 동시에 테스트하려면 공백으로 구분:
```
node English-learning-assistant/.agents/scripts/test-analyze-image.mjs "이미지1.jpg" "이미지2.jpg"
```

### 2. 스크립트가 자동으로 수행하는 작업

1. Supabase 로그인 (이메일/비밀번호)
2. 이미지를 base64로 변환 (1200px 리사이징 + JPEG 80% 압축)
3. `analyze-image` Edge Function 호출
4. 세션 생성 확인
5. 3초 간격으로 세션 상태 폴링 (최대 5분)
6. 분석 완료 시 결과 요약 출력:
   - 세션 상태 (completed/failed)
   - 사용된 모델
   - 추출된 문제 수
   - 각 문제의 번호, 분류, 정답, 사용자 답안
   - 에러 발생 시 에러 상세

### 3. 결과 확인

스크립트 출력에서 다음을 확인:
- `[SUCCESS]`: 분석 성공, 문제 목록 출력됨
- `[FAILED]`: 분석 실패, 에러 원인 출력됨
- `[TIMEOUT]`: 5분 초과, Edge Function 로그 확인 필요

### 4. Edge Function 로그 확인 (선택)

분석 실패 시 Supabase 대시보드에서 로그를 확인합니다:
```
npx supabase functions logs analyze-image --project-ref vkoegxohahpptdyipmkr --scroll
```

## 환경 변수

스크립트는 `English-learning-assistant/English-learning-assistant/.env`에서 자동으로 읽습니다:
- `VITE_SUPABASE_URL`: Supabase 프로젝트 URL
- `VITE_SUPABASE_ANON_KEY`: Supabase anon key

인증 정보는 스크립트 상단에 하드코딩되어 있습니다 (테스트 전용).

## 문제 해결

| 증상 | 원인 | 해결 |
|------|------|------|
| `Auth failed` | 잘못된 이메일/비밀번호 | 스크립트의 `TEST_EMAIL`/`TEST_PASSWORD` 확인 |
| `HTTP 403` | anon key 만료 | `.env` 파일의 `VITE_SUPABASE_ANON_KEY` 갱신 |
| `TIMEOUT` | Edge Function 과부하 | 잠시 후 재시도 또는 로그 확인 |
| `0 problems extracted` | 이미지에 문제가 없음 | 영어 시험 이미지인지 확인 |
