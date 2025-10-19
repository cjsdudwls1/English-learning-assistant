# Supabase Edge Function 환경 변수 설정 가이드

## 중요: Edge Function이 작동하려면 환경 변수 설정이 필수입니다!

Edge Function (`analyze-image`)이 Gemini API를 사용하여 이미지를 분석하려면 `GEMINI_API_KEY`가 Supabase에 설정되어야 합니다.

## 방법 1: Supabase Dashboard에서 설정 (권장)

### 단계별 안내

1. **Supabase Dashboard 접속**
   - https://supabase.com/dashboard 접속
   - 프로젝트 선택 (`vkoegxohahpptdyipmkr`)

2. **Edge Functions 메뉴로 이동**
   - 왼쪽 사이드바에서 `Edge Functions` 클릭

3. **환경 변수 설정**
   - 상단 탭에서 `Settings` 또는 `Manage secrets` 클릭
   - `Add new secret` 버튼 클릭

4. **GEMINI_API_KEY 추가**
   - **Name**: `GEMINI_API_KEY`
   - **Value**: `AIzaSyA2w5PqQOn98wHaZy2MtiRkbxeHqrEYbTo`
   - `Save` 클릭

5. **Edge Function 재배포**
   - Edge Function을 다시 배포해야 환경 변수가 적용됩니다
   - 아래 배포 명령어 참조

## 방법 2: Supabase CLI로 설정 (선택사항)

Supabase CLI가 설치되어 있다면:

```bash
# 프로젝트 디렉토리로 이동
cd English-learning-assistant

# Supabase 로그인
supabase login

# 프로젝트 링크 (처음 한 번만)
supabase link --project-ref vkoegxohahpptdyipmkr

# Secret 설정
supabase secrets set GEMINI_API_KEY=AIzaSyA2w5PqQOn98wHaZy2MtiRkbxeHqrEYbTo
```

## Edge Function 배포

환경 변수 설정 후 Edge Function을 배포해야 합니다:

```bash
cd English-learning-assistant

# analyze-image Function 배포
supabase functions deploy analyze-image
```

## 확인 방법

1. Supabase Dashboard → Edge Functions → `analyze-image` → Logs
2. 테스트 이미지 업로드 후 로그 확인:
   - "Environment variables: { hasGeminiApiKey: true }" 메시지가 표시되어야 함

## 환경 변수 목록

Edge Function에서 사용하는 환경 변수:

| 변수명 | 설명 | 자동 제공 여부 |
|--------|------|----------------|
| `SUPABASE_URL` | Supabase 프로젝트 URL | ✅ 자동 |
| `SUPABASE_SERVICE_ROLE_KEY` | Service Role 키 | ✅ 자동 |
| `GEMINI_API_KEY` | Google Gemini API 키 | ❌ 수동 설정 필요 |

## 문제 해결

### "GEMINI_API_KEY environment variable is not set" 에러

- 환경 변수가 설정되지 않았거나, Edge Function이 재배포되지 않음
- 해결: 위 단계대로 환경 변수 설정 후 Edge Function 재배포

### "Missing Supabase environment variables" 에러

- 일반적으로 자동 제공되는 변수가 없음 (드문 경우)
- Supabase 지원팀에 문의

## 추가 정보

- Edge Function은 Deno 환경에서 실행됩니다
- 환경 변수는 암호화되어 저장됩니다
- 배포 후 약 1-2분 정도 적용 시간이 필요할 수 있습니다


