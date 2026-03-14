# 구현 계획서 적용 후 에러 수정 계획

> 기획자 피드백 구현 계획서(`implementation_plan.md.resolved`) 적용 후 발견된 4건의 이슈를 분석하고,
> **개발적 정합성(데이터 의존관계, 코드 영향 범위, 배포 순서)**을 고려하여 수정 우선순위를 결정한 문서이다.

> **[문서 검수 완료]** 2026-03-13 — 워크플로우 3(문서 검수) 수행 완료. 4개 이슈 모두 실제 소스 코드와 대조하여 팩트 체크를 완료하였음.

---

## 수정 순서 요약

| 순서 | 이슈                                          | 영향도 | 수정 범위          |
|:----:|:----------------------------------------------|:------:|:-------------------|
| **1** | 이미지 분석 시 정답(`correct_answer`)이 null로 저장 | **치명** | 엣지 펑션 1개 파일 |
| **2** | AI 문제 생성 시 지문 형식(genre) 미반영 + 지문 본문 누락 | **높음** | 엣지 펑션 1개 파일 |
| **3** | 세션 상세 페이지에서 사용자 답안/정답 보기 및 수정 불가 | **중간** | 프론트엔드 1개 파일 |
| **4** | Phase 2(다중 유형) 및 피드백 5(답안 편집) 테스트 검증 | **낮음** | 테스트/검증 절차    |

### 순서 결정 근거

```
[1] 정답 null 버그 (백엔드 버그)
 ↓ 1번이 해결되어야 이미지 분석 결과 데이터가 정상이 됨
[2] AI 문제 생성 genre 미반영 (백엔드 누락)
 ↓ 1, 2번 모두 엣지 펑션 수정 → 한 번에 배포 가능
[3] 세션 상세 답안/정답 편집 UI (프론트엔드)
 ↓ 1번에서 데이터가 정상 저장되어야 편집 UI가 의미있음
[4] Phase 2 / 피드백 5 수동 테스트 검증 (테스트 절차)
 ↓ 위 3건이 모두 반영된 후 통합 검증
```

---

## 이슈 1: 이미지 분석 시 정답(`correct_answer`)이 null로 저장되는 버그 [검증 완료]

### 증상

엣지 펑션 수정 후 이미지 분석을 실행하면 **모든 문제의 `correct_answer`가 null**로 저장된다.

DB 증거:
- 최신 세션 (2026-03-13, v201): `content_correct_answer = null`, `label_correct_answer = null` (3건 전부)
- 이전 세션 (2026-03-12, v200): `content_correct_answer = "5"`, `label_correct_answer = "5"` 등 정상 값 존재

### 원인 분석

**Pass B 프롬프트**: `correct_answer` 추출을 올바르게 지시하고 있음 (정상)

**Pass B → `mergeHandwritingMarks`**: `correct_answer`를 `pageItems`에 정상 병합 (정상)

**문제 지점**: `mergeClassifications` 함수에서 **Pass B가 설정한 `correct_answer`를 Pass C 결과(null)로 덮어쓰고 있음**

#### 수정 대상 파일

[pageAnalyzer.ts](file:///c:/cheon/cheon_wokespace/edu/English-learning-assistant/supabase/functions/analyze-image/_shared/pageAnalyzer.ts#103-132)

#### 버그 코드 (라인 121-129)

```typescript
// mergeClassifications 함수 내부 (pageAnalyzer.ts 라인 121-129)
for (const item of pageItems) {
  const pNum = String(item.problem_number || '');
  const match = classMap.get(pNum);
  if (match) {
    item.classification = match.classification;
    item.metadata = match.metadata;
    item.correct_answer = match.correct_answer;  // Pass C는 correct_answer를 반환하지 않으므로 항상 null
  }
}
```

> **[코드 대조 확인]**
> - 라인 112: `classMap` 생성 시 `correct_answer: cls.correct_answer || null` → AI가 해당 필드를 반환하지 않을 경우 `undefined || null = null`
> - 라인 127: `item.correct_answer = match.correct_answer` → 조건 없이 무조건 덮어씀
> - `ClassificationResult` 인터페이스(`analysisProcessor.ts` 라인 371-385)에 `correct_answer?: string | null` 필드가 존재하지만, Pass C 프롬프트(`prompts.ts` 라인 109-119)의 출력 JSON 구조에는 `correct_answer`가 포함되어 있지 않음 → AI가 반환하지 않으므로 항상 null이 됨

#### 실행 흐름

```
Pass A+B 병렬 실행 완료
 ↓
mergeHandwritingMarks()  → item.correct_answer = "5" (Pass B에서 감지한 정답) [정상]
 ↓
mergeClassifications()   → item.correct_answer = null (Pass C는 그 필드를 반환하지 않으므로 null) [여기서 덮어씀]
 ↓
최종 결과: correct_answer = null  [버그]
```

#### 수정 방안

`mergeClassifications`에서 `correct_answer`를 조건부로만 설정:

```diff
  for (const item of pageItems) {
    const match = classMap.get(pNum);
    if (match) {
      item.classification = match.classification;
      item.metadata = match.metadata;
-     item.correct_answer = match.correct_answer;
+     // Pass C에서 correct_answer가 있을 때만 덮어쓴다 (Pass B가 먼저 설정한 값 보존)
+     if (match.correct_answer) {
+       item.correct_answer = match.correct_answer;
+     }
    }
  }
```

추가로 `classMap` 생성 부분에서 `correct_answer`를 아예 수집하지 않는 것이 더 깔끔하다:
- Pass C의 `buildClassificationPrompt`(`prompts.ts` 라인 89-121)에는 이미 `correct_answer` 출력이 없음 **[공식 코드 확인 완료]**
- `ClassificationResult` 인터페이스(`analysisProcessor.ts` 라인 371-385)에서 `correct_answer` 필드를 제거하면 근본적으로 해결
- 추가적으로 `classMap` 생성부(pageAnalyzer.ts 라인 113-118)에서 `correct_answer` 수집 자체를 제거하면 타입 안전성이 향상됨

#### 수정 후 배포

- 파일: `supabase/functions/analyze-image/_shared/pageAnalyzer.ts`
- 배포: `supabase functions deploy analyze-image --no-verify-jwt --project-ref vkoegxohahpptdyipmkr`
- 검증: 이미지 업로드 후 DB에서 `content->>'correct_answer'` 값 확인

---

## 이슈 2: AI 문제 생성 시 지문 형식(genre) 미반영 + 지문 본문 누락 [검증 완료]

### 증상

사용자가 "편지/이메일" 형식 + "서술형" 유형으로 문제 생성을 요청했으나:
1. 문제 본문(passage)이 출력되지 않음
2. 지정한 편지/이메일 형식으로 생성되지 않음

### 원인 분석

#### 프론트엔드 → 엣지 펑션 데이터 흐름

```
ProblemGeneratorUI.tsx        problemLoader.ts            generate-problems-by-type/index.ts
───────────────────────       ──────────────────          ─────────────────────────────────
passageGenre 선택 (UI)   →    AIGenerationOptions.        ProblemRequest에 passageGenre 필드 없음
                              passageGenre 포함    →       buildPrompt()에 passageGenre 반영 코드 없음
includePassage 체크      →    aiOptions.includePassage →   includePassage 처리 코드 있음 (정상)
```

#### 문제 1: `passageGenre`가 엣지 펑션에서 무시됨

프론트엔드에서는 `passageGenre`를 올바르게 전달하고 있으나:
- [ProblemRequest 인터페이스](file:///c:/cheon/cheon_wokespace/edu/English-learning-assistant/supabase/functions/generate-problems-by-type/index.ts#30-42)에 `passageGenre` 필드 미정의 **[코드 대조 확인: 라인 30-42에 해당 필드 없음]**
- [buildPrompt 함수](file:///c:/cheon/cheon_wokespace/edu/English-learning-assistant/supabase/functions/generate-problems-by-type/index.ts#211-277)에 `passageGenre` 반영 로직 미구현 **[코드 대조 확인: 라인 211-277 내 passageGenre 언급 없음]**

> **[프론트엔드 전달 방식 확인]** `ProblemGeneratorUI.tsx` 라인 448에서 `passageGenre`를 한국어/영어 레이블(예: "편지/이메일")로 변환하여 전달함. 엣지 펑션에서 이를 프롬프트에 그대로 삽입하는 방식은 AI가 해당 언어 지시를 이해할 수 있으므로 적절함.

#### 문제 2: 지문(passage) 본문 미출력

서술형(essay) 템플릿의 JSON 형식에 `passage` 필드가 포함되어 있지 않음:
- [서술형 템플릿](file:///c:/cheon/cheon_wokespace/edu/English-learning-assistant/supabase/functions/generate-problems-by-type/index.ts#134-171): `stem`, `guidelines`, `sample_answer`, `grading_criteria`, `explanation` 필드만 정의 **[코드 대조 확인]**
- `includePassage`가 true일 때 `{passageReqIdx}. 각 문제 JSON 객체에 "passage" 필드를 추가`라는 지시는 있으나(라인 269-273), 서술형 템플릿 자체에 passage 필드가 없어서 AI가 무시할 가능성이 높음

> **[보완 사항]** 이 문제는 서술형(`essay`)뿐 아니라 **모든 유형**(`multiple_choice`, `short_answer`, `ox`)의 JSON format 문자열에도 해당된다. 모든 유형의 형식에 `passage` 필드 예시가 없으므로, `includePassage=true`일 때 AI가 해당 필드를 생략할 수 있다. 다만, 객관식(`multiple_choice`)의 경우 stem 근처에 passage가 자연스럽게 포함될 수 있어 실제 문제가 덜 발생하지만, 서술형/O/X에서 특히 누락률이 높을 것으로 예상된다.

DB 증거:
- 최근 서술형 문제(2026-03-13): `passage = null`

### 수정 대상

[generate-problems-by-type/index.ts](file:///c:/cheon/cheon_wokespace/edu/English-learning-assistant/supabase/functions/generate-problems-by-type/index.ts)

### 수정 방안

#### (A) `ProblemRequest` 인터페이스에 `passageGenre` 추가

```diff
  interface ProblemRequest {
      problemType: ProblemType;
      problemCount: number;
      classification?: Classification;
      userId: string;
      language: Language;
      difficulty?: string;
      includePassage?: boolean;
      passageLength?: number;
      passageTopic?: { category: string; subfield: string };
+     passageGenre?: string;
      difficultyLevel?: number;
      vocabLevel?: number;
  }
```

#### (B) `buildPrompt`에 `passageGenre` 반영

```diff
  if (request.passageTopic?.category && request.passageTopic?.subfield) {
      prompt += language === 'ko'
          ? `\n지문의 주제는 ${request.passageTopic.category} 분야의 ${request.passageTopic.subfield}에 관한 학술적/교양적 내용으로 작성하라.`
          : `\nThe passage topic should be about ${request.passageTopic.subfield} in the field of ${request.passageTopic.category}, written as academic or informational content.`;
  }

+ // 지문 종류(genre) 지정
+ if (request.passageGenre) {
+     prompt += language === 'ko'
+         ? `\n지문의 형식(종류)은 반드시 "${request.passageGenre}" 형태로 작성하라. 예: 편지라면 Dear...로 시작, 기사라면 헤드라인+본문, 대화문이라면 A/B 화자 교대 등.`
+         : `\nThe passage MUST be written in "${request.passageGenre}" format. For example: a letter should start with "Dear...", a news article should have a headline and body, a dialogue should alternate between speakers, etc.`;
+ }
```

#### (C) 모든 유형의 JSON 템플릿에 `passage` 필드 명시적 포함

> **[수정 보완]** 기존 문서에서는 "서술형/주관식"만 언급했으나, 실제로는 **모든 유형**의 JSON format 문자열에 `passage`가 없다. 단, 가장 시급한 것은 `essay`와 `ox` 유형이다.

각 유형의 JSON 출력 형식에 `"passage": "..."` 필드를 명시적으로 추가하여 AI가 빠뜨리지 않도록 한다.

구체적 수정 위치:
- `essay` ko/en format (라인 137-146, 155-164): JSON 예시 최상단에 `"passage": "지문 전문"` 추가
- `ox` ko/en format (라인 175-182, 193-200): JSON 예시에 `"passage": "지문 전문"` 추가
- `short_answer` ko/en format (라인 101-109, 118-126): JSON 예시에 `"passage": "지문 전문"` 추가
- `multiple_choice` ko/en format (라인 55-68, 77-90): JSON 예시에 `"passage": "지문 전문"` 추가

> **주의:** passage 필드는 `includePassage=true`일 때만 유효하므로, 템플릿 format 자체에 항상 넣을 경우 `includePassage=false`에서도 AI가 passage를 만들 수 있다. 대안으로, `buildPrompt` 함수에서 `includePassage=true`일 때만 동적으로 JSON format 문자열에 passage 필드를 삽입하는 방식이 더 적절하다.

### 수정 후 배포

- 파일: `supabase/functions/generate-problems-by-type/index.ts`
- 배포: `supabase functions deploy generate-problems-by-type --no-verify-jwt --project-ref vkoegxohahpptdyipmkr`
- 검증: 편지/이메일 형식 + 서술형으로 문제 생성 후 DB에서 passage, stem 확인

---

## 이슈 3: 세션 상세 페이지에서 사용자 답안/정답 보기 및 수정 불가 [검증 완료]

### 증상

`/session/:sessionId` (세션 상세) 페이지에서 사용자 답안과 정답을 보거나 수정할 수 없음.
현재 `MultiProblemEditor` 컴포넌트가 문제 본문, 선택지, 분류만 표시하고 있으며 답안/정답 편집 UI가 없음.

> **참고**: 메인 페이지의 `QuickLabelingCard`에는 이미 답안/정답 편집 기능이 구현되어 있음.
> 세션 상세의 `MultiProblemEditor`에만 이 기능이 빠져 있는 상태.

### 현재 화면 구조

```
SessionDetailPage.tsx
 └─ MultiProblemEditor.tsx    ← 문제 본문, 보기, 분류, 정답/오답 마킹만 가능
                                 사용자 답안 입력 필드 없음
                                 correct_answer 입력 필드 없음
```

### 수정 대상

[MultiProblemEditor.tsx](file:///c:/cheon/cheon_wokespace/edu/English-learning-assistant/English-learning-assistant/src/components/MultiProblemEditor.tsx)

### 수정 방안

`QuickLabelingCard`와 동일한 방식으로 **사용자 답안** 및 **정답** 편집 `<input>` 필드를 추가한다.

추가 위치: 문제 본문(`문제내용.text`) 표시 영역 바로 아래, 분류 정보 영역 위

```
각 문제 카드 내부:
  ┌─ 문제 제목 (#1) + 정답/오답 버튼
  ├─ 문제 본문 (기존)
  ├─ [추가] 사용자 답안 입력 <input>
  ├─ [추가] 실제 정답 입력 <input>
  ├─ 문제 유형 분류 (기존)
  └─ 예시 문장 생성 (기존)
```

`handleSubmit` 실행 시 `updateProblemLabels`에 수정된 답안/정답이 포함되도록
`items` 배열의 해당 필드를 업데이트한다.

### 수정 후 검증

- 프론트엔드 빌드: `npm run build`
- 로컬 확인: 세션 상세 페이지 접속 후 답안/정답 필드가 표시되고 편집 가능한지 확인
- 저장 후 새로고침: 수정한 값이 DB에 반영되어 유지되는지 확인

---

## 이슈 4: Phase 2(다중 문제 유형) 및 피드백 5(답안 편집) 테스트/검증 방법 [검증 완료]

### 검증이 필요한 항목

#### (A) Phase 2: 다중 문제 유형 지원

이 항목은 **이미지 분석 시** 다양한 문제 유형(객관식/주관식/서술형/O/X)을 자동 감지하고 처리하는 기능이다.

**DB 확인 방법:**

```sql
-- 최근 분석된 문제들에 question_type이 저장되어 있는지 확인
SELECT 
  p.id,
  p.content->>'problem_number' AS problem_number,
  p.content->>'user_answer' AS user_answer,
  p.content->>'correct_answer' AS correct_answer,
  p.content->>'question_type' AS question_type,
  jsonb_array_length(COALESCE(p.content->'choices', '[]'::jsonb)) AS choice_count
FROM problems p
JOIN sessions s ON p.session_id = s.id
ORDER BY s.created_at DESC
LIMIT 20;
```

**수동 테스트 방법:**
1. 객관식 + 서술형 문제가 혼합된 시험지 이미지를 업로드한다
2. 분석 완료 후 QuickLabelingCard에서 각 문제의 유형 배지가 올바르게 표시되는지 확인한다
3. 더웜과 함께 세션 상세에서도 유형별 렌더링이 적용되는지 확인한다

**현재 상태 평가:**
- `QuickLabelingCard`에 `inferQuestionType` 함수가 구현되어 있어, 선택지 유무/정답 형태로 유형 판별 가능
- `question_type` 필드가 DB에 저장되지 않더라도 프론트엔드에서 추론하여 표시 가능
- 다만 서술형/주관식 전용 이미지 분석 테스트가 필요 (이미지에 해당 유형이 포함되어야 함)

#### (B) 피드백 5: 사용자 답안/정답 편집 텍스트박스

**DB 확인 방법:**

```sql
-- labels 테이블에서 user_answer, correct_answer가 올바르게 저장되는지 확인
SELECT 
  l.problem_id,
  l.user_answer,
  l.correct_answer,
  l.user_mark,
  l.is_correct
FROM labels l
JOIN problems p ON l.problem_id = p.id
JOIN sessions s ON p.session_id = s.id
ORDER BY s.created_at DESC
LIMIT 20;
```

**수동 테스트 방법:**
1. 이미지 분석 완료 후 QuickLabelingCard에서 "사용자 답안" 필드에 값을 수정한다
2. "실제 정답" 필드에 값을 수정한다
3. "저장" 버튼을 클릭한다
4. 페이지를 새로고침한 후 수정한 값이 유지되는지 확인한다
5. 세션 상세 페이지에서도 동일하게 확인한다 (이슈 3 수정 후)

**현재 상태 평가:**
- `QuickLabelingCard`에 `editableAnswers`, `editableCorrectAnswers` state가 이미 구현됨 **[코드 대조 확인: QuickLabelingCard.tsx 라인 45]**
- `handleSave`에서 `correct_answer`를 포함하여 `updateProblemLabels` 호출 **[코드 대조 확인: QuickLabelingCard.tsx 라인 118]**
- `updateProblemLabels`(`db/problems.ts` 라인 206)에서 `correct_answer`를 labels 테이블에 저장 **[코드 대조 확인]**
- `SessionDetailPage.tsx` 라인 132에서도 `updateProblemLabels` 호출 확인 **[코드 대조 추가 확인]**
- **기능 자체는 작동하는 것으로 판단** (이슈 1의 correct_answer null 문제와 혼동 주의)

---

## 작업 체크리스트

- [x] **이슈 1** 수정: `pageAnalyzer.ts`의 `mergeClassifications`에서 `correct_answer` 덮어쓰기 방지 (**2026-03-13 완료**)
- [x] **이슈 2** 수정: `generate-problems-by-type/index.ts`에 `passageGenre` 처리 추가 (**2026-03-13 완료**)
- [x] 이슈 1 + 이슈 2 수정 후 엣지 펑션 일괄 배포 (**2026-03-13 완료**)
- [x] **이슈 3** 수정: `MultiProblemEditor.tsx`에 답안/정답 편집 UI 추가 (**2026-03-13 완료**)
- [x] 프론트엔드 빌드 검증 (**2026-03-13 완료** — `npm run build` 성공)
- [ ] 프론트엔드 `git push` (Netlify 자동 배포)
- [ ] **이슈 4** 검증: DB 쿼리 및 수동 테스트
