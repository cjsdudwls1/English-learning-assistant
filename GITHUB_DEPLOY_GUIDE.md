# GitHub 연동 Netlify 배포 가이드

## 📋 사전 준비
- GitHub 계정
- Netlify 계정 (GitHub으로 가입 가능)
- Git 설치 확인: `git --version`

## 🚀 배포 단계

### 1단계: GitHub 리포지토리 생성

1. [GitHub](https://github.com) 접속 및 로그인
2. 우측 상단 `+` 버튼 → `New repository` 클릭
3. 리포지토리 정보 입력:
   - **Repository name**: `english-learning-assistant` (또는 원하는 이름)
   - **Description**: AI 영어 문제 분석기
   - **Public** 또는 **Private** 선택
   - ⚠️ "Add a README file" 체크 해제 (이미 있음)
   - ⚠️ ".gitignore" 및 "license" 추가하지 않음 (이미 있음)
4. `Create repository` 클릭

### 2단계: Git 저장소 초기화 및 푸시

PowerShell이나 터미널에서 프로젝트 폴더로 이동 후:

```bash
# 프로젝트 폴더로 이동
cd English-learning-assistant

# Git 초기화 (이미 되어있으면 스킵)
git init

# 모든 파일 추가 (.gitignore가 자동으로 제외)
git add .

# 첫 커밋
git commit -m "Initial commit: AI 영어 문제 분석기"

# GitHub 리포지토리 연결 (YOUR-USERNAME을 본인 GitHub 아이디로 변경)
git remote add origin https://github.com/YOUR-USERNAME/english-learning-assistant.git

# main 브랜치로 변경 (GitHub 기본 브랜치)
git branch -M main

# GitHub에 푸시
git push -u origin main
```

⚠️ **주의**: `YOUR-USERNAME`을 본인의 GitHub 사용자명으로 변경하세요!

### 3단계: Netlify에서 GitHub 연동

1. [Netlify](https://netlify.com) 접속 및 로그인
   - GitHub 계정으로 로그인하면 연동이 더 쉬움

2. 대시보드에서 `Add new site` 클릭

3. `Import an existing project` 선택

4. `Deploy with GitHub` 클릭
   - 권한 요청 시 승인

5. 리포지토리 선택
   - 방금 생성한 `english-learning-assistant` 선택

6. 빌드 설정 확인
   - **Build command**: `npm run build` (자동 인식됨)
   - **Publish directory**: `dist` (자동 인식됨)
   - **Base directory**: 비워둠 (또는 `English-learning-assistant`)
   
7. `Deploy site` 클릭

### 4단계: 환경변수 설정 (필수!)

🔴 **매우 중요**: 환경변수를 설정하지 않으면 앱이 작동하지 않습니다!

1. Netlify 대시보드에서 배포된 사이트 선택

2. `Site settings` → `Environment variables` 클릭

3. `Add a variable` 클릭하여 다음 3개 변수 추가:

#### 변수 1: Gemini API 키
- **Key**: `VITE_GEMINI_API_KEY`
- **Value**: [Google AI Studio](https://aistudio.google.com/app/apikey)에서 발급받은 키
- **Scopes**: All 또는 Production 선택

#### 변수 2: Supabase URL
- **Key**: `VITE_SUPABASE_URL`
- **Value**: Supabase 프로젝트의 Project URL
- **Scopes**: All 또는 Production 선택

#### 변수 3: Supabase Anon Key
- **Key**: `VITE_SUPABASE_ANON_KEY`
- **Value**: Supabase 프로젝트의 anon public 키
- **Scopes**: All 또는 Production 선택

4. `Save` 클릭

### 5단계: 재배포

환경변수를 추가한 후 반드시 재배포해야 합니다:

1. `Deploys` 탭으로 이동
2. `Trigger deploy` → `Deploy site` 클릭
3. 배포 완료 대기 (1-2분)

### 6단계: 배포 확인

1. 배포가 완료되면 Netlify가 제공하는 URL 확인
   - 예: `https://your-site-name.netlify.app`

2. 링크를 클릭하거나 복사하여 브라우저에서 열기

3. 모바일에서도 동일한 URL로 접속 가능
   - PWA이므로 "홈 화면에 추가" 가능

## 📱 모바일 테스트

배포된 URL을 모바일 브라우저에서 열고:
- **Android Chrome**: 메뉴 → "홈 화면에 추가"
- **iOS Safari**: 공유 → "홈 화면에 추가"

## 🔄 코드 업데이트 시

코드를 수정한 후:

```bash
git add .
git commit -m "업데이트 내용 설명"
git push
```

푸시하면 Netlify가 자동으로 재배포합니다!

## 🎨 커스텀 도메인 (선택)

Netlify 대시보드:
- `Site settings` → `Domain management`
- `Add custom domain` 클릭하여 본인의 도메인 연결 가능

## ⚠️ 문제 해결

### 빌드 실패 시
1. Netlify 대시보드 → `Deploys` → 실패한 배포 클릭
2. 로그 확인
3. 주로 환경변수 누락이 원인

### 환경변수 확인
- `Site settings` → `Environment variables`에서 3개 모두 있는지 확인

### 앱이 작동하지 않을 때
- 브라우저 콘솔(F12) 확인
- API 키가 올바른지 확인
- Supabase 프로젝트가 활성화되어 있는지 확인

## 📞 도움이 필요하면

- Netlify 지원: https://answers.netlify.com
- Netlify 문서: https://docs.netlify.com

