# AI 영어 문제 분석기

React + Vite + PWA 기반의 영어 학습 지원 애플리케이션입니다.

## 기능
- 📸 영어 문제 이미지 분석 (OCR + AI)
- 🤖 Gemini AI 기반 문제 분류 및 분석
- 📊 학습 통계 및 리뷰 기능
- 📱 PWA 지원 (모바일 앱처럼 사용 가능)
- ☁️ Supabase 기반 데이터 관리

## 기술 스택
- React 19
- TypeScript
- Vite
- Supabase
- Google Gemini AI
- Capacitor (Android/iOS)

## 개발 환경 설정

### 1. 패키지 설치
```bash
npm install
```

### 2. 환경변수 설정
`.env` 파일을 생성하고 다음 변수들을 설정하세요:

```env
VITE_GEMINI_API_KEY=your_gemini_api_key
VITE_SUPABASE_URL=your_supabase_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
```

### 3. 개발 서버 실행
```bash
npm run dev
```

## 배포

### Netlify 배포
자세한 내용은 [DEPLOY.md](./DEPLOY.md)를 참고하세요.

## 라이선스
MIT

