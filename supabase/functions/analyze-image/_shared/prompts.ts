// 3-Pass 아키텍처 프롬프트
// Pass A: 구조 추출 전용 (이미지 → 텍스트/구조)
// Pass B: 필기 감지 전용 (이미지 → 손글씨 마크)
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
 * Pass B: 필기 감지 전용 프롬프트
 * - 이미지에서 손글씨 마크(사용자 답안, O/X 표시)만 감지
 * - 구조 추출, 분류, 메타데이터 생성은 일체 하지 않음
 * - 인쇄된 문제 번호/선택지를 공간 앵커로 사용
 */
export function buildHandwritingDetectionPrompt() {
  return `
## Task
You are detecting student handwriting on an exam page image.

Important:
- Do NOT solve the questions.
- Do NOT transcribe the printed passages or choices.
- You MAY use printed problem numbers and printed choice labels (①②③④⑤ or 1,2,3,4,5) only as spatial anchors.

## Detection rules
1. Scan the page exhaustively from top to bottom, left to right.
2. For EVERY visible problem number on the page, return exactly one object.
3. For each problem, inspect the answer-choice region and detect whether the student added any handwritten mark:
   - circle around a choice
   - checkmark
   - X mark
   - underline
   - handwritten number
4. Distinguish preprinted circled labels (①②③④⑤) from handwritten circles:
   - a handwritten circle is an additional pen/pencil stroke around or over the printed label
   - handwritten marks may be red, blue, gray, or black
5. Do not stop after finding one mark. Check every visible problem on the page.
6. If uncertain, still return the problem object and set ambiguous: true.

## Output (JSON only, no markdown)
{
  "marks": [
    {
      "problem_number": "25",
      "user_answer": "4",
      "user_marked_correctness": null,
      "mark_type": "circle",
      "confidence": 0.93,
      "ambiguous": false,
      "evidence": "red handwritten circle around printed choice ④"
    },
    {
      "problem_number": "26",
      "user_answer": null,
      "user_marked_correctness": null,
      "mark_type": null,
      "confidence": 0.21,
      "ambiguous": true,
      "evidence": "no reliable handwritten mark detected"
    }
  ]
}
If no problems are visible, return { "marks": [] }. JSON only.
`;
}

/**
 * Pass C: 분류/메타데이터 전용 프롬프트
 * - 이미지 없이 텍스트만으로 분류/메타데이터 생성
 * - 이 분리를 통해 모델이 문제를 "풀어서" user_answer를 오염시키는 것을 방지
 */
export function buildClassificationPrompt(
  classificationData: { structure: string },
  itemsSummary: string,
) {
  const { structure } = classificationData;

  return `
## Task
You are classifying English exam questions. Based on the text below, assign classification and metadata to each problem.

## Classification (MUST use EXACT values from list below)
Each line is: depth1 > depth2 > depth3 > depth4
\`\`\`
${structure}
\`\`\`
You MUST select depth1~4 values EXACTLY as shown above. Do NOT invent or translate values.

## Problems to classify
${itemsSummary}

## Output (JSON only, no markdown)
{
  "classifications": [
    {
      "problem_number": "25",
      "classification": { "depth1": "...", "depth2": "...", "depth3": "...", "depth4": "..." },
      "metadata": { "difficulty": "medium", "word_difficulty": 6, "problem_type": "..." }
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
