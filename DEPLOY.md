# Netlify 배포 가이드

## 1. Netlify 계정 준비
1. [Netlify](https://netlify.com) 접속 및 로그인 (GitHub 계정으로 가능)

## 2. 프로젝트 배포

### 옵션 A: GitHub 연동 (권장)
1. GitHub에 리포지토리 생성 및 푸시
2. Netlify 대시보드에서 "Add new site" → "Import an existing project"
3. GitHub 리포지토리 선택
4. 빌드 설정은 `netlify.toml`에서 자동으로 인식됨
5. "Deploy site" 클릭

### 옵션 B: CLI 배포
```bash
# Netlify CLI 설치
npm install -g netlify-cli

# 프로젝트 디렉토리에서
cd English-learning-assistant

# Netlify 로그인
netlify login

# 배포
netlify deploy --prod
```

## 3. 환경변수 설정 (중요!)

Netlify 대시보드에서:
1. Site settings → Environment variables
2. 다음 환경변수들을 추가:

```
VITE_GEMINI_API_KEY = [여기에 Gemini API 키 입력]
VITE_SUPABASE_URL = [여기에 Supabase URL 입력]
VITE_SUPABASE_ANON_KEY = [여기에 Supabase Anon Key 입력]
```

### Gemini API 키 받기
1. [Google AI Studio](https://aistudio.google.com/app/apikey) 접속
2. "Create API Key" 클릭
3. 생성된 키 복사

### Supabase 키 받기
1. [Supabase Dashboard](https://supabase.com/dashboard) 접속
2. 프로젝트 선택 → Settings → API
3. "Project URL" 및 "anon public" 키 복사

## 4. 재배포
환경변수 설정 후 반드시 재배포 필요:
- Deploys → Trigger deploy → "Deploy site"

## 5. 모바일 테스트
배포 후 제공되는 URL (예: https://your-site-name.netlify.app)로 모바일에서 접속

## 6. 커스텀 도메인 (선택사항)
Site settings → Domain management에서 커스텀 도메인 추가 가능

