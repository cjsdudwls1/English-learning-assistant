// 2단계 프롬프트 로직: Step 1 (Raw OCR) + Step 2 (Extraction)
// v2: 공유 지문, 시각 자료, 분리된 필드 구조 지원

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
Extract all exam questions from images into structured JSON with **separated fields** for passages, instructions, and choices.
${imageCount > 1 ? `**CRITICAL:** You have **${imageCount} sequential images**. Merge split questions across pages into single items.` : ''}
Images are provided **in order** with captions like "Page X of N. Continues from previous page. Next page follows." Use these captions to respect page order and reconnect passages/questions across pages.
If text is unreadable / blank, return an empty array instead of guessing. Do NOT hallucinate problems or content.

## Key Concepts

### Shared Passages (공유 지문)
- When you see markers like **[43-45]**, **[38~39]**, or **[31-34]**, it means ONE passage is shared by MULTIPLE problems.
- Extract the passage ONCE in the first problem, then reference it in subsequent problems using \`shared_passage_ref\`.
- Example: Problems 43, 44, 45 share one passage → Problem 43 has the full passage, Problems 44-45 have \`shared_passage_ref: "43-45"\`.

### Visual Context (시각 자료)
- Charts, graphs, advertisements, notices, letters, and info boxes should go into \`visual_context\`, NOT into \`passage\`.
- Preserve the structure: title, bullet points, dates, etc.

## Extraction Rules (CRITICAL)
1. **Verbatim Text**: Extract ALL text content exactly as it appears. Do NOT summarize or skip any part.
2. **Field Separation**: 
   - \`passage\`: Long reading text that the question refers to (지문)
   - \`visual_context\`: Charts, ads, notices, letters, info boxes (도표, 광고, 안내문)
   - \`instruction\`: The question prompt/directive (예: "다음 글의 목적으로 가장 적절한 것은?")
   - \`question_body\`: Additional content like blank sentences, underlined phrases (빈칸 문장, 밑줄 부분)
   - \`choices\`: The answer options
3. **Missing Content**: NEVER return placeholders like "[Missing paragraph]". If text is in the image, extract it.
4. **Structure Markers**: Preserve (A), (B), (C) markers, underlines, brackets exactly as shown.
5. **Handwriting vs. Printed Text**: Handwritten marks go to \`user_answer\` and \`user_marked_correctness\`. Keep printed text pure.
6. **No fake choices**: If no multiple-choice options exist, set \`choices: []\`.

## Classification Criteria (CRITICAL - READ CAREFULLY)
The following is the ONLY valid taxonomy hierarchy. You MUST select values EXACTLY from this list.
\`\`\`
${structure}
\`\`\`

### Classification Rules (STRICTLY ENFORCED):
1. **SELECT FROM LIST ONLY**: You MUST choose depth1, depth2, depth3, depth4 values EXACTLY as they appear in the hierarchy above.
2. **NO INVENTION**: Do NOT create, translate, or modify any classification values. Using values outside this list will cause validation failure.
3. **EXACT MATCH REQUIRED**: Spelling, spacing, and case sensitivity matter. Copy values exactly.
4. **HIERARCHY CONSTRAINT**: depth2 must be a valid child of the chosen depth1, depth3 must be valid under depth2, etc.
5. **NULL NOT ALLOWED**: All four depth levels (depth1, depth2, depth3, depth4) are mandatory.
6. **EXAMPLES OF INVALID VALUES**: "Reading" when list shows "읽기", "Main Idea" when list shows "중심 내용", English values when Korean taxonomy is provided, etc.

## Output Format (JSON Only)
Respond with JSON only. Do NOT include any markdown, explanations, or HTML.

\`\`\`json
{
  "shared_passages": [
    {
      "id": "43-45",
      "text": "Full passage text shared by problems 43, 44, 45..."
    }
  ],
  "items": [
    {
      "problem_number": "43",
      "shared_passage_ref": "43-45",
      "passage": null,
      "visual_context": null,
      "instruction": "밑줄 친 ⓐ~ⓔ 중에서 문맥상 낱말의 쓰임이 적절하지 않은 것은?",
      "question_body": null,
      "choices": [
        { "label": "①", "text": "ⓐ" },
        { "label": "②", "text": "ⓑ" },
        { "label": "③", "text": "ⓒ" },
        { "label": "④", "text": "ⓓ" },
        { "label": "⑤", "text": "ⓔ" }
      ],
      "user_marked_correctness": "O",
      "user_answer": "③",
      "classification": {
        "depth1": "exact value (MANDATORY)",
        "depth2": "exact value (MANDATORY)",
        "depth3": "exact value (MANDATORY)",
        "depth4": "exact value (MANDATORY)"
      },
      "metadata": {
        "difficulty": "high",
        "word_difficulty": 7,
        "problem_type": "Vocabulary in Context",
        "analysis": "문맥상 'ⓒ'는 '~한'의 의미로 쓰여야 하므로 적절하지 않다."
      }
    },
    {
      "problem_number": "22",
      "shared_passage_ref": null,
      "passage": "Rather than attempting to punish students with a low grade or mark in the hope it will encourage them to give greater effort in the future, teachers can better motivate students by considering their work as incomplete and then requiring additional effort...",
      "visual_context": null,
      "instruction": "다음 글의 요지로 가장 적절한 것은?",
      "question_body": null,
      "choices": [
        { "label": "①", "text": "학생에게 평가 결과를 공개하는 것은 학습 동기를 불러 일으킨다." },
        { "label": "②", "text": "학생에게 추가 과제를 부여하는 것은 학업 부담을 가중시킬 수 있다." },
        { "label": "③", "text": "미흡하다고 보는 학업 성취도에 가기까지 재작업 기회 제공이 효과적이다." },
        { "label": "④", "text": "학생의 자기주도적 학습 능력은 정서적으로 안정된 학습 환경에서 향상된다." },
        { "label": "⑤", "text": "학생의 과제가 일정 수준에 도달해도록 적절한 기회를 주는 동기 부여에 도움이 된다." }
      ],
      "user_marked_correctness": null,
      "user_answer": null,
      "classification": {
        "depth1": "Reading",
        "depth2": "Main Idea",
        "depth3": "Gist",
        "depth4": "Identify Main Point"
      },
      "metadata": {
        "difficulty": "medium",
        "word_difficulty": 6,
        "problem_type": "Main Idea",
        "analysis": "글의 요지는 학생들에게 재작업 기회를 제공하는 것이 동기 부여에 효과적이라는 것이다."
      }
    },
    {
      "problem_number": "25",
      "shared_passage_ref": null,
      "passage": "The above graph shows health spending as a share of GDP for selected OECD countries in 2018...",
      "visual_context": {
        "type": "chart",
        "title": "Health Spending as a Share of GDP for Selected OECD Countries (2018)",
        "content": "Bar chart showing: US 16.9%, Switzerland 12.2%, France 11.2%, Belgium 10.4%, UK 9.8%, OECD average 8.8%, Greece 7.8%, Turkey 4.2%"
      },
      "instruction": "다음 도표의 내용과 일치하지 않는 것은?",
      "question_body": null,
      "choices": [
        { "label": "①", "text": "..." },
        { "label": "②", "text": "..." },
        { "label": "③", "text": "..." },
        { "label": "④", "text": "..." },
        { "label": "⑤", "text": "..." }
      ],
      "user_marked_correctness": null,
      "user_answer": null,
      "classification": { "depth1": "...", "depth2": "...", "depth3": "...", "depth4": "..." },
      "metadata": { "difficulty": "medium", "word_difficulty": 5, "problem_type": "Graph Analysis", "analysis": "..." }
    },
    {
      "problem_number": "28",
      "shared_passage_ref": null,
      "passage": null,
      "visual_context": {
        "type": "notice",
        "title": "Virtual Idea Exchange",
        "content": "Connect in real time and have discussions about the upcoming school festival.\\n\\n◎ Goal: Plan the school festival and share ideas for it.\\n◎ Participants: Club leaders only\\n◎ What to Discuss:\\n  • Themes  • Ticket sales  • Budget\\n◎ Date & Time: 5 to 7 p.m. on Friday, June 25th, 2021\\n◎ Notes:\\n  • Get the access link by text message 10 minutes before the meeting and click it.\\n  • Type your real name when you enter the chatroom."
      },
      "instruction": "Virtual Idea Exchange에 관한 다음 안내문의 내용과 일치하는 것은?",
      "question_body": null,
      "choices": [
        { "label": "①", "text": "..." }
      ],
      "user_marked_correctness": null,
      "user_answer": null,
      "classification": { "depth1": "...", "depth2": "...", "depth3": "...", "depth4": "..." },
      "metadata": { "difficulty": "low", "word_difficulty": 4, "problem_type": "Notice Comprehension", "analysis": "..." }
    },
    {
      "problem_number": "31",
      "shared_passage_ref": null,
      "passage": "In a culture where there is a belief that you can have anything you truly want, there is no problem in choosing...",
      "visual_context": null,
      "instruction": "다음 빈칸에 들어갈 말로 가장 적절한 것을 고르시오.",
      "question_body": "When this is an issue in a group, we discuss what makes for good decisions. If a person can be unhampered from their cares and duties and, just for a moment, consider what appeals to them, they get the chance to sort out what is important to them. Then they can consider and negotiate with their external pressures.\\n\\n________ When this is an issue in a group, we discuss what makes for good decisions.",
      "choices": [
        { "label": "①", "text": "desires" },
        { "label": "②", "text": "merits" },
        { "label": "③", "text": "abilities" },
        { "label": "④", "text": "limitations" },
        { "label": "⑤", "text": "worries" }
      ],
      "user_marked_correctness": null,
      "user_answer": null,
      "classification": { "depth1": "...", "depth2": "...", "depth3": "...", "depth4": "..." },
      "metadata": { "difficulty": "high", "word_difficulty": 7, "problem_type": "Blank Filling", "analysis": "..." }
    }
  ]
}
\`\`\`

### Field Descriptions:
- **shared_passages**: Array of passages shared by multiple problems. Each has an \`id\` (e.g., "43-45") and \`text\`.
- **shared_passage_ref**: If this problem uses a shared passage, put the passage ID here. Otherwise, null.
- **passage**: The reading passage for THIS problem only. Null if using shared_passage_ref or if no passage.
- **visual_context**: For charts/graphs/notices/ads. Has \`type\`, optional \`title\`, and \`content\`. Null if none.
- **instruction**: The question directive (e.g., "다음 글의 목적으로 가장 적절한 것은?"). ALWAYS required.
- **question_body**: Additional question content like blank sentences. Null if not needed.
- **choices**: Array of {label, text}. Empty array if no choices (free response).

If you cannot read any question, return { "shared_passages": [], "items": [] }. Respond with JSON only.
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
