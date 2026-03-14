// 3-Pass 아키텍처 프롬프트
// Pass A: 구조 추출 전용 (이미지 → 텍스트/구조)
// Pass B: 필기 감지 + 문제 풀이 (이미지 → user_answer + correct_answer)
// Pass C: 분류/메타데이터 전용 (텍스트 → classification + metadata)

/**
 * Pass A: 구조 추출 전용 프롬프트
 * - 이미지에서 인쇄된 텍스트, 지문, 선택지, 시각자료만 추출
 * - user_answer, classification, metadata는 포함하지 않음 (별도 Pass에서 처리)
 */
export function buildStructurePrompt(
  imageCount: number = 1,
) {
  return `
## Task
You are analyzing an exam page IMAGE. Read ALL text directly from the image and extract exam questions into structured JSON.
${imageCount > 1 ? `You have ${imageCount} sequential pages. Merge split questions across pages.` : ''}
If the image is unreadable/blank, return empty array. Do NOT hallucinate.

## Rules
1. **Read directly from the image.** Extract ALL printed text verbatim. Do NOT summarize or skip any part.
2. Fields: passage (지문), visual_context (도표/안내문), instruction (문제 지시문), question_body (빈칸 문장 등), choices (선택지)
3. Shared passages: extract ONCE, then use shared_passage_ref in subsequent problems.
4. No choices → choices: []. No fake choices.
5. Choices may appear as ①②③④⑤ statements embedded in a paragraph — extract each as a separate choice in the choices array.
6. For charts/notices/ads: use visual_context {type, title, content} to capture the visual element; put accompanying text in passage.

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
`;
}

/**
 * Pass 0: 바운딩 박스 검출 프롬프트
 * - 각 문제에 대해 두 종류의 좌표 반환:
 *   1) full_bbox: 문제 전체 영역 (지문+선택지+답안) → correct_answer 도출용
 *   2) answer_area_bbox: 답안 마킹 영역만 → user_answer 감지용 (확대하면 작은 필기도 감지 가능)
 */
export function buildBoundingBoxPrompt() {
  return `You are analyzing an English exam page image.

Your task: For each problem (question) visible on this page, identify TWO regions:

1. "full_bbox": The ENTIRE PROBLEM REGION - from the problem number down to just before the next problem. Includes passage, question text, and all choices.
2. "answer_area_bbox": ONLY the answer marking area - where the choice numbers (①②③④⑤) are, or the blank where students write their answer.

Coordinates should be in NORMALIZED format: values from 0 to 1000, where (0,0) is the top-left corner and (1000,1000) is the bottom-right corner.

Output JSON only:
{
  "problems": [
    {
      "problem_number": "25",
      "full_bbox": { "x1": 50, "y1": 100, "x2": 500, "y2": 600 },
      "answer_area_bbox": { "x1": 100, "y1": 400, "x2": 500, "y2": 500 }
    }
  ]
}`;
}

/**
 * Pass B-1: 답안 영역 크롭 → user_answer 감지 전용 프롬프트
 * - 답안 영역만 확대하여 작은 필기/마크 감지에 최적화
 */
export function buildCroppedUserAnswerPrompt(problemNumber: string) {
  return `You are analyzing a CROPPED and ZOOMED image of the ANSWER AREA for exam question Q${problemNumber}.
This image is zoomed into ONLY the answer marking region. Look very carefully for any handwritten marks.

Detect user_answer:
- Look for handwritten marks: circled numbers, checkmarks, underlines, pen strokes, pencil marks
- For multiple choice (①②③④⑤): return the MARKED choice number ("1"-"5")
- Look carefully - marks may be faint pencil, small circles, or light check marks
- If NO handwritten mark is found at all, return null

Output JSON only:
{ "problem_number": "${problemNumber}", "user_answer": "4" }`;
}

/**
 * Pass B-2: 전체 문제 크롭 → correct_answer 도출 전용 프롬프트
 * - 문제 전체(지문+선택지)를 보고 정답을 독립적으로 풀이
 */
export function buildCroppedCorrectAnswerPrompt(problemNumber: string) {
  return `You are analyzing a CROPPED image of exam question Q${problemNumber}.
This image shows the FULL problem: question text, passage, and answer choices.

Solve for correct_answer:
- Read the question text, passage, and choices
- Solve the question independently to determine the correct answer
- For multiple choice: return the correct choice number ("1"-"5")
- You MUST provide a correct_answer. Never return null.

Output JSON only:
{ "problem_number": "${problemNumber}", "correct_answer": "3" }`;
}

/**
 * Pass B (폴백): 전체 이미지 필기 감지 (코드 실행 없이)
 * - 바운딩 박스/크롭 실패 시 기존 방식으로 분석
 */
export function buildHandwritingDetectionPrompt(imageCount: number = 1) {
  return `
<role>You are an expert exam handwriting detection and solving system.</role>

<task>
For each problem number visible on the page(s):
1. Detect user_answer (handwritten marks: circled numbers, checkmarks, underlines)
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
${imageCount > 1 ? `- You have ${imageCount} pages. Report each problem ONCE.` : ''}
</constraints>

Output JSON only:
{
  "marks": [
    { "problem_number": "25", "user_answer": "4", "correct_answer": "3" },
    { "problem_number": "26", "user_answer": null, "correct_answer": "2" }
  ]
}
`;
}

/**
 * Pass C: 분류 + 메타데이터 + 분석 통합 프롬프트
 * - 이미지 없이 텍스트만으로 분류/메타데이터/상세분석 생성
 * - 정답 추론은 Pass B에서 처리하므로 여기서는 수행하지 않음
 */
export function buildClassificationPrompt(
  classificationData: { structure: string },
  itemsSummary: string,
  userLanguage: 'ko' | 'en' = 'ko',
) {
  const { structure } = classificationData;

  const difficultyGuide = userLanguage === 'ko'
    ? `난이도 기준:
- "상": 고등학교 수준 이상의 어려운 문제
- "중": 중학교 수준의 문제
- "하": 초등학교 수준의 쉬운 문제

단어 난이도 기준 (1-9):
- 1-3: 초등학교 수준의 쉬운 단어
- 4-6: 중학교 수준의 보통 단어
- 7-9: 고등학교 수준 이상의 어려운 단어

analysis: 문제에 대한 상세 분석 (한국어로 작성)`
    : `Difficulty levels:
- "high": High school level or above
- "medium": Middle school level
- "low": Elementary school level

Word difficulty (1-9):
- 1-3: Elementary level vocabulary
- 4-6: Middle school level vocabulary
- 7-9: High school level or above

analysis: Detailed analysis of the problem (in English)`;

  const difficultyValues = userLanguage === 'ko'
    ? `"상" | "중" | "하"`
    : `"high" | "medium" | "low"`;

  return `
## Task
You are classifying English exam questions. Based on the text below, assign classification, metadata, and detailed analysis to each problem.

## Classification (MUST use EXACT values from list below)
Each line is: depth1 > depth2 > depth3 > depth4
  \`\`\`
${structure}
\`\`\`
You MUST select depth1~4 values EXACTLY as shown above. Do NOT invent or translate values.

## ${difficultyGuide}

## Problems to classify
${itemsSummary}

## Output (JSON only, no markdown)
{
  "classifications": [
    {
      "problem_number": "25",
      "classification": { "depth1": "...", "depth2": "...", "depth3": "...", "depth4": "..." },
      "metadata": { "difficulty": ${difficultyValues}, "word_difficulty": 6, "problem_type": "...", "analysis": "..." }
    }
  ]
}
JSON only.
`;
}



// 하위 호환성: 기존 buildPrompt 이름을 유지하되 buildStructurePrompt를 호출
export function buildPrompt(
  _classificationData: { structure: string },
  _language: 'ko' | 'en' = 'ko',
  imageCount: number = 1,
) {
  return buildStructurePrompt(imageCount);
}

export function buildOcrPrompt(imageCount: number) {
  return `
You will receive ${imageCount} sequential images with captions ("Page X of N...").
Extract the full visible text from each page verbatim. Do NOT summarize or omit anything.

**IMPORTANT - Handwritten Marks Detection:**
In addition to printed text, carefully look for and transcribe:
- Handwritten answers: circled numbers (①②③④⑤), written numbers (1,2,3,4,5), letters, or any marks on/near answer choices
- Correctness marks: O (circle/correct), X (cross/incorrect), check marks (✓), slash marks near problem numbers
- Any handwritten notes, underlines, or annotations
For each question where you detect handwritten marks, append at the end of that question's text block:
[USER_MARK] problem=<problem number> answer=<detected answer or "none"> correct=<O/X/none>

Respond ONLY with JSON:
{
  "pages": [
    { "page": 1, "text": "page text..." }
  ]
}
If a page is unreadable or blank, return an empty string for that page's text. Keep page numbers accurate and in order. No markdown, no code fences.`;
}
