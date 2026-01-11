// 2단계 프롬프트 로직: Step 1 (Raw OCR) + Step 2 (Extraction)
export function buildPrompt(
  classificationData: { structure: string },
  language: 'ko' | 'en' = 'ko',
  imageCount: number = 1,
  ocrPages: Array<{ page: number; text: string }> = [],
) {
  const { structure } = classificationData;

  const transcriptBlock = ocrPages.length > 0
    ? `\n## OCR Transcript (per page, in order)\n${ocrPages.map(p => `Page ${p.page}:\n${p.text || '[blank]'}`).join('\n\n')}\n`
    : '';

  return `

## Task
Extract all exam questions from images into structured JSON.
${imageCount > 1 ? `**CRITICAL:** You have **${imageCount} sequential images**. Merge split questions across pages into single items.` : ''}
Images are provided **in order** with captions like "Page X of N. Continues from previous page. Next page follows." Use these captions to respect page order and reconnect passages/questions across pages.
If text is unreadable / blank, return an empty array instead of guessing. Do NOT hallucinate problems or content.

## Extraction Rules (CRITICAL)
1. **Verbatim Text**: Extract the ALL text content exactly as it appears. Do NOT summarize or skip any part of the passage, options, or instructions.
2. **Missing Content**: NEVER return placeholders like "[Missing paragraph]" or "[Passage]". If the text is in the image, you MUST extract it.
3. **Structure Markers**: Preserve all structural markers in passages, such as (A), (B), (C) or [A], [B]. For insertion questions, keep the insertion points (e.g. " (A) ") and their surrounding text clearly visible.
4. **Handwriting vs. Printed Text**: Treat handwritten answers/marks (e.g., pencil/pen writing, red circles/✓) as user answers only. Do NOT merge handwriting into question_text or passage. Capture handwriting in "user_answer"; keep question_text purely from printed/typed prompt.
5. **Underlined/Bracketed Text**: If a question references underlined or bracketed parts (e.g., "① [increased]"), extract them exactly as shown with the markers.
6. **Options**: Extract all 5 choices fully. Do not truncate.
7. **Layout Separators**: When a problem contains multiple parts (boxes, story passages, subquestions), separate major parts with explicit newlines so each part starts on its own line to keep boundaries clear.
8. **Question vs. Prompt Separation**: For cloze/selection items like "보기 안에서 알맞은 말을 고르시오. I saw her ( to play | play ) badminton in the park.", format \`question_text\` with clear line breaks: 
   - Line 1: \`Q{problem_number} <instruction>\`
   - Line 2: the provided sentence/prompt exactly as shown (e.g., \`I saw her ( to play | play ) badminton in the park.\`)
   - Keep options in the \`choices\` array; do NOT merge them into \`question_text\`.
9. **No grading text in question_text**: Never include "AI:", "정답", "사용자 답안" or scoring/marks inside \`question_text\`. Put only the problem statement/prompt there. User handwriting/answers go to \`user_answer\`; correctness goes to \`user_marked_correctness\`.
10. **Fill-in-the-blank fidelity**: Keep blank markers exactly as shown (e.g., "(A)", "(B)", "[ ]", "( to play | play )"). Do not reorder or remove them. If multiple blanks, keep the surrounding sentence intact on its own line so blanks stay in place.
11. **Word-order (재배열) problems**: If the problem provides a word/phrase bank to reorder (e.g., "[phrase1, phrase2, phrase3, ...]"), keep it as a separate section **below** the instruction/target sentence. Format \`question_text\` like:
    Q{number} <instruction>
    <target sentence>
    Word Bank:
    phrase1
    phrase2
    phrase3
    ...
   Do NOT inject the bank items into the sentence line. Preserve order and punctuation; one item per line.
   Do NOT include the original bracketed/slash-separated bank (e.g., "[an essay. / My mom / helped / me / writing / write]"). Only include the cleaned per-line list once, without surrounding brackets or slashes.
   If the source shows items like "[the students]" or "( the students )", strip ALL brackets/parentheses and list as plain text lines under "Word Bank:". Never output any bracketed/parenthesized version anywhere—only the newline-separated plain items.
12. **No fake choices**: If the problem does NOT provide multiple-choice options, set \`choices: []\`. Never invent placeholder options (e.g., "NULL", "-", empty strings).
13. **Metadata Extraction (MANDATORY)**: You MUST analyze each problem to provide:
    - \`difficulty\`: One of "high", "medium", "low" (or "상", "중", "하").
    - \`word_difficulty\`: Integer from 1 (easy) to 9 (very difficult).
    - \`problem_type\`: A concise category (e.g., "Grammar", "Reading", "Vocabulary", "Blank Filling").
    - \`analysis\`: A helpful explanation of the problem logic, solution, and why the answer is correct.

## Classification Criteria
\`\`\`
${structure}
\`\`\`
- **MANDATORY:** Classify using depth1~4 from criteria table above. NULL NOT allowed.
- Use exact values (spelling/spacing/case-sensitive).
- Only depth1~depth4 keys (no code/CEFR/difficulty).

## Output Format (JSON Only)
Respond with JSON only. Do NOT include any markdown, explanations, or HTML.

\`\`\`json
{
  "items": [
    {
      "problem_number": "35",
      "question_text": "Q35 <instruction line>\\n<prompt line or passage, exactly as shown>",
      "choices": ["① Choice 1", "② Choice 2", "③ Choice 3", "④ Choice 4", "⑤ Choice 5"], // or [] for free-response/blanks
      "user_marked_correctness": "O" | "X",
      "user_answer": "marked choice or text",
      "classification": {
        "depth1": "exact value (MANDATORY)",
        "depth2": "exact value (MANDATORY)",
        "depth3": "exact value (MANDATORY)",
        "depth4": "exact value (MANDATORY)"
      },
      "metadata": {
        "difficulty": "high" | "medium" | "low",
        "word_difficulty": 1-9,
        "problem_type": "string",
        "analysis": "string"
      }
    }
  ]
}
\`\`\`

If you cannot read any question, return { "items": [] }. Respond with JSON only.
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
