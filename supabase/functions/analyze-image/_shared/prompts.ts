// 2단계 프롬프트 로직: Step 1 (Raw OCR) + Step 2 (Extraction)
// v3: taxonomy를 플랫 목록으로 축소 (13,000자 → 3,600자)

export function buildPrompt(
  classificationData: { structure: string },
  language: 'ko' | 'en' = 'ko',
  imageCount: number = 1,
  ocrPages: Array<{ page: number; text: string }> = [],
) {
  const { structure } = classificationData;

  const transcriptBlock = ocrPages.length > 0
    ? `\n## OCR Transcript\n${ocrPages.map(p => `Page ${p.page}:\n${p.text || '[blank]'}`).join('\n\n')}\n`
    : '';

  return `
## Task
Extract all exam questions from the OCR text into structured JSON.
${imageCount > 1 ? `You have ${imageCount} sequential pages. Merge split questions across pages.` : ''}
If text is unreadable/blank, return empty array. Do NOT hallucinate.

## Rules
1. Extract ALL text verbatim. Do NOT summarize.
2. Fields: passage (지문), visual_context (도표/안내문), instruction (문제 지시문), question_body (빈칸 문장 등), choices (선택지)
3. Shared passages: extract ONCE, then use shared_passage_ref in subsequent problems.
4. Handwritten marks → user_answer, user_marked_correctness. Keep printed text pure.
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
${transcriptBlock}
`;
}

export function buildOcrPrompt(imageCount: number) {
  return `
You will receive ${imageCount} sequential images with captions ("Page X of N...").
Extract the full visible text from each page verbatim. Do NOT summarize or omit anything.
Respond ONLY with JSON:
{
  "pages": [
    { "page": 1, "text": "page text..." }
  ]
}
If a page is unreadable or blank, return an empty string for that page's text. Keep page numbers accurate and in order. No markdown, no code fences.`;
}
