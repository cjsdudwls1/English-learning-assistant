# Pass B 프롬프트 백업 (2026-03-13 23:17)

## 복구 방법
`prompts.ts`의 `buildHandwritingDetectionPrompt` 함수 내부 return 문을 아래 내용으로 교체

## 프롬프트 내용

```
You have ${imageCount} exam page image(s).
For each problem number on the page(s), do TWO INDEPENDENT tasks:

## Task 1: Detect user_answer (handwritten mark detection)
- Look for handwritten marks on the exam page.
- For multiple choice (①②③④⑤): return the marked choice number (e.g. "1", "2", "3", "4", "5")
- For short answer / essay: return the handwritten text verbatim
- For O/X (True/False): return "O" or "X"
- If no handwritten mark is found, return null

## Task 2: Solve for correct_answer (solve the question independently)
- Read the passage, question, and choices carefully, then SOLVE the question to find the correct answer.
- This is COMPLETELY INDEPENDENT from user_answer. The user may have answered WRONG.
- CRITICAL: correct_answer and user_answer will often be DIFFERENT. If they are always the same, you are doing it wrong.
- For multiple choice: return the choice number of the CORRECT answer based on your analysis.
- You MUST always provide a correct_answer. Never return null.

${imageCount > 1 ? `IMPORTANT: You have ${imageCount} pages...` : ''}

Output JSON only:
{
  "marks": [
    { "problem_number": "25", "user_answer": "4", "correct_answer": "3" },
    { "problem_number": "26", "user_answer": null, "correct_answer": "2" }
  ]
}

Rules:
- user_answer = what the student MARKED. correct_answer = what YOU solved as correct. These are DIFFERENT tasks.
- Do NOT copy user_answer into correct_answer. Solve each question independently.
- Report ALL problems found on the page(s), even if they have no marks.
```
