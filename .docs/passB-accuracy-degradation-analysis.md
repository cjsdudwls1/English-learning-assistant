# Pass B 필기 감지 정확도 저하 분석

> 디버깅 파이프라인: **`[1] 원인 분석`** → `[2] 해결책 문서화` → `[3] 문서 검수` → `[4] 코드 수정`

## 문제 현상 요약

Pass D 도입으로 correct_answer 독립 풀이는 성공했으나, **Pass B(필기 감지)의 user_answer 정확도가 심각하게 저하**되었다.

| 문제 | 실제 사용자 답안 | Pass B 감지 결과 | 일치 여부 |
|------|---------------|----------------|----------|
| Q25 | 4 | **5** | 불일치 |
| Q26 | 5 | 5 | 일치 |
| Q27 | 2 | **5** | 불일치 |

- **Pass D(정답 풀이)**: 5, 3, 5 → 실제 정답과 완벽 일치 (정상 작동)
- **Pass B(필기 감지)**: 5, 5, 5 → 3문제 중 2문제 오검출 (66% 오류율)

## 에러 로그 / 핵심 증거

### Edge Function 로그 (세션: `6a6f9dd5`, v207, 23:37 KST)

```
[Pass B] gemini-3.1-flash-lite-preview detected 3 mark(s):
  Q25: user=5, Q26: user=5, Q27: user=5

[Pass B] All marks have answers, stopping early

[Pass D] solved 3 problem(s):
  Q25: correct=5, Q26: correct=3, Q27: correct=5
```

### DB 저장 결과 (problems 테이블)

```
Q25: user_answer=5, correct_answer=5, is_correct=true  (실제: 오답인데 정답으로 판정)
Q26: user_answer=5, correct_answer=3, is_correct=false  (user_answer 자체가 잘못됨)
Q27: user_answer=5, correct_answer=5, is_correct=true  (실제: 오답인데 정답으로 판정)
```

## 분석 과정

### 1단계: correct_answer 복사 문제 (해결 완료)

원래 Pass B가 user_answer와 correct_answer를 둘 다 담당했으나, AI가 user_answer를 correct_answer에 복사하는 문제가 있었다. 이를 Pass D(텍스트 기반 독립 풀이)로 분리하여 **해결 완료**.

### 2단계: user_answer 오검출 문제 (현재 이슈)

Pass B의 필기 감지가 모든 문제를 "5"로 인식하고 있다.

**이전 세션들과 비교:**

| 세션 시점 | 모델 | Q25 user | Q26 user | Q27 user | 비고 |
|-----------|------|----------|----------|----------|------|
| 3/9 15:32 (v201) | - | 4 | null | null | Pass B 원래 프롬프트 |
| 3/13 23:11 (v203) | flash-lite | 4 | 3 | 5 | correct_answer 추가 버전 |
| 3/13 23:21 (v205) | flash-lite | 4 | 3 | 5 | 단순화 프롬프트 |
| 3/13 23:37 (v207) | flash-lite | **5** | **5** | **5** | 현재: 필기 전용 프롬프트 |

**v203~v205에서는 user_answer가 4, 3, 5로 정상 감지**되었다가, v207에서 갑자기 **5, 5, 5로 전부 잘못** 감지.

### 3단계: 프롬프트 변경 추적

v207에서 Pass B 프롬프트를 `correct_answer 제거 + 필기 감지 전용`으로 변경했다:

```diff
# v205 (이전 - 실험용)
- You are an English exam grading assistant. Look at the exam image(s) and for each question:
- 1. Find the student's handwritten answer (user_answer). If none, return null.
- 2. Solve the question yourself to get the correct answer (correct_answer). The student may be wrong.
- Return JSON only: { "marks": [{ "problem_number": "1", "user_answer": "3", "correct_answer": "2" }] }

# v207 (현재 - 필기 전용)
+ You have ${imageCount} exam page image(s).
+ For each problem number, detect the student's handwritten answer.
+ ...
+ Output JSON only:
+ { "marks": [{ "problem_number": "25", "user_answer": "4" }, ...] }
```

핵심 차이: 출력 JSON 구조에서 `correct_answer` 필드가 제거되었다.

## 근본 원인 가설

### 가설 1 (주요): 프롬프트 변경에 따른 모델 동작 불안정 (가능성: 높음)

`gemini-3.1-flash-lite-preview`는 경량 모델로, 프롬프트 변경에 매우 민감하다.

- v205에서는 `correct_answer`도 함께 요구하면서 모델이 문제를 **분석적으로 살펴보는** 과정에서 user_answer도 정확하게 감지했을 가능성이 있다.
- v207에서 `correct_answer`를 제거하고 "필기만 감지하라"고 지시하니, 모델이 **깊은 분석 없이 피상적으로** 이미지를 보고 마킹을 잘못 인식했을 가능성이 있다. (역설적으로, 문제를 풀라는 지시가 필기 감지에도 도움을 주고 있었음)

### 가설 2: 모델의 본질적 한계 (가능성: 중간)

`gemini-3.1-flash-lite-preview`는 경량 preview 모델로, 이미지 내 필기 인식 정확도가 본질적으로 낮을 수 있다. 이전에 정상 감지된 것은 우연일 수 있다.

### 가설 3: 조기 중단 로직에 의한 보충 기회 상실 (가능성: 낮음)

Pass B의 failover 로직이 `nullCount === 0`이면 `break`하는데, 모든 답이 "5"로 채워졌으므로 다음 모델로 보충 시도를 하지 않았다. 그러나 어차피 null이 아닌 오답이므로 보충 대상이 아니다.

## 향후 제안 (다음 단계에서 상세화)

1. **Pass B 프롬프트에 correct_answer를 다시 포함**하되, 저장 시에는 Pass D 결과만 사용하도록 백엔드에서 처리
2. **Pass B 전용 모델을 상위 모델로 고정** (gemini-2.5-pro 등)
3. **Pass B 프롬프트를 이전 v205 버전으로 복구** (correct_answer 포함 버전이 필기 감지에 더 유리했음)
