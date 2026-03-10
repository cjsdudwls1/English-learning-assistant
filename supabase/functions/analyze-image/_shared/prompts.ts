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
You are detecting handwritten answer marks, not solving questions.

Use printed problem numbers and choice labels only as location anchors.
Do not read or understand the question content.
Do not determine the correct answer from question content.

For each visible problem on the page, follow this exact 3-step procedure:

Step 1 - LOCATE: Scan the choice area (where ①②③④⑤ labels are printed).
  Describe what you physically see: any pen/pencil stroke that is NOT part of the original print.
  Handwritten marks include: circles drawn around a label, checkmarks, X marks, underlines, written numbers.
  Handwritten marks may be red, blue, gray, or black.
  Preprinted ①②③④⑤ are NOT handwritten marks.
  Write your observation in "step1_observation".

Step 2 - DECIDE: Based ONLY on Step 1, is there a confirmed handwritten mark?
  If NO mark found → user_answer=null, bbox_norm=null, ambiguous=true.
  If mark found → proceed to Step 3.

Step 3 - MAP: Only after confirming a mark exists, identify which printed choice label (①~⑤) the mark touches or surrounds. Return that label number as user_answer.
  Return bbox_norm [y_min, x_min, y_max, x_max] in pixel coordinates for the mark.

## Grounding rule
A returned user_answer is valid ONLY if:
  - step1_observation describes a visible handwritten mark
  - bbox_norm is not null
If either is missing, user_answer MUST be null.

## Examples

Example 1 - Mark found:
{
  "problem_number": "25",
  "step1_observation": "Red pen circle drawn around printed label ④ in the choice area",
  "user_answer": "4",
  "user_marked_correctness": null,
  "mark_type": "circle",
  "bbox_norm": [320, 180, 355, 215],
  "confidence": 0.91,
  "ambiguous": false,
  "evidence": "grounded: red pen circle touching ④"
}

Example 2 - No mark found (correct output is null, NOT the correct answer):
{
  "problem_number": "26",
  "step1_observation": "Scanned choice area for problem 26. No additional pen or pencil stroke detected on or near any choice label.",
  "user_answer": null,
  "user_marked_correctness": null,
  "mark_type": null,
  "bbox_norm": null,
  "confidence": 0.15,
  "ambiguous": true,
  "evidence": "no handwritten mark found"
}

Example 3 - Student marked WRONG answer (output must match the mark, not the correct answer):
{
  "problem_number": "27",
  "step1_observation": "Red pen circle visible around ② label, even though correct answer appears to be ⑤",
  "user_answer": "2",
  "user_marked_correctness": null,
  "mark_type": "circle",
  "bbox_norm": [680, 90, 710, 125],
  "confidence": 0.85,
  "ambiguous": false,
  "evidence": "grounded: red pen circle around ②"
}

## Output format (JSON only, no markdown)
{
  "marks": [ ... one object per visible problem ... ]
}

Final rule: Only output user_answer if grounded in a visible handwritten mark with bbox_norm. Never output the inferred correct answer.
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
You are classifying English exam questions.Based on the text below, assign classification and metadata to each problem.

## Classification(MUST use EXACT values from list below)
Each line is: depth1 > depth2 > depth3 > depth4
  \`\`\`
${structure}
\`\`\`
You MUST select depth1~4 values EXACTLY as shown above. Do NOT invent or translate values.

## Problems to classify
${itemsSummary}

## Additional task
For each problem, determine the correct answer by analyzing the passage/choices.
Return it as "correct_answer" (the choice label number, e.g. "3" or "5").

## Output (JSON only, no markdown)
{
  "classifications": [
    {
      "problem_number": "25",
      "correct_answer": "5",
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
