---
description: AI 에디터가 가장 먼저 읽는 절대 지침서 (메인 룰)
---

# AI Fashion Shop - AI 에디터 메인 룰

기술 스택: Next.js 16 (App Router), React 19, TypeScript, Zustand, Supabase, Cloudinary, Google Veo 3.1 Fast, Zod.

---

## 절대 규칙 (Core Directives)

1. **완전한 삭제 (No Traces):** 기능을 삭제할 때는 import, 상태 변수, useEffect, UI 컴포넌트, 타입 정의까지 전수 추적하여 완전히 제거하라. `{false && (` 같은 방식으로 코드를 숨기지 마라. `grep_search`로 관련 키워드 전수 검색 필수.

2. **미디어 원칙:** 절대 Base64 형태로 DB에 저장하지 마라. 모든 미디어는 Cloudinary에 업로드 후 Public URL만 DB에 저장한다.

3. **보안 철칙:** 환경 변수는 서버 사이드에서만 접근하며, API Key(`x-goog-api-key` 등)를 `<video src>`, `<img src>` 등 브라우저 태그에 절대 노출하지 마라.

4. **서버리스 한계 인식:** Vercel/Netlify 환경을 고려해 동기 대기 루프(`while + sleep`)를 금지하고, 비동기 Cron 폴링/Retry 패턴을 사용하라.

5. **DOM 직접 조작 금지:** `document.querySelector`로 클래스를 추가/제거하지 마라. Next.js App Router에서 cleanup이 보장되지 않는다. `usePathname()` 기반 조건부 렌더링을 사용하라.

6. **레이아웃 중앙 정렬 필수:** 페이지 컨테이너에는 반드시 `max-width` + `margin: 0 auto` + 좌우 `padding`을 세트로 명시하라.

7. **전역 컴포넌트 영향 확인:** Navigation, Layout 등 전역 컴포넌트 수정 시, 모든 페이지에서의 영향을 반드시 확인하라. 특정 페이지 전용 동작은 `pathname` 조건 분기를 해당 컴포넌트 내부에서 처리하라.

8. **무결성 검증:** 코드 수정 후에는 반드시 JSX 태그 짝을 확인하고, `npx tsc --noEmit`으로 컴파일 오류 0건을 확인하라. 컴파일 성공 전에 "수정 완료" 선언 금지.

9. **변경 범위 최소화:** 요청받은 기능만 수정할 것. 관련 없는 파일을 건드리지 마라. 리팩토링은 명시적으로 요청이 있을 때만 수행.

---

## 분야별 상세 규칙 (서브 룰 참조)

작업하려는 도메인에 맞춰 아래 파일을 반드시 우선 열람하고 지침을 따를 것:

- **UI/컴포넌트/스타일링/TypeScript 작업:** `.agents/workflows/frontend.md` 읽기
- **Next.js API, Supabase, Veo, Cloudinary 작업:** `.agents/workflows/backend.md` 읽기
- **에러 처리, 로깅, 재시도 로직 작업:** `.agents/workflows/error-handling.md` 읽기
