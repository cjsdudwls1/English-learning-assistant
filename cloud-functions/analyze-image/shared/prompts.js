/**
 * 프롬프트 모듈 (Node.js ESM)
 * 기존 Deno 프롬프트를 그대로 이식, TypeScript → JavaScript 변환
 */

const MAX_OCR_TEXT_LENGTH_PER_PAGE = 8000;

export function buildStructurePrompt(imageCount = 1, ocrPages = []) {
  const ocrSection = (Array.isArray(ocrPages) && ocrPages.length > 0)
    ? `\n## Reference OCR text (Document AI pre-OCR — may have errors, treat as HINT only, image is authoritative)\n${ocrPages.map(p => {
        const text = String(p.text || '');
        const truncated = text.length > MAX_OCR_TEXT_LENGTH_PER_PAGE
          ? text.slice(0, MAX_OCR_TEXT_LENGTH_PER_PAGE) + '\n...[truncated for token limit]'
          : text;
        return `### Page ${p.page}\n${truncated}`;
      }).join('\n\n')}\n`
    : '';

  return `
## Task
You are analyzing an exam page IMAGE. Read ALL text directly from the image and extract exam questions into structured JSON.
${imageCount > 1 ? `You have ${imageCount} sequential pages. Merge split questions across pages.` : ''}
If the image is unreadable/blank, return empty array. Do NOT hallucinate.
${ocrSection}

## CRITICAL: Korean exam pages often have TWO COLUMNS
Scan BOTH columns. Each column may contain 2-4 problems stacked top-to-bottom.
EVERY printed question number (e.g. "22", "23", "24", "25") that BELONGS TO THIS PAGE MUST appear as a separate item in the output.
MISSING a problem number that belongs to this page is the most common failure — count them carefully and verify nothing is skipped.
BUT beware the opposite failure: a phone photo often catches a thin SLICE of an ADJACENT page at the top or bottom edge. A number printed in such a cut-off slice — where the question text/choices are mostly OUTSIDE the frame and you mainly see a number or a range-header (e.g. "[11~12]", "고난도 [11-12]") — does NOT belong to this page. Still output it, but set "is_fragment": true (Rule 9), and NEVER invent/guess the missing question body, choices, or answer for it.

## Rules
1. **Read directly from the image.** Extract ALL printed text verbatim. Do NOT summarize or skip any part.
2. Fields: passage (지문), visual_context (표/안내문), instruction (문제 지시문), question_body (빈칸 문장 등), choices (선택지)
3. Shared passages: extract ONCE, then use shared_passage_ref in subsequent problems.
4. No choices → choices: []. No fake choices.
5. Choices may appear as ①②③④⑤ statements embedded in a paragraph → extract each as a separate choice in the choices array.
6. For charts/notices/ads: use visual_context {type, title, content} to capture the visual element; put accompanying text in passage.
7. **problem_number is MANDATORY.** Read the bold printed number at the start of each question (e.g., "28", "29"). Never leave it blank. If a range like "[31~34]" appears, each sub-question still gets its own number.
8. **Coverage check.** Before finalizing output, scan the page once more and confirm: every printed bold number that starts a problem is included in items[]. If you find 3 problem numbers but extracted only 2 items, you missed one — re-extract.
9. **Fragment flag (guard against over-extraction).** For EVERY item, set "is_fragment": true ONLY when it is NOT a real, self-contained question on this page — i.e. it is cut off by the page boundary or bleeds in from an adjacent page, so all you can see is its number or a range-header (e.g. "[11~12]", "고난도 [11-12]") with essentially no real instruction, no choices, and no complete question sentence (a stray cut-off scrap like "a home." counts as fragment). A fully-visible question — one that has a real instruction, OR choices, OR a complete question sentence — MUST be "is_fragment": false. When in doubt, use false (keep it). NEVER set true merely because choices are absent: short-answer/서술형 questions legitimately have no choices and are NOT fragments.

## Output (JSON only, no markdown)
{
  "shared_passages": [{ "id": "43-45", "text": "..." }],
  "items": [{
    "problem_number": "25",
    "is_fragment": false,
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
  return `You are analyzing an English exam page image. Korean exam pages OFTEN have TWO COLUMNS (left and right). Treat columns independently.

Your task: For each problem (question) visible on this page, identify TWO regions:

1. "full_bbox": The ENTIRE PROBLEM REGION - from the problem number (e.g. "25.") down to just before the next problem number. Must include the problem's passage, instruction, question body AND all answer choices (①②③④⑤). Do NOT include the next problem.

2. "answer_area_bbox": The ANSWER CHOICE REGION ONLY - the rectangle that tightly encloses the ①②③④⑤ choice marks for THIS specific problem.
   - This is where the student physically marks (circles, underlines, ticks) one of ①②③④⑤.
   - It is USUALLY the BOTTOM portion of full_bbox — choices appear AFTER the passage/question text.
   - Add ~10-15% padding on all sides to capture handwritten marks that overflow.
   - Extend x1 leftward by ~30 normalized units to include the problem number column (students sometimes write the answer there).

## CRITICAL CONSTRAINTS (violating any of these = wrong answer)
A. answer_area_bbox MUST be FULLY CONTAINED inside its own full_bbox.
   - Required: full.x1 ≤ answer.x1 AND answer.x2 ≤ full.x2 AND full.y1 ≤ answer.y1 AND answer.y2 ≤ full.y2
B. answer_area_bbox MUST contain the actual ①②③④⑤ choice symbols for THIS problem. If the choices are at the bottom of full_bbox, then answer.y1 should be near full.y2 (e.g. answer.y1 ≈ full.y1 + 0.6*(full.y2-full.y1)).
C. NEVER place answer_area_bbox of problem A in the column or region of problem B. Pages with multiple problems on the SAME PAGE require careful column awareness:
   - If problem 25 is in the LEFT column, its answer_area_bbox MUST be in the LEFT column.
   - If problem 26 is in the RIGHT column, its answer_area_bbox MUST be in the RIGHT column.
D. The width of answer_area_bbox should approximately match the column width that contains the choices (NOT span the whole page).

## Algorithm (apply for each problem)
1. Locate the printed problem number (e.g. "25.", "26.").
2. Identify the column (left half x<500, or right half x≥500).
3. Find the bottom of the problem region (next problem number, or end of column).
4. full_bbox = rectangle from problem number top to just above next problem (within its column).
5. Within full_bbox, find the ①②③④⑤ choice region (usually near the bottom).
6. answer_area_bbox = that choice region + padding, FULLY INSIDE full_bbox, IN THE SAME COLUMN.

Coordinates: NORMALIZED 0-1000 (top-left=(0,0), bottom-right=(1000,1000)).

Output JSON only:
{
  "problems": [
    {
      "problem_number": "25",
      "full_bbox": { "x1": 50, "y1": 100, "x2": 500, "y2": 600 },
      "answer_area_bbox": { "x1": 30, "y1": 480, "x2": 520, "y2": 600 }
    }
  ]
}`;
}

export function buildCroppedUserAnswerPrompt(problemNumber, questionContext, isFullCrop = false) {
  // isFullCrop=true: answer_area_bbox가 마크를 놓쳐 user_answer가 null로 잡혔을 때,
  // 문제 전체 크롭(선택지 ①~⑤ 전부 포함, 2배 확대)에서 재독해하는 경우.
  const scopeLine = isFullCrop
    ? `You are analyzing a CROPPED and ZOOMED image showing the FULL problem (question text + all choices ①~⑤) for exam question Q${problemNumber}.
The student's mark may sit directly ON a choice number (a circle/check/underline around ①②③④⑤). Scan every choice number carefully.`
    : `You are analyzing a CROPPED and ZOOMED image of the ANSWER AREA for exam question Q${problemNumber}.
This image is zoomed into ONLY the answer marking region. Look very carefully for any handwritten marks.`;

  if (questionContext?.isSubjective) {
    const instruction = questionContext.instruction || '';
    const questionBody = questionContext.questionBody || '';
    const subjScope = isFullCrop
      ? `You are analyzing a CROPPED and ZOOMED image showing the FULL problem (question text + answer area) for exam question Q${problemNumber}.
The handwritten answer may span MULTIPLE lines anywhere in this crop — scan the ENTIRE image top-to-bottom and transcribe EVERY handwritten line in reading order (do not stop after the first line).`
      : `You are analyzing a CROPPED and ZOOMED image of the ANSWER AREA for exam question Q${problemNumber}.`;
    return `${subjScope}
This is a SHORT ANSWER / ESSAY type question (not multiple choice).
${instruction ? `\nInstruction: ${instruction}` : ''}
${questionBody ? `\nQuestion: ${questionBody}` : ''}

Your task: Transcribe ONLY what the student HANDWROTE to answer this question.

## Transcribe the student's HANDWRITING only (not printed text)
- Report ONLY the text the student wrote BY HAND (pen/pencil) in the blank/answer space.
- Do NOT include PRINTED text that was already on the page around the blank — e.g. printed dialogue tags "A:" / "B:", a printed "Yes," / "No," lead-in, the given part of the sentence, the instruction, or word-bank tokens. Those are NOT the student's answer.
- Test is handwritten-vs-printed, NOT the word itself: if the student wrote "Yes"/"No" (or any such word) BY HAND, DO include it; if it was already printed, exclude it.
- The student's answer is SHORT — just the word(s)/phrase they filled into the blank. A long printed sentence or printed dialogue line around the blank (e.g. "But I can play violin.", "at your house?", "the bank?") is part of the QUESTION, not the answer — never transcribe it.
- The blank is often a short gap in the MIDDLE of a printed line (e.g. "____ at the bank?", "You can't play piano ____."). Transcribe ONLY what the student inserted INTO the gap — do NOT carry over the printed words sitting just before or after the gap on the same line (here: exclude printed "at the bank?", "You can't play piano").
- Handwriting vs print is a VISUAL distinction: handwritten strokes are irregular, usually blue/black pen or pencil, often slanted or cursive; printed text is a uniform typeface. Transcribe ONLY the handwritten strokes. If the crop shows a 2-line A/B dialogue and BOTH lines contain handwriting, transcribe each line's handwriting in reading order — but NEVER the printed (typeface) portion of either line, and NEVER the other speaker's printed line.

## Worked examples — the exact mistake to avoid (study these)
- Printed line "A: ____ at the bank?" with handwriting "Doesn't he work" in the gap → user_answer is "Doesn't he work". WRONG: "Doesn't he work at the bank?" (the printed "at the bank?" was glued on). The single biggest error is attaching the FIRST printed word right after the gap (here "at") onto the handwriting — do NOT.
- Printed line "You can't play piano ____. But I can play violin." with handwriting "can you" → user_answer is "can you". WRONG: "can you. But I can play violin." (the printed tail was included).
- Dialogue "A: ____ ?  B: Yes, ____ ." where the student handwrote "Isn't I sleep" on A and "you can" on B → user_answer is "Isn't I sleep you can". WRONG: copying the printed "A:", "B:", "Yes," or the printed remainder of either line.
- Printed "Yes, ____ ____ . They are my classmates." with handwriting "they do" → user_answer is "they do". WRONG: "Yes, they do" (the printed "Yes," was included).

## Format & completeness
- Transcribe VERBATIM, preserving the student's own spelling/grammar mistakes. Do NOT correct them.
- Write it as ONE natural word/phrase/sentence with normal spaces between words, exactly as the student wrote it. NEVER break it into separate tokens divided by commas OR slashes (NOT "Can't / I / apply", NOT "they, do").
- Transcribe the FULL answer through to its end; do NOT stop partway (no truncation).
- If this question has multiple blanks (or A/B dialogue turns), transcribe each blank's handwriting in reading order joined by a single space — do NOT insert slashes between them.
- If the student crossed out text and rewrote it, report only the final version.
- If you see a correction arrow (→) (e.g., "cuting → cutting"), report ONLY the text after the arrow.
- If no handwritten answer is found, return null.

Output JSON only:
{ "problem_number": "${problemNumber}", "user_answer": "the student's handwritten answer" }`;
  }

  return `${scopeLine}

## Primary Rule: Detect the MARKED answer number
Your main goal is to find which choice number (1-5) the student marked/selected.
- Look for: circled numbers, checkmarks, underlines, pen strokes, pencil marks on or near a choice number
- Faint pencil marks, light circles, and small tick marks all count as valid marks
- For multiple choice (①②③④⑤): return the choice number ("1"-"5")
- EXCEPTION — sentence-PATTERN questions (문장 형식 고르기, choices written as "1형식".."5형식"): return the PATTERN NUMBER the student marked — if they circled "4형식", return "4" — NOT the slot/position index.

## Secondary Rule: Korean Exam Grading Marks (apply ONLY when clearly visible)
After exams, students sometimes mark their papers during answer-checking:
- If you see BOTH an X mark on one number AND an O/circle on a different number:
  The X-marked number = user_answer (student's original wrong choice)
  The O-marked number = the correct answer (marked later), NOT user_answer
- If you see ONLY circles/marks on ONE number (no X anywhere): that number IS user_answer
- Do NOT assume grading marks exist unless you clearly see both X and O on different numbers

## Output — precision over guessing
- Return the choice number "1"-"5" ONLY when you can clearly identify which SINGLE choice the mark belongs to.
- If NO handwritten mark is found at all, return null.
- If a mark seems present but you CANNOT confidently tell which single choice it sits on (faint, ambiguous, or spanning two numbers), return null — do NOT guess. A wrong answer is worse than null here.
- NEVER copy a solved/correct answer into user_answer; it must come from the physical pencil/pen mark only.

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

Your task: Solve the question and give the correct answer in the SAME UNIT the student is expected to write.

## CRITICAL: match the answer UNIT to what the student fills in
The correct_answer must line up with the student's handwriting so the two can be compared directly.
- BLANK-FILLING type (a printed sentence/dialogue with an underline / parentheses / ____ blank the student fills): give ONLY the text that goes INTO the blank. Do NOT repeat the printed words around the blank (dialogue tags "A:" / "B:", a printed "Yes," / "No," lead-in, the given part of the sentence). If there are multiple blanks, give each in reading order joined by a single space — do NOT insert slashes.
- WORD-ARRANGEMENT / SENTENCE-WRITING / TRANSFORMATION type (arrange the given words, or rewrite the sentence in a required form): give the COMPLETE finished sentence, correctly ordered.
  - NEVER output the word-bank tokens as a separate list divided by commas OR slashes (NOT "they, do", NOT "Didn't / she / go") — arrange them into the actual finished sentence. For example: write "Yes, they do" (not the tokens), or "Didn't she go home late yesterday?" (not "Didn't / she / go").
- GRAMMAR CORRECTION type (find and fix the error): give ONLY the corrected word or phrase, not the full sentence. If a correction arrow (→) is shown (e.g., "cuting → cutting"), give ONLY the text AFTER the arrow — never the pre-correction (misspelled) form, and never both joined together.

## Format & completeness
- Write ONE natural English word/phrase/sentence with normal spaces between words — NEVER a list of separate tokens divided by commas or slashes (NOT "Won't / my / grandma / cook"; write "Won't my grandma cook for me tonight?").
- Give the COMPLETE answer through to its end; do NOT truncate mid-phrase.
- Use the same surface form the student would write (do not prepend scaffolding the student wouldn't write).
- You MUST provide a correct_answer. Never return null.

Output JSON only:
{ "problem_number": "${problemNumber}", "correct_answer": "the correct answer text" }`;
  }

  const choicesHint = Array.isArray(questionContext?.choices) && questionContext.choices.length > 0
    ? `\n\n## Choices for this problem (use these to match):\n${questionContext.choices.map((c, i) => `${i + 1}. ${typeof c === 'string' ? c : (c.text || c.label || '')}`).join('\n')}`
    : '';

  return `You are analyzing a CROPPED image of exam question Q${problemNumber}.
This image shows the FULL problem: question text, passage, and answer choices.

## CRITICAL: MULTIPLE CHOICE = NUMBER ONLY
This is a MULTIPLE CHOICE question with numbered choices (①②③④⑤ or 1-5).
You MUST return ONLY the choice NUMBER as a plain ASCII Arabic digit ("1", "2", "3", "4", or "5").
NEVER output a circled/enclosed glyph (①②③④⑤) — always convert ①→"1", ②→"2", ③→"3", ④→"4", ⑤→"5".

## ⚠️ Underline-type questions (밑줄 친 부분 중...)
Korean exams often ask: "다음 글의 밑줄 친 부분 중, 문맥상 낱말의 쓰임이 적절하지 않은 것은?"
- Each underlined word/phrase is labeled with ①②③④⑤
- The answer is the CHOICE NUMBER of the incorrect underlined word, NOT the word itself
- WRONG: returning "appear" or "rise" (the underlined word)
- RIGHT: returning the choice number (e.g. "2") that marks that word — pick the number that actually corresponds to the answer, not a fixed value

## Algorithm
1. Read the question and identify the correct/incorrect choice
2. Find which numbered choice (1-5) corresponds to that answer
3. Return ONLY that number as a string

## Rules
- Solve the question independently to determine the correct answer
- For multiple choice (including underline-type): return the choice NUMBER as "1"-"5"
- NEVER return a word, phrase, or letter — ALWAYS a single digit "1"-"5"
- This applies to ALL numbered multiple-choice types — including sentence-insertion (문장 삽입), sentence-ordering (순서 배열), grammar (어법), and vocabulary/underline (어휘·밑줄) questions. For these, the choices ①②③④⑤ (or 1-5) indicate positions/options, and correct_answer MUST be that choice NUMBER.
- ⚠️ EXCEPTION — sentence-PATTERN questions (문장 형식 고르기): when the question asks "문장의 형식을 고르시오" and the choices are pattern labels like "1형식","2형식","3형식","4형식","5형식" (NOT ①②③④⑤-labeled statements), correct_answer is the PATTERN NUMBER itself, NOT the choice position. If the correct pattern is 5형식, return "5" — even when "5형식" is printed in the 1st or 2nd slot. Do NOT convert to ①②③ position order; read the digit out of the "N형식" label.
  When SOLVING for the correct pattern, apply: 1형식=S+V (자동사, e.g. sleep/go/arrive); 2형식=S+V+C (be·become·seem·감각동사 look/feel/sound + 보어 — a be-verb followed by a noun or adjective is 2형식, e.g. "She is my business partner"→2형식, NOT 3형식); 3형식=S+V+O (타동사+목적어 하나); 4형식=S+V+IO+DO (수여동사 give/buy/make/send/tell + 사람 + 사물); 5형식=S+V+O+OC (make/find/keep/call/leave + 목적어 + 목적격보어, e.g. "I found it difficult"→5형식, "keeps you healthy"→5형식).
- NEVER copy a sentence, clause, or excerpt from the passage into correct_answer. Even if the question is about inserting or reordering a sentence, output the choice NUMBER only — NOT the sentence text.
- The example output below uses a placeholder; do NOT copy its value. Determine the actual number by solving the question.
- You MUST provide a correct_answer. Never return null.${choicesHint}

Output JSON only:
{ "problem_number": "${problemNumber}", "correct_answer": "<the correct choice number 1-5>" }`;
}

export function buildHandwritingDetectionPrompt(imageCount = 1, focusNumbers = null) {
  const focusBlock = Array.isArray(focusNumbers) && focusNumbers.length > 0
    ? `\n<priority>
These problems still have NO detected user_answer — look EXTRA carefully for the student's handwritten mark (faint pencil circles, checkmarks, underlines, or X marks placed on or beside a choice number 1-5): ${focusNumbers.join(', ')}
For each, report the choice number ONLY if you can clearly identify which single choice the mark belongs to.
If a mark seems present but you cannot confidently tell which choice it is on, return null — do NOT guess. A wrong answer is worse than null here.
NEVER copy the solved correct_answer into user_answer; user_answer must come from the physical pencil/pen mark only.
</priority>\n`
    : '';
  return `
<role>You are an expert exam handwriting detection and solving system.</role>

<task>
For each problem number visible on the page(s):
1. Detect user_answer (what the student physically wrote/marked on paper)
2. Solve for correct_answer independently
</task>
${focusBlock}

<answer_format>
- Multiple choice (①②③④⑤ or numbered 1-5 choices): return the marked/correct choice NUMBER as a plain ASCII Arabic digit "1"-"5" (convert circled glyphs ①→"1" … ⑤→"5"; NEVER output ①②③④⑤)
- Underline-type multiple choice (e.g., "다음 글의 밑줄 친 부분 중, 문맥상 낱말의 쓰임이 적절하지 않은 것은?"):
  - Each underlined word is labeled with ①②③④⑤ in the original text
  - correct_answer MUST be the CHOICE NUMBER (a single digit "1"-"5" that you determine by solving), NOT the underlined word (e.g., NOT "appear")
- Sentence-PATTERN questions (문장 형식 고르기, choices written as "1형식".."5형식", NOT ①②③④⑤-labeled statements): BOTH user_answer and correct_answer are the PATTERN NUMBER itself. Student circled "4형식" → user_answer "4"; correct pattern 5형식 → correct_answer "5". Do NOT convert to a slot/position index (①②③); read the digit out of the "N형식" label.
  When SOLVING for the correct pattern, apply: 1형식=S+V (자동사); 2형식=S+V+C (be·become·seem·감각동사+보어 — a be-verb followed by a noun or adjective is 2형식, e.g. "She is my business partner"→2형식, NOT 3형식); 3형식=S+V+O; 4형식=S+V+IO+DO (수여동사 give/buy/make/send/tell + 사람 + 사물); 5형식=S+V+O+OC (make/find/keep/call/leave + 목적어 + 목적격보어, e.g. "I found it difficult"→5형식).
- Short answer / essay (서술형):
  - UNIT MATCHING (critical): for the SAME question, user_answer and correct_answer MUST be in the SAME unit/format so they can be compared directly (the student fills a blank → both are the blank's content; the student writes a whole sentence → both are the whole sentence).
  - user_answer: transcribe ONLY the student's HANDWRITING in the blank/answer space, VERBATIM (keep their spelling/grammar errors). Do NOT include printed text already on the page (dialogue tags "A:" / "B:", a printed "Yes," / "No," lead-in, the given part of the sentence, word-bank tokens) — unless the student wrote it by hand. The answer is SHORT (the handwritten fill-in); a long printed sentence or dialogue line around the blank is the QUESTION, not the answer — never transcribe it. The blank is often a gap in the MIDDLE of a printed line, or one line of an A/B dialogue — transcribe ONLY the handwritten strokes inserted into the gap (irregular pen/pencil, slanted/cursive), EXCLUDING the printed words before/after the gap and the other speaker's printed line. If a correction arrow (→) is present, report only the text after it. Multiple blanks → join in reading order with a single space (no slashes).
  - correct_answer: solve the question and answer in that SAME unit:
    - blank-filling: ONLY the text that goes into the blank (exclude the printed surrounding words); multiple blanks → joined in reading order with a single space (no slashes).
    - word-arrangement / sentence-writing / transformation: the COMPLETE finished sentence — NEVER the word-bank tokens as a separate list divided by commas or slashes (NOT "they, do", NOT "Can't / I / apply"; write the finished sentence like "Yes, they do").
    - grammar correction: ONLY the corrected word/phrase.
  - Write each answer as continuous natural text with normal spaces; give complete answers (no mid-phrase truncation), and NEVER break it into separate tokens divided by commas or slashes.
- If no mark found: return null for user_answer
</answer_format>

<critical_rules>
- For ANY multiple-choice question (including underline-type, sentence-insertion 문장 삽입, sentence-ordering 순서 배열, grammar 어법, vocabulary/underline 어휘·밑줄), correct_answer MUST be a plain ASCII Arabic digit "1"-"5" — NEVER a circled glyph (①②③④⑤); convert ①→"1", ②→"2", ③→"3", ④→"4", ⑤→"5"
- NEVER return a word/phrase as correct_answer for multiple choice — ALWAYS the choice number
- NEVER copy a sentence, clause, or excerpt from the passage into correct_answer. For sentence-insertion or ordering questions, the answer is the position/option NUMBER (①②③④⑤ → "1"-"5"), NOT the sentence text.
- user_answer = physical marks/writing on paper (do NOT correct spelling or grammar)
- correct_answer = your independent solution (the actually correct answer)
- Do NOT copy user_answer into correct_answer
- Do NOT copy the solved correct_answer into user_answer — user_answer must come from the physical pencil/pen mark only
- Grading-mark disambiguation: students sometimes self-grade AFTER the exam. If for one problem you see BOTH an X mark on one number AND an O/circle on a DIFFERENT number, the X-marked number = user_answer (their original choice); the O-marked number is the correct answer they added later — do NOT report that O as user_answer. If only marks on ONE number (no X), that number IS user_answer.
- user_answer precision: if a mark seems present but you cannot confidently tell which single choice it sits on (faint, ambiguous, or spanning two numbers), return null for user_answer — do NOT guess. A wrong answer is worse than null.
- Report ALL problems visible
- Phantom/cut-off guard: a problem NUMBER can appear WITHOUT its actual content — e.g. only a group header like "[11-12]" or "고난도 [11-12]", or a thin sliver sliced from an ADJACENT page at the photo's edge (number visible, but the question body/choices are not). If a number's question body and choices are NOT actually visible on the page, do NOT invent answers: return null for BOTH user_answer and correct_answer. Fabricating a correct_answer for content you cannot see is a confident-wrong error and is worse than null.
${imageCount > 1 ? `- You have ${imageCount} pages. Report each problem ONCE.` : ''}
</critical_rules>

Output JSON only (the answer values below are illustrative placeholders — solve each problem to get the real value; do NOT default to any single number):
{
  "marks": [
    { "problem_number": "1", "user_answer": "4", "correct_answer": "2" },
    { "problem_number": "2", "user_answer": "1", "correct_answer": "5" },
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

analysis: 문제에 대한 상세 분석 (한국어, 4~6문장, 서로 다른 학습 정보를 담아 반복 금지). 다음을 포함: (1) 이 문제가 무엇을 묻는지, (2) 정답의 근거가 되는 핵심 문법·어휘 규칙을 의미·작동 원리와 함께 설명, (3) 학습자가 흔히 틀리는 지점이나 함정, (4) 같은 규칙을 적용하는 짧은 예나 기억 팁. 단, 이미지에서 명확히 보이는 내용에만 근거하라 — 지문·선택지가 일부만 보이거나 불확실하면 단정하지 말고 일반 원리 수준으로 설명하라(틀린 단정은 비워두는 것보다 해롭다)`
    : `Difficulty levels:
- "high": High school level or above
- "medium": Middle school level
- "low": Elementary school level

Word difficulty (1-9):
- 1-3: Elementary level vocabulary
- 4-6: Middle school level vocabulary
- 7-9: High school level or above

analysis: Detailed analysis of the problem (in English, 4-6 sentences, each conveying distinct learning value — no repetition). Include: (1) what the problem is asking, (2) the key grammar/vocabulary rule behind the correct answer, explained with its meaning and how it works, (3) common mistakes or traps the learner should watch out for, (4) a short example applying the same rule or a memory tip. Base this ONLY on what is clearly visible in the image — if the passage/choices are partially shown or uncertain, do not assert specifics; explain at the general-principle level instead (a confident-wrong analysis is worse than a cautious one)`;

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

export function buildPrompt(classificationData, language = 'ko', imageCount = 1, ocrPages = []) {
  return buildStructurePrompt(imageCount, ocrPages);
}
