# CLAUDE.md — React 프론트엔드

이 디렉토리는 React + TypeScript + Vite 기반 프론트엔드 프로젝트이다.

## 개발 명령어

```bash
npm run dev        # 개발 서버 (localhost:3001)
npm run build      # 프로덕션 빌드
npm run preview    # 빌드 결과 미리보기
npx tsc --noEmit   # 타입 체크
```

## 레이어 구조

- **Pages** (`src/pages/`): 라우트별 페이지 (8개)
- **Components** (`src/components/`): 재사용 UI 컴포넌트 (30개+)
- **Services** (`src/services/db/`): Supabase DB 접근 레이어 — 테이블별 모듈 (sessions, problems, labels, taxonomy 등)
- **Hooks** (`src/hooks/`): 커스텀 훅 — `useProblemGeneration`, `useStatsData` 등
- **Contexts** (`src/contexts/`): ThemeContext (다크모드), LanguageContext (ko/en)
- **Utils** (`src/utils/`): translations, sessionStats, taxonomyMapping, canvasCropper
- **Types** (`src/types.ts`): 핵심 타입 정의 (ProblemItem, AnalysisResult 등)

## 프론트엔드 규칙

- 경로 alias: `@/*` → `src/*` (vite.config.ts + tsconfig.json)
- Supabase 클라이언트: 싱글턴 (`src/services/supabaseClient.ts`)
- 다크모드: Tailwind `dark:` 클래스 + `document.documentElement.classList`
- 다국어: `src/utils/translations.ts`의 ko/en 문자열만 사용
- 이미지 처리: `canvasCropper.ts`에서 WASM mutex로 병렬 크롭 시 스레드 안전성 보장
- 문제 생성: Supabase Realtime 구독으로 스트리밍 수신
- API 키는 절대 프론트엔드에 노출하지 않음 — Edge Function에서만 사용

## 배포

Netlify (`netlify.toml` 설정) → https://english-learningassistant.netlify.app/
