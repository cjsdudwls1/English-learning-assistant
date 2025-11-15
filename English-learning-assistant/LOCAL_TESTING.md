# 로컬 테스트 가이드

로컬 개발 환경에서 앱을 테스트하는 방법을 안내합니다.

## 📋 사전 준비

### 1. Node.js 설치 확인
```bash
npm --version
```
- Node.js 18 이상 권장
- npm 10.9.2 이상 권장

### 2. 프로젝트 폴더로 이동
```bash
cd English-learning-assistant
```

## 🚀 로컬 테스트 실행 방법

### 1단계: 의존성 설치 (처음 한 번만)

```bash
npm install
```

**참고**: `node_modules` 폴더가 이미 있으면 생략 가능합니다.

### 2단계: 환경변수 확인

`.env` 파일이 `English-learning-assistant` 폴더에 있는지 확인하세요.

필수 환경변수:
```env
VITE_SUPABASE_URL=your_supabase_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
```

**참고**: 
- `VITE_GEMINI_API_KEY`는 클라이언트에서 사용하지 않습니다 (Edge Function에서만 사용)
- `.env` 파일은 `.gitignore`에 포함되어 있어 Git에 커밋되지 않습니다

### 3단계: 개발 서버 실행

```bash
npm run dev
```

### 4단계: 브라우저에서 접속

개발 서버가 실행되면 다음 메시지가 표시됩니다:
```
  VITE v5.4.20  ready in XXX ms

  ➜  Local:   http://localhost:3000/
  ➜  Network: http://0.0.0.0:3000/
```

브라우저에서 `http://localhost:3000` 접속

## 🎯 로컬 테스트 체크리스트

### 기본 기능 테스트
- [ ] 로그인/로그아웃 작동
- [ ] 이미지 업로드 작동
- [ ] 통계 페이지 표시
- [ ] 차트 드릴다운 기능 작동
- [ ] 다크/라이트 모드 전환 작동

### 차트 테스트
- [ ] 도넛차트 중앙 숫자가 정확히 표시되는지 확인
- [ ] 도넛차트 클릭 시 드릴다운 작동
- [ ] 막대그래프 클릭 시 드릴다운 작동
- [ ] 뒤로가기 버튼 작동
- [ ] 모바일 화면에서도 정상 작동하는지 확인

### 이미지 업로드 테스트
- [ ] `test_image/` 폴더의 이미지로 테스트
- [ ] 업로드 후 `/recent` 페이지로 이동
- [ ] 분석 완료 후 통계에 반영되는지 확인

## 🔧 문제 해결

### 포트가 이미 사용 중인 경우
```bash
# vite.config.ts에서 포트 변경
server: {
  port: 3001,  // 다른 포트로 변경
  host: '0.0.0.0',
}
```

### 환경변수가 로드되지 않는 경우
1. `.env` 파일이 `English-learning-assistant` 폴더에 있는지 확인
2. 파일 이름이 정확히 `.env`인지 확인 (`.env.local`, `.env.development` 아님)
3. 개발 서버를 재시작 (Ctrl+C 후 `npm run dev`)

### 모듈을 찾을 수 없는 경우
```bash
# node_modules 삭제 후 재설치
rm -rf node_modules
npm install
```

### Supabase 연결 오류
1. `.env` 파일의 `VITE_SUPABASE_URL`과 `VITE_SUPABASE_ANON_KEY` 확인
2. Supabase 대시보드에서 프로젝트 설정 확인
3. 브라우저 콘솔에서 에러 메시지 확인

## 📱 모바일 테스트

### 같은 네트워크에서 모바일 접속
1. 개발 서버 실행 (`npm run dev`)
2. 컴퓨터의 로컬 IP 주소 확인:
   ```bash
   # Windows
   ipconfig
   # IPv4 주소 확인 (예: 192.168.0.100)
   ```
3. 모바일 기기에서 `http://192.168.0.100:3000` 접속

### 주의사항
- 컴퓨터와 모바일이 같은 Wi-Fi 네트워크에 연결되어 있어야 합니다
- 방화벽에서 포트 3000이 열려 있어야 합니다
- `vite.config.ts`에서 `host: '0.0.0.0'` 설정이 필요합니다

## 🔄 핫 리로드 (Hot Reload)

개발 서버 실행 중:
- 코드 변경 시 자동으로 브라우저 새로고침
- 상태 유지 (로그인 상태 등)
- 빠른 피드백 루프

## 🛑 개발 서버 종료

터미널에서 `Ctrl + C`를 누르면 개발 서버가 종료됩니다.

## 📝 참고사항

### 프로덕션 빌드
```bash
# 프로덕션 빌드 생성
npm run build

# 빌드된 파일 미리보기
npm run preview
```

### Edge Function 테스트
로컬에서 Edge Function을 테스트하려면:
1. Supabase CLI 설치 필요
2. `supabase functions serve` 명령어 사용
3. 자세한 내용은 [EDGE_FUNCTION_DEPLOY.md](./EDGE_FUNCTION_DEPLOY.md) 참고

### 데이터베이스 테스트
- 로컬에서 Supabase 데이터베이스에 직접 연결됩니다
- 실제 데이터가 사용되므로 주의하세요
- 테스트 데이터로 작업할 때는 별도 테스트 계정 사용 권장

## 🎨 개발 팁

### 브라우저 개발자 도구
- **F12**: 개발자 도구 열기
- **Ctrl+Shift+I**: 개발자 도구 열기
- **Console 탭**: 에러 및 로그 확인
- **Network 탭**: API 요청 확인
- **React DevTools**: React 컴포넌트 상태 확인

### 코드 변경 확인
- 파일 저장 시 자동 새로고침
- TypeScript 에러는 터미널에 표시
- 브라우저 콘솔에 런타임 에러 표시

### 성능 확인
- **Lighthouse**: 성능 점수 확인
- **Network 탭**: 로딩 시간 확인
- **Performance 탭**: 렌더링 성능 확인

## 🚨 주의사항

1. **환경변수 보안**: `.env` 파일에 실제 API 키가 포함되어 있습니다. 절대 Git에 커밋하지 마세요.

2. **데이터 격리**: 로컬에서 테스트할 때도 다른 사용자의 데이터에 접근하지 않도록 주의하세요.

3. **Edge Function**: 로컬 클라이언트는 실제 Supabase Edge Function을 호출합니다. Edge Function이 배포되어 있어야 이미지 분석이 작동합니다.

4. **포트 충돌**: 다른 애플리케이션이 포트 3000을 사용 중이면 충돌이 발생할 수 있습니다.

## ✅ 성공 확인

개발 서버가 정상적으로 실행되면:
- 브라우저에서 `http://localhost:3000` 접속
- 로그인 페이지 또는 메인 페이지가 표시됨
- 콘솔에 에러가 없음
- 모든 기능이 정상 작동

이제 로컬에서 개발하고 테스트할 수 있습니다! 🎉

