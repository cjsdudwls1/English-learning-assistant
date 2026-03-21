# analyze-image Cloud Function: 상세 기술 문서

> **최종 갱신**: 2026-03-21  
> **런타임**: GCP Cloud Functions gen2, Node.js 22 (ESM)  
> **타임아웃**: 600초 (10분)

---

## 목차

1. [개요](#1-개요)
2. [아키텍처 전체 흐름](#2-아키텍처-전체-흐름)
3. [모듈 구성](#3-모듈-구성)
4. [파이프라인 상세 흐름](#4-파이프라인-상세-흐름)
5. [Pass별 상세 설명](#5-pass별-상세-설명)
   - [5.1 Pass A: 구조 추출](#51-pass-a-구조-추출)
   - [5.2 Pass 0: 바운딩 박스 좌표 추출](#52-pass-0-바운딩-박스-좌표-추출)
   - [5.3 Pass B: 필기 인식 (답안 + 정답 추출)](#53-pass-b-필기-인식-답안--정답-추출)
   - [5.4 Pass C: 분류 (Classification)](#54-pass-c-분류-classification)
6. [프롬프트 원문](#6-프롬프트-원문)
7. [AI 모델 전략](#7-ai-모델-전략)
8. [이미지 전처리 및 크롭](#8-이미지-전처리-및-크롭)
9. [DB 저장 단계](#9-db-저장-단계)
10. [에러 처리 및 복구](#10-에러-처리-및-복구)

---

## 1. 개요

`analyze-image`는 영어 시험지 이미지를 수신하여 **문제 구조 추출 → 좌표 감지 → 필기 인식 → 분류**의 4단계 AI 분석 파이프라인을 실행하는 GCP Cloud Functions gen2 함수이다.

**핵심 목표:**
- 시험 이미지에서 모든 문제, 지문, 선택지를 **인쇄 텍스트 기반**으로 추출
- 학생이 필기한 **답안(user_answer)**과 AI가 독립 풀이한 **정답(correct_answer)** 감지
- 문제를 분류 체계(taxonomy)에 따라 **자동 분류** 및 **난이도 평가**
- 결과를 Supabase DB의 `sessions`, `problems`, `labels` 테이블에 저장

---

## 2. 아키텍처 전체 흐름

```
클라이언트 (POST /analyzeImage)
    │
    ▼
┌─────────────────────────────────────────────┐
│  HTTP 엔트리포인트 (index.js)                │
│  1. 요청 검증 (images[], userId)             │
│  2. 언어 설정 (프론트 → DB profiles → 기본 ko)│
│  3. Vertex AI 클라이언트 초기화               │
│  4. 이미지 Storage 업로드                     │
│  5. 세션 생성 (status: processing)            │
│  6. 응답 반환 { sessionId }                  │
│  7. 파이프라인 비동기 실행 (fire-and-forget)   │
└─────────────────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────────┐
│  백그라운드 파이프라인 (runAnalysisPipeline)   │
│                                              │
│  인증 검증 → Taxonomy 로드                    │
│       │                                      │
│       ▼                                      │
│  ┌─── 배치 병렬 처리 (3페이지씩) ───┐         │
│  │                                  │        │
│  │  이미지 전처리 (1200px 리사이즈)  │         │
│  │       │                          │        │
│  │       ▼                          │        │
│  │  ┌────────────────────────┐      │        │
│  │  │ processPage (4-Pass)   │      │        │
│  │  │                        │      │        │
│  │  │ Pass A ──┐ (병렬)      │      │        │
│  │  │ Pass 0 ──┘             │      │        │
│  │  │   │                    │      │        │
│  │  │   ▼                    │      │        │
│  │  │ 크롭 (서버사이드)       │      │        │
│  │  │   │                    │      │        │
│  │  │   ▼                    │      │        │
│  │  │ Pass B (필기 인식)      │      │        │
│  │  │   │                    │      │        │
│  │  │   ▼                    │      │        │
│  │  │ Pass C (분류)          │      │        │
│  │  └────────────────────────┘      │        │
│  └──────────────────────────────────┘        │
│       │                                      │
│       ▼                                      │
│  DB 저장: problems → labels → metadata       │
│  세션 완료 (status: completed)                │
└─────────────────────────────────────────────┘
```

---

## 3. 모듈 구성

| 파일 | 역할 | 주요 export |
|------|------|-------------|
| `index.js` | HTTP 엔트리포인트, 파이프라인 오케스트레이션 | `analyzeImage` (HTTP 핸들러) |
| `shared/passes.js` | Pass A/0/B/C 실행 로직 | `executePassA`, `executePass0`, `executePassB`, `executePassBFullImage`, `executePassC` |
| `shared/prompts.js` | AI 프롬프트 빌더 | `buildStructurePrompt`, `buildBoundingBoxPrompt`, `buildCroppedUserAnswerPrompt`, `buildCroppedCorrectAnswerPrompt`, `buildHandwritingDetectionPrompt`, `buildClassificationPrompt` |
| `shared/aiClient.js` | Gemini API 호출, 재시도, Failover | `generateWithRetry`, `callModelWithFailover`, `extractTextFromResponse`, `parseJsonResponse` |
| `shared/config.js` | 모델 시퀀스, 재시도 정책, 타임아웃, 스키마 | `MODEL_SEQUENCE`, `LIGHTWEIGHT_MODEL_SEQUENCE`, `CLASSIFICATION_SCHEMA` |
| `shared/imageCropper.js` | sharp 기반 서버사이드 이미지 크롭 | `cropRegions` |
| `shared/imagePreprocessor.js` | 이미지 리사이즈 전처리 (1200px, JPEG 80%) | `preprocessImage` |
| `shared/dbOperations.js` | Supabase DB CRUD (세션, 문제, 라벨, 메타데이터) | `uploadImages`, `createSession`, `saveProblems`, `saveLabels`, `updateProblemMetadata`, `completeSession` |
| `shared/errors.js` | StageError 클래스, 에러 파싱/요약, 세션 실패 기록 | `StageError`, `markSessionFailed`, `parseModelError` |
| `shared/taxonomy.js` | 분류 체계 로드 및 Lookup Map 구성 | `loadTaxonomyData`, `buildTaxonomyLookupMaps` |

---

## 4. 파이프라인 상세 흐름

### 4.1 요청 수신 및 초기화

```
POST /analyzeImage
Body: { images: [{ imageBase64, mimeType, fileName }], userId, language? }
```

1. **CORS 처리**: 모든 origin 허용
2. **요청 검증**: `images[]` 배열과 `userId` 필수
3. **언어 결정**: 프론트엔드 전달값 → DB `profiles.language` → 기본값 `'ko'`
4. **Vertex AI 초기화**: 서비스계정 JSON 키 인증 (ADC 폴백)
5. **이미지 업로드**: Supabase Storage `uploaded-images` 버킷에 원본 이미지 저장
6. **세션 생성**: `sessions` 테이블에 `status: 'processing'`으로 insert
7. **즉시 응답**: `{ success: true, sessionId }` 반환

### 4.2 백그라운드 파이프라인

응답 반환 후 비동기로 실행되며, 에러 발생 시 DB에 실패 기록:

1. **인증 사전 검증** (`validateVertexAuth`)
2. **Taxonomy 데이터 로드** (분류 프롬프트용 + Lookup Map)
3. **배치 병렬 처리** (3페이지씩):
   - 이미지 전처리 (리사이즈)
   - `processPage` → Pass A/0/B/C 순차 실행
   - 처리 완료된 이미지 메모리 해제
4. **DB 저장**: `saveProblems` → `saveLabels` → `updateProblemMetadata`
5. **세션 완료**: `completeSession` (labeled 상태 가드)

---

## 5. Pass별 상세 설명

### 5.1 Pass A: 구조 추출

| 항목 | 내용 |
|------|------|
| **목적** | 시험지 이미지에서 인쇄된 텍스트를 읽어 문제 구조를 JSON으로 추출 |
| **입력** | 원본 이미지 (base64), 페이지 번호, taxonomy 데이터 |
| **출력** | `{ shared_passages, items[] }` |
| **모델** | `MODEL_SEQUENCE` 순회 (Failover) |
| **온도** | 0.0 (결정적 응답) |
| **실행 방식** | `callModelWithFailover` (모델 시퀀스 순회 + 재시도) |
| **병렬 여부** | Pass 0과 **동시 병렬** 실행 |

**추출 필드:**

| 필드 | 설명 |
|------|------|
| `problem_number` | 문제 번호 (예: "25") |
| `shared_passage_ref` | 공유 지문 참조 ID (예: "43-45") |
| `passage` | 개별 지문 (공유 지문이 아닌 경우) |
| `visual_context` | 표/그래프/안내문 등 시각 자료 `{ type, title, content }` |
| `instruction` | 문제 지시문 (예: "다음 글의 요지로 가장 적절한 것은?") |
| `question_body` | 빈칸 문장 등 문제 본문 |
| `choices` | 선택지 배열 `[{ label: "①", text: "..." }]` |

**핵심 규칙:**
- 이미지에서 직접 읽기 (요약/생략 금지)
- 공유 지문은 1회만 추출, 이후 `shared_passage_ref`로 참조
- 선택지가 없으면 빈 배열 `[]` (가짜 선택지 생성 금지)
- ①②③④⑤가 문단 안에 있으면 개별 선택지로 분리

---

### 5.2 Pass 0: 바운딩 박스 좌표 추출

| 항목 | 내용 |
|------|------|
| **목적** | 각 문제의 위치와 답안 영역을 좌표로 감지 (크롭의 선행 단계) |
| **입력** | 원본 이미지 (base64) |
| **출력** | `{ problems: [{ problem_number, full_bbox, answer_area_bbox }] }` |
| **모델** | `LIGHTWEIGHT_MODEL_SEQUENCE` 순회 |
| **온도** | 1.0 |
| **실행 방식** | 모델 시퀀스 순회, 최초 성공 시 반환 |
| **병렬 여부** | Pass A와 **동시 병렬** 실행 |

**좌표 체계:**
- **정규화 좌표**: 0~1000 범위 (좌상단 (0,0), 우하단 (1000,1000))
- 실제 픽셀 변환은 `imageCropper.js`의 `normalizeToPixel`에서 수행

**감지 영역 2종:**

| 영역 | 용도 | 설명 |
|------|------|------|
| `full_bbox` | Pass B 정답 풀이 | 문제 번호부터 다음 문제 직전까지의 전체 영역 |
| `answer_area_bbox` | Pass B 답안 감지 | 선택지 번호(①②③④⑤)가 위치하거나 서술형 기입란이 있는 영역 |

**실패 처리:**
- 모든 모델이 실패하면 `{ bboxes: [] }` 반환 (파이프라인 중단 없음)
- bbox가 0개인 경우 Pass B는 **전체 이미지 Fallback** 모드로 전환

---

### 5.3 Pass B: 필기 인식 (답안 + 정답 추출)

Pass B는 실행 경로가 **크롭 기반**과 **전체 이미지 Fallback** 두 가지로 분기된다.

#### 5.3.1 크롭 기반 Pass B (기본 경로)

**전제**: Pass 0에서 bbox가 1개 이상 감지된 경우

```
Pass 0 bboxes → 서버사이드 크롭 (sharp)
    │
    ├── answerAreaCrops (답안 영역 크롭)  → 개별 API 호출 → user_answer
    └── fullCrops (전체 문제 크롭)         → 개별 API 호출 → correct_answer
                                                │
                                                ▼
                                      mergeUserAndCorrectMarks
```

**실행 흐름:**
1. `cropRegions`: bbox 좌표로 원본 이미지에서 두 종류의 크롭 이미지 생성
   - 크롭 후 **2배 확대** (작은 필기 감지 향상)
   - JPEG quality 85%로 변환
2. `detectFromCrops`: 각 크롭 이미지에 대해 **개별 API 호출** (배치 3개씩 병렬)
   - **답안 영역 크롭** → `buildCroppedUserAnswerPrompt` → `user_answer` 감지
   - **전체 문제 크롭** → `buildCroppedCorrectAnswerPrompt` → `correct_answer` (AI 독립 풀이)
3. `mergeUserAndCorrectMarks`: `problem_number` 기준으로 user_answer와 correct_answer 병합
4. **부족 보충**: 크롭 기반 marks가 문제 수보다 적으면 전체 이미지 Fallback으로 **누락분 보충**

**크롭 기반 user_answer 프롬프트 핵심:**
- 크롭되고 확대된 답안 영역 이미지만 분석
- 동그라미, 체크마크, 밑줄, 필기 흔적 감지
- 객관식: 선택 번호 "1"~"5" 반환
- 필기가 없으면 `null` 반환

**크롭 기반 correct_answer 프롬프트 핵심:**
- 전체 문제 영역 크롭 이미지 분석
- 문제를 독립적으로 풀어서 정답 도출
- 반드시 답 제공 (null 금지)

#### 5.3.2 전체 이미지 Fallback Pass B

**트리거 조건:**
- Pass 0에서 bbox 0개 반환
- 크롭 실행 중 에러 발생
- 크롭 기반 marks가 문제 수보다 부족한 경우 (보충용)

| 항목 | 내용 |
|------|------|
| **입력** | 원본 전체 이미지 (base64) |
| **출력** | `{ marks: [{ problem_number, user_answer, correct_answer }] }` |
| **모델** | `LIGHTWEIGHT_MODEL_SEQUENCE` **전체 순회** (누적 방식) |
| **온도** | 1.0 |

**동작 방식:**
- 각 모델의 결과를 **누적** (중복 제거, null → 새 값 업데이트)
- 모든 marks에 user_answer가 있으면 **조기 종료**
- 모델이 실패해도 비치명적 처리 (다음 모델 계속)

**전체 이미지 Fallback 프롬프트 핵심:**
- `user_answer`: 종이 위의 물리적 필기 흔적
- `correct_answer`: AI의 독립적 풀이 결과
- user_answer를 correct_answer로 복사하지 않을 것
- 보이는 모든 문제를 보고할 것

#### 5.3.3 Pass B 결과 병합 (mergeHandwritingMarks)

Pass B 결과를 Pass A에서 추출한 `pageItems`에 병합:

1. **초기화**: 모든 `pageItems`의 `user_answer`, `correct_answer`, `user_marked_correctness`를 `null`로 설정
2. **선택지 범위 검증**: 객관식에서 순수 숫자 답이 1~5 범위 밖이면 폐기 (주관식/서술형은 허용)
3. **병합**: `problem_number` 기준으로 매칭하여 값 설정

---

### 5.4 Pass C: 분류 (Classification)

| 항목 | 내용 |
|------|------|
| **목적** | 추출된 문제에 분류 체계(depth1~4)와 메타데이터 할당 |
| **입력** | 문제 요약 텍스트 + taxonomy 구조 + (visual_context 있는 경우) 원본 이미지 |
| **출력** | `{ classifications: [{ problem_number, classification, metadata }] }` |
| **모델** | `LIGHTWEIGHT_MODEL_SEQUENCE` 순회 |
| **온도** | 0.0 (결정적 응답) |
| **JSON 스키마** | `CLASSIFICATION_SCHEMA` (Structured Output 강제) |

**입력 데이터 구성:**
- 각 문제의 `instruction`, `passage` (최대 1500자), `choices` (각 최대 200자), `visual_context` (최대 500자)를 요약하여 프롬프트에 포함
- visual_context가 있는 문제가 존재하면 원본 이미지도 함께 전달 (멀티모달)

**분류 체계 (taxonomy):**
- DB `taxonomy` 테이블에서 로드
- `depth1 > depth2 > depth3 > depth4` 4단계 계층 구조
- 프롬프트에 **정확한 값 목록**을 제공하여 AI가 임의로 생성하지 않도록 강제

**메타데이터 필드:**

| 필드 | 설명 | 값 범위 |
|------|------|---------|
| `difficulty` | 문제 난이도 | 한국어: "상"/"중"/"하", 영어: "high"/"medium"/"low" |
| `word_difficulty` | 어휘 난이도 | 1~9 (1-3: 초등, 4-6: 중등, 7-9: 고등 이상) |
| `problem_type` | 문제 유형 | 자유 텍스트 |
| `analysis` | 문제 상세 분석 | 자유 텍스트 (언어에 따라 한국어/영어) |

---

## 6. 프롬프트 원문

### 6.1 Pass A: Structure Extraction Prompt

```
## Task
You are analyzing an exam page IMAGE. Read ALL text directly from the image
and extract exam questions into structured JSON.
If the image is unreadable/blank, return empty array. Do NOT hallucinate.

## Rules
1. **Read directly from the image.** Extract ALL printed text verbatim.
   Do NOT summarize or skip any part.
2. Fields: passage (지문), visual_context (표/안내문),
   instruction (문제 지시문), question_body (빈칸 문장 등), choices (선택지)
3. Shared passages: extract ONCE, then use shared_passage_ref
   in subsequent problems.
4. No choices → choices: []. No fake choices.
5. Choices may appear as ①②③④⑤ statements embedded in a paragraph
   → extract each as a separate choice in the choices array.
6. For charts/notices/ads: use visual_context {type, title, content}
   to capture the visual element; put accompanying text in passage.

## Output (JSON only, no markdown)
{
  "shared_passages": [{ "id": "43-45", "text": "..." }],
  "items": [{
    "problem_number": "25",
    "shared_passage_ref": null,
    "passage": "...",
    "visual_context": null,
    "instruction": "다음 글의 요지로 가장 적절한 것은?",
    "question_body": null,
    "choices": [{ "label": "①", "text": "..." }, ...]
  }]
}

If no questions found, return { "shared_passages": [], "items": [] }. JSON only.
```

### 6.2 Pass 0: Bounding Box Prompt

```
You are analyzing an English exam page image.

Your task: For each problem (question) visible on this page,
identify TWO regions:

1. "full_bbox": The ENTIRE PROBLEM REGION - from the problem number
   down to just before the next problem. Includes passage, question text,
   and all choices.
2. "answer_area_bbox": ONLY the answer marking area - where the choice
   numbers (①②③④⑤) are, or the blank where students write their answer.

Coordinates should be in NORMALIZED format: values from 0 to 1000,
where (0,0) is the top-left corner and (1000,1000) is the bottom-right corner.

Output JSON only:
{
  "problems": [
    {
      "problem_number": "25",
      "full_bbox": { "x1": 50, "y1": 100, "x2": 500, "y2": 600 },
      "answer_area_bbox": { "x1": 100, "y1": 400, "x2": 500, "y2": 500 }
    }
  ]
}
```

### 6.3 Pass B: Cropped User Answer Prompt

```
You are analyzing a CROPPED and ZOOMED image of the ANSWER AREA
for exam question Q{problemNumber}.
This image is zoomed into ONLY the answer marking region.
Look very carefully for any handwritten marks.

Detect user_answer:
- Look for handwritten marks: circled numbers, checkmarks,
  underlines, pen strokes, pencil marks
- For multiple choice (①②③④⑤): return the MARKED choice number ("1"-"5")
- Look carefully - marks may be faint pencil, small circles,
  or light check marks
- If NO handwritten mark is found at all, return null

Output JSON only:
{ "problem_number": "{problemNumber}", "user_answer": "4" }
```

### 6.4 Pass B: Cropped Correct Answer Prompt

```
You are analyzing a CROPPED image of exam question Q{problemNumber}.
This image shows the FULL problem: question text, passage,
and answer choices.

Solve for correct_answer:
- Read the question text, passage, and choices
- Solve the question independently to determine the correct answer
- For multiple choice: return the correct choice number ("1"-"5")
- You MUST provide a correct_answer. Never return null.

Output JSON only:
{ "problem_number": "{problemNumber}", "correct_answer": "3" }
```

### 6.5 Pass B: Full Image Handwriting Detection Prompt (Fallback)

```xml
<role>You are an expert exam handwriting detection and solving system.</role>

<task>
For each problem number visible on the page(s):
1. Detect user_answer (handwritten marks: circled numbers,
   checkmarks, underlines)
2. Solve for correct_answer independently

For multiple choice (①②③④⑤): return "1"-"5"
For short answer: return text verbatim
If no mark found: return null for user_answer
</task>

<constraints>
- user_answer = physical marks on paper
- correct_answer = your independent solution
- Do NOT copy user_answer into correct_answer
- Report ALL problems visible
</constraints>

Output JSON only:
{
  "marks": [
    { "problem_number": "25", "user_answer": "4", "correct_answer": "3" },
    { "problem_number": "26", "user_answer": null, "correct_answer": "2" }
  ]
}
```

### 6.6 Pass C: Classification Prompt

```
## Task
You are classifying English exam questions. Based on the text below,
assign classification, metadata, and detailed analysis to each problem.

## Classification (MUST use EXACT values from list below)
Each line is: depth1 > depth2 > depth3 > depth4
```
{taxonomy 구조 전체 나열}
```
You MUST select depth1~4 values EXACTLY as shown above.
Do NOT invent or translate values.

## 난이도 기준:
- "상": 고등학생 수준 이상의 어려운 문제
- "중": 중학교 수준의 문제
- "하": 초등학생 수준의 쉬운 문제

어휘 난이도 기준 (1-9):
- 1-3: 초등학생 수준의 쉬운 어휘
- 4-6: 중학교 수준의 보통 어휘
- 7-9: 고등학생 수준 이상의 어려운 어휘

analysis: 문제에 대한 상세 분석 (한국어로 작성)

## Problems to classify
{문제 요약 텍스트}

## Output (JSON only, no markdown)
{
  "classifications": [
    {
      "problem_number": "25",
      "classification": {
        "depth1": "...", "depth2": "...",
        "depth3": "...", "depth4": "..."
      },
      "metadata": {
        "difficulty": "상" | "중" | "하",
        "word_difficulty": 6,
        "problem_type": "...",
        "analysis": "..."
      }
    }
  ]
}
JSON only.
```

---

## 7. AI 모델 전략

### 7.1 모델 시퀀스

**구조 추출용 (Pass A) - `MODEL_SEQUENCE`:**

| 순서 | 모델 | 재시도 횟수 | 기본 딜레이 |
|------|------|-------------|------------|
| 1 | `gemini-3-flash-preview` | 1 | 3000ms |
| 2 | `gemini-3.1-flash-lite-preview` | 1 | 3000ms |
| 3 | `gemini-2.5-flash` | 2 | 3000ms |
| 4 | `gemini-2.5-pro` | 1 | 4000ms |

**경량 작업용 (Pass 0/B/C) - `LIGHTWEIGHT_MODEL_SEQUENCE`:**

| 순서 | 모델 |
|------|------|
| 1 | `gemini-3-flash-preview` |
| 2 | `gemini-3.1-flash-lite-preview` |
| 3 | `gemini-2.5-flash` |

### 7.2 Failover 전략

- **Pass A**: `callModelWithFailover` — 모델 시퀀스를 순회하며 첫 성공 시 반환. 모든 모델 실패 시 `StageError('all_models_failed')` throw
- **Pass 0**: 모델 시퀀스 순회, 실패 시 빈 배열 반환 (비치명적)
- **Pass B (크롭)**: 첫 번째 경량 모델만 사용
- **Pass B (Fallback)**: 모델 시퀀스 전체 순회, 결과 **누적** (모두 user_answer 채워지면 조기 종료)
- **Pass C**: 모델 시퀀스 순회, 첫 성공 시 반환

### 7.3 재시도 로직

- **지수 백오프**: `baseDelay * 2^(attempt-1)` + 지터 (0.85~1.15 범위)
- **재시도 가능 에러**: Rate Limit (429), Server Overload (503), Timeout
- **타임아웃**: 기본 60초, Gemini 3 모델 90초, 도구 사용 시 120초

### 7.4 안전 설정

모든 유해 콘텐츠 카테고리를 `BLOCK_NONE`으로 설정 (시험지 분석이므로 차단 불필요)

---

## 8. 이미지 전처리 및 크롭

### 8.1 이미지 전처리 (`imagePreprocessor.js`)

| 항목 | 값 |
|------|-----|
| 최대 해상도 | 긴 변 1200px |
| JPEG 품질 | 80% |
| 리사이즈 불필요 시 | 원본 그대로 통과 |
| 라이브러리 | sharp |

### 8.2 이미지 크롭 (`imageCropper.js`)

| 항목 | 값 |
|------|-----|
| 좌표 변환 | 정규화(0~1000) → 픽셀 |
| 최소 크롭 크기 | 10px (이하 폐기) |
| 크롭 후 확대 | 2배 (`CROP_ZOOM_FACTOR`) |
| JPEG 품질 | 85% |
| 출력 형식 | base64 문자열 |

**크롭 종류:**
- **answerAreaCrops**: `answer_area_bbox` 기반, Pass B user_answer 감지용
- **fullCrops**: `full_bbox` 기반, Pass B correct_answer 풀이용

---

## 9. DB 저장 단계

### 9.1 이미지 업로드 (`uploadImages`)

- 대상: Supabase Storage `uploaded-images` 버킷
- 파일명 패턴: `{userId}/{timestamp}_{index}_{fileName}`

### 9.2 세션 생성 (`createSession`)

- `sessions` 테이블에 insert
- `image_urls` 배열 검증/정리 (빈 문자열 필터링)
- 초기 상태: `status: 'processing'`

### 9.3 문제 저장 (`saveProblems`)

- `problems` 테이블에 insert
- **choices 정규화**: 문자열/객체 배열 모두 `{ label?, text }` 구조로 통일
- **stem 합성**: `[지문] + [시각자료] + [문제] instruction + question_body`
- **content JSONB**: 모든 추출 필드를 구조화된 JSON으로 저장
- **기본 메타데이터**: `{ difficulty: '중', word_difficulty: 5, problem_type: '분석 대기' }`

### 9.4 라벨 저장 (`saveLabels`)

- `labels` 테이블에 insert

**is_correct 판정 로직 (2단계):**
1. **1차**: 시험지의 O/X 채점 마크 (`user_marked_correctness`) 기반
   - O 계열 ("o", "✓", "correct", "정답" 등) → `true`
   - X 계열 ("x", "✗", "incorrect", "오답" 등) → `false`
   - 판별 불가 → `null`
2. **2차**: 마크가 없고 user_answer + correct_answer 모두 존재 시 자동 비교
   - 숫자 파싱 가능 → 숫자 비교
   - 숫자 파싱 불가 → 대소문자 무시 문자열 비교

**taxonomy 보강 로직:**
1. depth1~4 모두 있으면 → `taxonomyByDepthKey`에서 code/CEFR/난이도 조회
2. depth1~4 매핑 실패 시 → depth 전체 null 처리
3. 부분 depth만 있으면 (1~3개) → 전체 null 처리
4. depth 없고 code만 있으면 → `taxonomyByCode`에서 depth 역방향 복원

### 9.5 메타데이터 업데이트 (`updateProblemMetadata`)

- `problems.problem_metadata` 필드 업데이트
- **난이도 양방향 정규화**: "상"↔"high", "중"↔"medium", "하"↔"low"
- **어휘 난이도**: 1~9 범위 검증, 범위 밖이면 기본값 5
- **problem_type**: `depth1 - depth2 - depth3 - depth4` 조합

### 9.6 세션 완료 (`completeSession`)

- `status: 'completed'`로 업데이트
- **labeled 상태 가드**: `.eq('status', 'processing')` 조건으로 이미 labeled된 세션을 되돌리지 않음

---

## 10. 에러 처리 및 복구

### 10.1 StageError 단계별 분류

| 단계 | 원인 | 복구 |
|------|------|------|
| `auth_failed` | Vertex AI 서비스계정 인쇄 실패 | 인증 정보 확인 필요 |
| `session_create` | 세션 생성 실패 | Supabase 연결 확인 |
| `all_models_failed` | Pass A에서 모든 모델 실패 | 모델 가용성 확인 |
| `model_call` | 개별 모델 호출 실패 (재시도 소진) | 자동 Failover |
| `response_parse` | 모델 응답에 텍스트 없음 | 자동 Failover |
| `json_parse` | JSON 파싱 실패 | 원본 텍스트 폴백 |
| `extract_empty` | 전체 분석에서 0문항 추출 | 세션 실패 기록 |
| `insert_problems` | 문제 DB 저장 실패 | 세션 실패 기록 |
| `insert_labels` | 라벨 DB 저장 실패 | StageError throw |

### 10.2 Fallback 체계

```
Pass 0 bbox 감지 성공? ─── Yes ──→ 크롭 기반 Pass B
       │                                  │
       No                        marks 부족? ──→ 전체 이미지 보충
       │                                  │
       ▼                                  No
전체 이미지 Fallback                       │
                                           ▼
                               Pass B 결과 병합
```

### 10.3 메모리 관리

- 배치 처리 완료 후 `images[idx].imageBase64 = ''`로 즉시 해제
- 배치 크기 3으로 동시 처리 이미지 수 제한

### 10.4 세션 실패 기록

- `markSessionFailed`: `sessions` 테이블에 `status: 'failed'`, `failure_stage`, `failure_message` 기록
- 직렬화 최대 길이: 1800자
- 최종 Fallback: 최소한 `status: 'failed'`만이라도 기록
