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

### 클라이언트 배포 (Netlify)
자세한 내용은 [DEPLOY.md](./DEPLOY.md)를 참고하세요.

### Edge Function 배포 (Supabase)
백그라운드 이미지 분석을 위한 Edge Function 배포:
1. [SUPABASE_ENV_SETUP.md](./SUPABASE_ENV_SETUP.md) - 환경 변수 설정
2. [EDGE_FUNCTION_DEPLOY.md](./EDGE_FUNCTION_DEPLOY.md) - Edge Function 배포

**중요**: Edge Function 배포 없이는 이미지 분석이 작동하지 않습니다!

## 주요 변경사항 (2025-10-13)

### 백그라운드 처리 개선
- ✅ 클라이언트에서 이미지 업로드 및 세션 생성을 먼저 완료
- ✅ Edge Function이 독립적으로 분석 수행
- ✅ 사용자가 페이지를 닫아도 분석이 계속 진행됨
- ✅ 에러 처리 및 로깅 개선

### 아키텍처
```
사용자 → 이미지 업로드 → Storage 저장
       → 세션 생성 → DB 저장
       → Edge Function 호출 (비동기)
       → 즉시 통계 페이지로 이동

Edge Function (백그라운드):
       → Gemini AI 분석
       → 결과를 DB에 저장
```

## 라이선스
MIT

