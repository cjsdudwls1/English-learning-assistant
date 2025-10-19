# Edge Function 배포 가이드

## 방법 1: Supabase Dashboard에서 직접 배포 (가장 쉬움)

### 단계

1. **Supabase Dashboard 접속**
   - https://supabase.com/dashboard 접속
   - 프로젝트 선택 (`vkoegxohahpptdyipmkr`)

2. **Edge Functions 메뉴로 이동**
   - 왼쪽 사이드바에서 `Edge Functions` 클릭

3. **analyze-image Function 찾기**
   - 기존 `analyze-image` 함수가 있다면 클릭
   - 없다면 `Create a new function` 클릭하고 이름을 `analyze-image`로 지정

4. **코드 업데이트**
   - Dashboard의 코드 에디터에 `supabase/functions/analyze-image/index.ts` 파일 내용 전체 복사/붙여넣기
   - 또는 파일을 직접 업로드

5. **환경 변수 설정** (매우 중요!)
   - `Settings` 또는 `Manage secrets` 탭으로 이동
   - `GEMINI_API_KEY` 추가:
     - Name: `GEMINI_API_KEY`
     - Value: `AIzaSyA2w5PqQOn98wHaZy2MtiRkbxeHqrEYbTo`

6. **배포**
   - `Deploy` 버튼 클릭
   - 배포 완료 대기 (약 1-2분)

## 방법 2: Supabase CLI 사용 (Windows)

### CLI 설치 (Windows)

#### 옵션 A: Scoop 사용
```powershell
# Scoop 설치 (설치되어 있지 않다면)
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
Invoke-RestMethod -Uri https://get.scoop.sh | Invoke-Expression

# Supabase CLI 설치
scoop bucket add supabase https://github.com/supabase/scoop-bucket.git
scoop install supabase
```

#### 옵션 B: 수동 다운로드
1. https://github.com/supabase/cli/releases 에서 최신 Windows 릴리스 다운로드
2. `supabase.exe`를 PATH에 추가

### CLI로 배포

```powershell
# 프로젝트 디렉토리로 이동
cd English-learning-assistant

# Supabase 로그인 (처음 한 번만)
supabase login

# 프로젝트 연결 (처음 한 번만)
supabase link --project-ref vkoegxohahpptdyipmkr

# 환경 변수 설정 (처음 한 번만)
supabase secrets set GEMINI_API_KEY=AIzaSyA2w5PqQOn98wHaZy2MtiRkbxeHqrEYbTo

# Edge Function 배포
supabase functions deploy analyze-image
```

## 배포 확인

### 1. Dashboard에서 확인
- Supabase Dashboard → Edge Functions → `analyze-image`
- Status가 "Active"로 표시되어야 함

### 2. 로그 확인
- Edge Functions → `analyze-image` → Logs
- 실제 이미지 업로드 후 로그에서 다음 메시지 확인:
  ```
  Environment variables: { hasGeminiApiKey: true }
  ```

### 3. 테스트
1. 앱에서 이미지 업로드
2. "저장되었습니다! AI 분석이 백그라운드에서 진행 중입니다." 메시지 확인
3. 잠시 후 통계 페이지에서 분석 결과 확인

## 문제 해결

### "GEMINI_API_KEY environment variable is not set"
- 환경 변수가 설정되지 않음
- 해결: Dashboard에서 Secrets 추가 또는 CLI로 `supabase secrets set` 실행

### "Session not found"
- 세션이 생성되지 않았거나 잘못된 sessionId 전달
- 클라이언트 코드 확인

### Edge Function 응답이 없음
- Edge Function이 배포되지 않았거나 코드 오류
- Logs에서 에러 메시지 확인

## Edge Function URL

배포 후 Edge Function URL:
```
https://vkoegxohahpptdyipmkr.supabase.co/functions/v1/analyze-image
```

이 URL은 클라이언트 코드 (`App.tsx`)에서 자동으로 사용됩니다.

## 주의사항

1. **환경 변수 필수**: `GEMINI_API_KEY` 없이는 작동하지 않습니다
2. **재배포**: 코드나 환경 변수 변경 후 반드시 재배포 필요
3. **로그 확인**: 문제 발생 시 Edge Function Logs 먼저 확인
4. **타임아웃**: Edge Function의 기본 타임아웃은 30초입니다. 큰 이미지는 시간이 더 걸릴 수 있습니다.

## 다음 단계

1. ✅ 코드 수정 완료
2. ⏳ Edge Function 배포 (이 가이드 따라 진행)
3. ⏳ 환경 변수 설정
4. ⏳ 테스트


