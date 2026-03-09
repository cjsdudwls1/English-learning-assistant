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
4. No choices → choices: []. No fake choices.
5. Choices may appear as ①②③④⑤ statements embedded in a paragraph — extract each as a separate choice in the choices array.
6. For charts/notices/ads: use visual_context {type, title, content} to capture the visual element; put accompanying text in passage.
7. Set user_answer and user_marked_correctness to null (handwriting detection is handled separately).

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

/**
 * Pass 2 전용: 필기 마크 감지 프롬프트
 * 구조 추출과 분리하여 손글씨/펜 자국 감지에만 집중합니다.
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
