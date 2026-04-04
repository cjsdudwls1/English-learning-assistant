/**
 * 프롬프트 모듈 (Node.js ESM)
 * 기존 Deno 프롬프트를 그대로 이식, TypeScript → JavaScript 변환
 */

export function buildStructurePrompt(imageCount = 1) {
  return `
## Task
You are analyzing an exam page IMAGE. Read ALL text directly from the image and extract exam questions into structured JSON.
${imageCount > 1 ? `You have ${imageCount} sequential pages. Merge split questions across pages.` : ''}
If the image is unreadable/blank, return empty array. Do NOT hallucinate.

## Rules
1. **Read directly from the image.** Extract ALL printed text verbatim. Do NOT summarize or skip any part.
2. Fields: passage (지문), visual_context (표/안내문), instruction (문제 지시문), question_body (빈칸 문장 등), choices (선택지)
3. Shared passages: extract ONCE, then use shared_passage_ref in subsequent problems.
4. No choices → choices: []. No fake choices.
5. Choices may appear as ①②③④⑤ statements embedded in a paragraph → extract each as a separate choice in the choices array.
6. For charts/notices/ads: use visual_context {type, title, content} to capture the visual element; put accompanying text in passage.
7. **problem_number is MANDATORY.** Read the bold printed number at the start of each question (e.g., "28", "29"). Never leave it blank. If a range like "[31~34]" appears, each sub-question still gets its own number.

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

export function buildBoundingBoxPrompt() {
  return `You are analyzing an English exam page image.

Your task: For each problem (question) visible on this page, identify TWO regions:

1. "full_bbox": The ENTIRE PROBLEM REGION - from the problem number down to just before the next problem. Includes passage, question text, and all choices.
2. "answer_area_bbox": The ANSWER MARKING AREA where students mark their answers.
   - Make the bbox 10-15% wider than the printed choice text. Handwritten marks often extend beyond text boundaries.
   - Extend x1 leftward to include the problem number area. Students often write answers next to the problem number.
   - For horizontally arranged choices: wide but short bbox. For vertically arranged choices: narrower but taller bbox.

Coordinates should be in NORMALIZED format: values from 0 to 1000, where (0,0) is the top-left corner and (1000,1000) is the bottom-right corner.

Output JSON only:
{
  "problems": [
    {
      "problem_number": "25",
      "full_bbox": { "x1": 50, "y1": 100, "x2": 500, "y2": 600 },
      "answer_area_bbox": { "x1": 30, "y1": 380, "x2": 520, "y2": 520 }
    }
  ]
}`;
}

export function buildCroppedUserAnswerPrompt(problemNumber, questionContext) {
  if (questionContext?.isSubjective) {
    return `You are analyzing a CROPPED and ZOOMED image of the ANSWER AREA for exam question Q${problemNumber}.
This is a SHORT ANSWER / ESSAY type question (not multiple choice).

Your task: Read the HANDWRITTEN answer text exactly as the student wrote it.

Rules:
- Transcribe the handwritten text VERBATIM, including any spelling mistakes or grammatical errors the student made
- Do NOT correct the student's answer — report exactly what they wrote
- If the student crossed out text and rewrote it, report only the final version
- If you see an arrow (→) indicating a correction (e.g., "cuting → cutting"), report ONLY the corrected word/phrase after the arrow
- If no handwritten answer is found, return null

Output JSON only:
{ "problem_number": "${problemNumber}", "user_answer": "the student's handwritten answer" }`;
  }

  return `You are analyzing a CROPPED and ZOOMED image of the ANSWER AREA for exam question Q${problemNumber}.
This image is zoomed into ONLY the answer marking region. Look very carefully for any handwritten marks.

## Primary Rule: Detect the MARKED answer number
Your main goal is to find which choice number (1-5) the student marked/selected.
- Look for: circled numbers, checkmarks, underlines, pen strokes, pencil marks on or near a choice number
- Faint pencil marks, light circles, and small tick marks all count as valid marks
- For multiple choice (①②③④⑤): return the choice number ("1"-"5")

## Secondary Rule: Korean Exam Grading Marks (apply ONLY when clearly visible)
After exams, students sometimes mark their papers during answer-checking:
- If you see BOTH an X mark on one number AND an O/circle on a different number:
  The X-marked number = user_answer (student's original wrong choice)
  The O-marked number = the correct answer (marked later), NOT user_answer
- If you see ONLY circles/marks on ONE number (no X anywhere): that number IS user_answer
- Do NOT assume grading marks exist unless you clearly see both X and O on different numbers

## Output
If NO handwritten mark is found at all, return null.

Output JSON only:
{ "problem_number": "${problemNumber}", "user_answer": "4" }`;
}

export function buildCroppedCorrectAnswerPrompt(problemNumber, questionContext) {
  if (questionContext?.isSubjective) {
    const instruction = questionContext.instruction || '';
    const questionBody = questionContext.questionBody || '';

    return `You are analyzing a CROPPED image of exam question Q${problemNumber}.
This is a SHORT ANSWER / ESSAY type question (not multiple choice).
${instruction ? `\nInstruction: ${instruction}` : ''}
${questionBody ? `\nQuestion: ${questionBody}` : ''}

Your task: Read the question from the image and solve it to determine the correct answer.

Rules:
- For grammar correction questions (find and fix errors): provide ONLY the corrected word or phrase, not the full sentence
- For sentence transformation questions (rewrite in a given form): provide the COMPLETE transformed sentence
- You MUST provide a correct_answer. Never return null.

Output JSON only:
{ "problem_number": "${problemNumber}", "correct_answer": "the correct answer text" }`;
  }

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

export function buildHandwritingDetectionPrompt(imageCount = 1) {
  return `
<role>You are an expert exam handwriting detection and solving system.</role>

<task>
For each problem number visible on the page(s):
1. Detect user_answer (what the student physically wrote/marked on paper)
2. Solve for correct_answer independently
</task>

<answer_format>
- Multiple choice (①②③④⑤): return the marked/correct choice number as "1"-"5"
- Short answer / essay (서술형):
  - user_answer: transcribe the student's handwritten text VERBATIM, including spelling errors. If you see a correction arrow (→), report only the text after the arrow.
  - correct_answer: solve the question and return the correct text answer
- If no mark found: return null for user_answer
</answer_format>

<constraints>
- user_answer = physical marks/writing on paper (do NOT correct spelling or grammar)
- correct_answer = your independent solution (the actually correct answer)
- Do NOT copy user_answer into correct_answer
- Report ALL problems visible
${imageCount > 1 ? `- You have ${imageCount} pages. Report each problem ONCE.` : ''}
</constraints>

Output JSON only:
{
  "marks": [
    { "problem_number": "1", "user_answer": "4", "correct_answer": "3" },
    { "problem_number": "6", "user_answer": "cutting", "correct_answer": "cutting" }
  ]
}
`;
}

export function buildClassificationPrompt(classificationData, itemsSummary, userLanguage = 'ko') {
  const structure = classificationData?.structure || classificationData?.map?.(n => `${n.label_ko || n.label_en}`).join('\n') || '';

  const difficultyGuide = userLanguage === 'ko'
    ? `난이도 기준:
- "상": 고등학생 수준 이상의 어려운 문제
- "중": 중학교 수준의 문제
- "하": 초등학생 수준의 쉬운 문제

어휘 난이도 기준 (1-9):
- 1-3: 초등학생 수준의 쉬운 어휘
- 4-6: 중학교 수준의 보통 어휘
- 7-9: 고등학생 수준 이상의 어려운 어휘

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

  const difficultyValues = userLanguage === 'ko' ? `"상" | "중" | "하"` : `"high" | "medium" | "low"`;

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

export function buildPrompt(classificationData, language = 'ko', imageCount = 1) {
  return buildStructurePrompt(imageCount);
}
