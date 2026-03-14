---
description: 유지보수 가능한 코드 작성을 위한 절대 규칙 - 모든 코드 작성 시점에 반드시 적용
---

# 유지보수 가능한 코드 작성 규칙

> **적용 시점:** 새 기능 구현, 기존 코드 수정, 리팩토링 등 **코드를 작성하는 모든 순간**에 적용한다.
> **핵심 목표:** 6개월 후 다른 개발자(혹은 미래의 나)가 코드를 읽고 즉시 이해하고, 안전하게 수정할 수 있는 코드를 작성한다.

---

## A. 구조 규칙 (Structural Rules)

### A-1. 함수 크기 제한
- 하나의 함수는 **최대 40줄**을 넘지 않는다.
- 40줄을 초과하면 **책임을 분리**하여 헬퍼 함수로 추출한다.
- 예외: JSX 반환부가 긴 React 컴포넌트는 JSX 부분을 서브 컴포넌트로 분리한다.

### A-2. 파일/모듈 크기 제한
- 하나의 파일은 **최대 200줄**을 넘지 않는다.
- 200줄을 초과하면 **기능 단위로 모듈을 분리**한다.
- 예외: 타입 정의 파일(types.ts), 설정 파일은 내용이 단순 나열인 경우 허용.

### A-3. 단일 책임 원칙 (Single Responsibility)
- 하나의 함수는 **하나의 일만** 한다.
- 하나의 파일/모듈은 **하나의 관심사만** 다룬다.
- 판단 기준: 함수/파일의 역할을 한 문장으로 설명할 수 없다면, 분리 대상이다.

### A-4. 중첩 깊이 제한
- 조건문/반복문의 **중첩은 최대 3단계**까지만 허용한다.
- 3단계를 초과하면 Early Return, Guard Clause, 또는 헬퍼 함수 추출로 해결한다.

```typescript
// [금지] 4단계 이상 중첩
if (condition1) {
  for (const item of items) {
    if (condition2) {
      if (condition3) { // 4단계 - 금지
        // ...
      }
    }
  }
}

// [권장] Early Return + 헬퍼 함수로 평탄화
if (!condition1) return;
const filteredItems = items.filter(item => meetsCondition2(item));
filteredItems.forEach(item => processItem(item));
```

### A-5. 매개변수 개수 제한
- 함수의 매개변수는 **최대 3개**로 제한한다.
- 3개를 초과하면 **옵션 객체(Options Object) 패턴**을 사용한다.

```typescript
// [금지] 매개변수 4개 이상
function createProblem(type: string, difficulty: number, topic: string, passageGenre: string, count: number) {}

// [권장] 옵션 객체 패턴
interface CreateProblemOptions {
  type: string;
  difficulty: number;
  topic: string;
  passageGenre: string;
  count: number;
}
function createProblem(options: CreateProblemOptions) {}
```

---

## B. 네이밍 규칙 (Naming Rules)

### B-1. 의도가 드러나는 이름
- **금지 이름:** `x`, `data`, `temp`, `res`, `val`, `item`, `obj`, `result` (단독 사용 금지)
- 변수/함수 이름만 보고 **역할과 의도를 즉시 파악**할 수 있어야 한다.

```typescript
// [금지]
const data = await fetchData();
const res = processData(data);

// [권장]
const studentAnswers = await fetchStudentAnswers(sessionId);
const gradingResult = gradeAnswers(studentAnswers);
```

### B-2. 불린 변수 접두사
- 불린 변수/함수는 반드시 `is`, `has`, `should`, `can` 접두사를 사용한다.
- 예시: `isLoading`, `hasPermission`, `shouldRetry`, `canSubmit`

### B-3. 함수는 동사로 시작
- 함수 이름은 반드시 **동사(행위)**로 시작한다.
- 예시: `fetchProblems()`, `validateAnswer()`, `formatScore()`, `renderQuestionCard()`

### B-4. 상수는 UPPER_SNAKE_CASE
- 변하지 않는 설정값, 매직 넘버는 상수로 추출하고 `UPPER_SNAKE_CASE`로 명명한다.

```typescript
// [금지]
if (retryCount > 3) { ... }
if (score >= 80) { ... }

// [권장]
const MAX_RETRY_COUNT = 3;
const PASSING_SCORE_THRESHOLD = 80;
if (retryCount > MAX_RETRY_COUNT) { ... }
if (score >= PASSING_SCORE_THRESHOLD) { ... }
```

---

## C. 중복 금지 (DRY - Don't Repeat Yourself)

### C-1. 동일 로직 2회 반복 금지
- **동일하거나 거의 동일한 로직이 2곳 이상**에 등장하면, 즉시 유틸리티 함수로 추출한다.
- 코드를 작성하기 전에 `grep_search`로 **기존에 유사한 함수가 이미 존재하는지 반드시 확인**한다.

### C-2. 매직 넘버/스트링 상수화
- 코드 내에 의미를 알 수 없는 **숫자 리터럴이나 문자열 리터럴을 직접 사용하지 않는다.**
- 반드시 **명명된 상수**로 추출한다.

### C-3. 기존 유틸리티 우선 활용
- 새 유틸리티를 만들기 전에, 프로젝트 내 기존 `utils/`, `lib/`, `helpers/` 폴더를 반드시 탐색한다.
- 이미 존재하는 유틸리티를 재활용할 수 있다면 새로 만들지 않는다.

---

## D. 의존성 규칙 (Dependency Rules)

### D-1. 단방향 의존성
- 모듈 간 의존성은 반드시 **한 방향으로만** 흐른다.
- **순환 참조(Circular Dependency)를 절대 만들지 않는다.**
- 의존 방향: `Page → Component → Hook → Service/Util → Type`

### D-2. 인터페이스 기반 통신
- 모듈 간 데이터를 주고받을 때는 반드시 **TypeScript 인터페이스/타입으로 계약을 정의**한다.
- 암묵적 의존(특정 객체의 내부 구조를 직접 참조)을 금지한다.

### D-3. Import 정리
- 사용하지 않는 import는 즉시 제거한다.
- import 순서: 외부 라이브러리 → 내부 모듈 → 상대 경로 순서로 정렬한다.

---

## E. 에러 처리 (Error Handling)

### E-1. 빈 catch 블록 금지
- `catch` 블록에서 에러를 **무시하거나 삼키지(swallow) 않는다.**
- 최소한 `console.error`로 에러를 기록한다.

```typescript
// [금지]
try { await saveAnswer(); } catch (e) {}

// [권장]
try {
  await saveAnswer();
} catch (error) {
  console.error('[saveAnswer] 답안 저장 실패:', error);
  throw error; // 또는 사용자에게 알림
}
```

### E-2. 구체적 에러 메시지
- 에러 로그에는 반드시 **[함수명/모듈명]** 접두사와 **맥락 정보**를 포함한다.
- 어디서, 무엇을 하다가, 왜 실패했는지 로그만 보고 파악할 수 있어야 한다.

### E-3. 사용자 대면 에러 처리
- API 호출 실패, 네트워크 오류 등 사용자가 인지해야 하는 에러는 **UI에 명확한 피드백**을 제공한다.
- 기술적 에러 메시지를 사용자에게 그대로 노출하지 않는다.

---

## F. 주석/문서화 (Comments & Documentation)

### F-1. "왜(Why)" 주석만 작성
- 코드가 **무엇(What)**을 하는지는 코드 자체로 설명한다.
- 코드가 **왜(Why)** 이렇게 작성되었는지, 비자명한 이유가 있을 때만 주석을 단다.

```typescript
// [금지] What 주석 (코드를 반복할 뿐)
// 점수를 계산한다
const score = calculateScore(answers);

// [권장] Why 주석 (의도/맥락 설명)
// Supabase Edge Function의 타임아웃(60초)을 고려해 배치 크기를 5개로 제한
const BATCH_SIZE = 5;
```

### F-2. 복잡한 비즈니스 로직 맥락 주석
- 도메인 지식이 없으면 이해하기 어려운 로직에는 비즈니스 맥락 주석을 반드시 작성한다.
- 예: 채점 기준, 난이도 산정 공식, 특수 문제 유형 처리 등

### F-3. TODO/FIXME 후속 관리
- `TODO`나 `FIXME` 주석을 남길 때는 **담당자(또는 이슈 번호)**와 **구체적 내용**을 기재한다.
- 예: `// TODO(#42): OX 문제의 부분 점수 로직 추가 필요`

---

## G. 타입 안전성 (Type Safety)

### G-1. `any` 사용 금지
- `any` 타입은 **절대 사용하지 않는다.**
- 타입을 모를 때는 `unknown`을 사용하고, **타입 가드(Type Guard)**로 좁힌다.

```typescript
// [금지]
function parseResponse(data: any) { return data.result; }

// [권장]
function parseResponse(data: unknown): ParsedResult {
  if (!isValidResponse(data)) {
    throw new Error('[parseResponse] 유효하지 않은 응답 구조');
  }
  return data.result;
}
```

### G-2. 타입 단언(as) 최소화
- `as` 키워드를 사용한 타입 단언은 최소화하고, 사용한 곳에는 **사유를 주석으로 명시**한다.
- 가능하면 타입 가드, 제네릭, 또는 타입 추론으로 대체한다.

### G-3. 반환 타입 명시
- `export`하는 함수의 반환 타입은 **명시적으로 선언**한다.
- 내부 헬퍼 함수는 TypeScript의 타입 추론에 위임 가능.

---

## H. 테스트 가능한 구조 (Testable Architecture)

### H-1. 순수 함수 우선
- 외부 상태에 의존하지 않는 **순수 함수(Pure Function)**를 최대한 많이 만든다.
- 부수 효과(Side Effect)가 필요한 로직은 **별도의 함수로 격리**한다.

### H-2. 하드코딩된 의존성 금지
- 외부 서비스 호출(Supabase, API 등)을 함수 내부에 직접 하드코딩하지 않는다.
- **매개변수 주입** 또는 **서비스 모듈 분리**를 통해 테스트 시 교체 가능한 구조로 만든다.

---

## 위반 시 조치

- 위 규칙을 위반하는 코드를 작성한 경우, 즉시 리팩토링하여 규칙을 준수시킨다.
- **"일단 돌아가게 만들고 나중에 고치자"는 접근을 금지**한다. 처음부터 올바르게 작성한다.
- 기존 코드에서 위반 사례를 발견한 경우, 현재 작업 범위 내에 해당하면 함께 개선한다.
