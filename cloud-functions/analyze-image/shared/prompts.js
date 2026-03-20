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

export function buildCroppedUserAnswerPrompt(problemNumber) {
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

export function buildCroppedCorrectAnswerPrompt(problemNumber) {
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
