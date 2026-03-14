---
description: AI 에디터가 가장 먼저 읽는 절대 지침서 (메인 룰)
---

# English Learning Assistant - AI 에디터 메인 룰

기술 스택: React (Vite), TypeScript, Supabase (Database, Auth, Edge Functions, Storage), Google Vertex AI (Gemini), Netlify.

---

## 절대 규칙 (Core Directives)

1. **유지보수성 최우선:** 모든 코드 작성 시 `/7code-quality` 규칙을 반드시 준수한다. "일단 돌아가게" 만드는 일회성 코드를 금지한다. 6개월 후에도 안전하게 수정할 수 있는 코드만 작성한다.

2. **완전한 삭제 (No Traces):** 기능을 삭제할 때는 import, 상태 변수, useEffect, UI 컴포넌트, 타입 정의까지 전수 추적하여 완전히 제거하라. `{false && (` 같은 방식으로 코드를 숨기지 마라. `grep_search`로 관련 키워드 전수 검색 필수.

3. **보안 철칙:** 환경 변수는 서버 사이드(Edge Function)에서만 접근하며, API Key를 브라우저에 절대 노출하지 마라.

4. **서버리스 한계 인식:** Supabase Edge Function(Deno)의 타임아웃과 메모리 제한을 항상 고려한다. 동기 대기 루프(`while + sleep`)를 금지하고, 비동기 폴링/Retry 패턴을 사용하라.

5. **무결성 검증:** 코드 수정 후에는 반드시 `npx tsc --noEmit`으로 컴파일 오류 0건을 확인하라. 컴파일 성공 전에 "수정 완료" 선언 금지.

6. **변경 범위 최소화:** 요청받은 기능만 수정할 것. 관련 없는 파일을 건드리지 마라. 리팩토링은 명시적으로 요청이 있을 때만 수행.

7. **기존 코드 탐색 우선:** 새 함수/유틸리티를 만들기 전에, `grep_search`로 기존에 유사한 기능이 이미 구현되어 있는지 반드시 확인한다. 중복 코드 생성을 금지한다.

8. **자가 리뷰 의무:** 기능 구현 또는 코드 수정 완료 시, `/8self-review` 워크플로우의 체크리스트를 반드시 수행한다. 검증 없이 "완료" 선언 금지.

---

## 코드 라이프사이클별 워크플로우 맵

```
[설계]                          → /6plan-refactoring (리팩토링 설계도)
[코드 작성]                      → /7code-quality (유지보수성 규칙 - 매 순간 적용)
[코드 작성 완료 후]               → /8self-review (자가 품질 검증)
[버그 수정 / 에러 해결]           → /debug-fix (4단계 프로세스)
  └─ [원인 분석]                 → /1analyze-root-cause
  └─ [해결책 문서화]             → /2document-solution
  └─ [문서 검수]                 → /3verify-docs
  └─ [영향도 검증]               → /4verify-impact
  └─ [안전한 코드 수정]           → /5apply-safe-fix
[배포]                          → /deploy
```

---

## 분야별 상세 규칙 (서브 룰 참조)

작업하려는 도메인에 맞춰 아래 파일을 반드시 우선 열람하고 지침을 따를 것:

- **버그/에러 수정 작업:** `.agents/workflows/debug-fix.md` 읽기
- **리팩토링 작업:** `.agents/workflows/6plan-refactoring.md` 읽기
- **배포 작업:** `.agents/workflows/deploy.md` 읽기
- **Veo API 관련 작업:** `.agents/workflows/veo-api.md` 읽기
