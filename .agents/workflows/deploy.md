---
description: Supabase Edge Function 및 Netlify 프론트엔드 배포 절차
---

# 배포 절차

## 1. Supabase Edge Function 배포

### 프로젝트 정보
- **Project Ref**: `vkoegxohahpptdyipmkr`
- **Supabase URL**: `https://vkoegxohahpptdyipmkr.supabase.co`
- **Edge Function 소스 경로**: `supabase/functions/`

### 배포 명령어

```bash
# analyze-image 함수 배포 (JWT 검증 비활성화 - 함수 내부에서 자체 인증 처리)
npx supabase functions deploy analyze-image --no-verify-jwt --project-ref vkoegxohahpptdyipmkr
```

// turbo

### 주의사항
- `--no-verify-jwt` 플래그 필수. 이 함수는 내부에서 직접 JWT를 검증하므로 게이트웨이 검증을 꺼야 함
- `--project-ref`를 반드시 `vkoegxohahpptdyipmkr`로 지정할 것. 다른 프로젝트 ref 사용 시 403 Forbidden 발생
- Docker 미실행 경고(`WARNING: Docker is not running`)는 무시해도 됨. 원격 배포에는 영향 없음
- 작업 디렉토리는 프로젝트 루트(`English-learning-assistant/`)에서 실행

### 다른 Edge Function 배포 시

```bash
# generate-problems-by-type 함수 배포 예시
npx supabase functions deploy generate-problems-by-type --no-verify-jwt --project-ref vkoegxohahpptdyipmkr
```

### Edge Function 목록 확인

```bash
npx supabase functions list --project-ref vkoegxohahpptdyipmkr
```

---

## 2. 프론트엔드 (Netlify) 배포

### 배포 방식: Git Push 자동 배포
- Netlify에 GitHub 리포지토리가 연결되어 있음
- `main` 브랜치에 push하면 자동으로 빌드 및 배포 실행
- 빌드 설정은 `netlify.toml`에 정의됨

### 배포 절차

```bash
# 1. 프론트엔드 빌드 확인 (선택사항 - Netlify가 자동으로 빌드하지만 사전 검증용)
cd English-learning-assistant
npm run build

# 2. 변경사항 커밋 및 푸시
cd ..
git add -A
git commit -m "feat: 변경 내용 요약"
git push origin main
```

// turbo

### netlify.toml 빌드 설정
```toml
[build]
  command = "cd English-learning-assistant && npm install && npm run build"
  publish = "English-learning-assistant/dist"

[build.environment]
  NODE_VERSION = "18"
```

### 주의사항
- Netlify CLI(`npx netlify deploy`)는 프로젝트 링크가 안 되어 있어서 대화형 프롬프트가 뜸 → Git push 방식 사용
- 빌드 결과 확인은 Netlify 대시보드에서

---

## 3. 전체 배포 (Edge Function + 프론트엔드)

두 가지를 모두 배포해야 할 때의 순서:

```bash
# 1단계: Edge Function 배포 (작업 디렉토리: 프로젝트 루트)
npx supabase functions deploy analyze-image --no-verify-jwt --project-ref vkoegxohahpptdyipmkr

# 2단계: 프론트엔드 빌드 검증
cd English-learning-assistant
npm run build
cd ..

# 3단계: Git push (Netlify 자동 배포 트리거)
git add -A
git commit -m "feat: 변경 내용 요약"
git push origin main
```
