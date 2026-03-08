// 1단계 멀티모달 분석 프롬프트: 이미지에서 직접 텍스트+구조+마크 추출
// v4: OCR 단계 제거, Gemini 멀티모달로 이미지 직접 분석

export function buildPrompt(
  classificationData: { structure: string },
  language: 'ko' | 'en' = 'ko',
  imageCount: number = 1,
) {
  const { structure } = classificationData;

  return `
## Task
You are analyzing an exam page IMAGE. Read ALL text directly from the image and extract exam questions into structured JSON.
${imageCount > 1 ? `You have ${imageCount} sequential pages. Merge split questions across pages.` : ''}
If the image is unreadable/blank, return empty array. Do NOT hallucinate.

## Rules
1. **Read directly from the image.** Extract ALL printed text verbatim. Do NOT summarize or skip any part.
2. Fields: passage (지문), visual_context (도표/안내문), instruction (문제 지시문), question_body (빈칸 문장 등), choices (선택지)
3. Shared passages: extract ONCE, then use shared_passage_ref in subsequent problems.
4. **Handwritten marks (CRITICAL):**
   - Carefully examine the image for handwritten pen/pencil marks
   - user_answer: the answer the student selected (e.g., "③", "2", "B"). Look for circled numbers, written numbers, or underlined choices.
   - user_marked_correctness: "O" if the problem is marked correct (circle, checkmark ✓), "X" if marked wrong (X mark, slash), null if no correctness mark exists
   - Common mark patterns: red/blue pen circles around answer numbers, O/X written next to the problem number, checkmarks (✓) or crosses (✗)
5. No choices → choices: []. No fake choices.

## Classification (MUST use EXACT values from list below)
Each line is: depth1 > depth2 > depth3 > depth4
\`\`\`
${structure}
\`\`\`
You MUST select depth1~4 values EXACTLY as shown above. Do NOT invent or translate values.

## Output (JSON only, no markdown)
{
  "shared_passages": [{ "id": "43-45", "text": "..." }],
  "items": [{
    "problem_number": "22",
    "shared_passage_ref": null,
    "passage": "...",
    "visual_context": null,
    "instruction": "다음 글의 요지로 가장 적절한 것은?",
    "question_body": null,
    "choices": [{ "label": "①", "text": "..." }, ...],
    "user_marked_correctness": null,
    "user_answer": null,
    "classification": { "depth1": "...", "depth2": "...", "depth3": "...", "depth4": "..." },
    "metadata": { "difficulty": "medium", "word_difficulty": 6, "problem_type": "...", "analysis": "..." }
  }]
}

If no questions found, return { "shared_passages": [], "items": [] }. JSON only.
`;
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
