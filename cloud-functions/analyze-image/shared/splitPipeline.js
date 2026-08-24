/**
 * 역할분리 3-호출 파이프라인 (SPLIT_PIPELINE)
 *
 * 2-스텝(simplePipeline)은 이미지를 보는 호출이 Step 1 단 하나였다. 그 한 번이 인쇄체 OCR,
 * 학생 연필 마크 판독, 교사 빨간펜 구분을 동시에 지시받는다. 셋은 난이도도 실패 양상도 달라
 * 한 프롬프트에 다 담으면 지시가 서로 간섭한다(그래서 실제로 5줄까지 깎여 있었다).
 *
 * 여기서는 이미지를 보는 호출을 역할별로 셋으로 나눈다.
 *
 *   Call 1 (구조)  이미지 → 문항번호·발문·지문·선택지·답형식. 손글씨는 무시하라고 명시.
 *                  스키마에 답 필드 자체가 없어 답을 낼 수 없다.
 *   Call 2 (학생답) 이미지 → user_answer만.
 *   Call 3 (정답)   이미지 → correct_answer만.
 *
 * **셋은 서로의 출력을 보지 않는다.** 각자 같은 이미지를 받아 자기 역할만 수행하고, 종합은
 * 코드(mergeCallResults)가 한다. 이것이 단순한 비용 증가가 아니라 구조적 이득인 이유:
 *
 *  1. 오염 차단 — 한 호출이 학생답과 정답을 동시에 내면 모델이 정답을 학생답 칸에 베낀다.
 *     구 프롬프트(prompts.js)가 "NEVER copy the solved answer into user_answer"를 네 군데서
 *     반복하는 것이 그 증거다. 호출이 분리되면 Call 2는 정답을 알지 못하므로 베낄 수가 없다.
 *  2. 전용 지시 — 각 호출이 자기 역할의 지시만 받는다. 학생답 호출은 필기 판독 노하우를,
 *     정답 호출은 풀이·정답표 규칙을 전부 받는다. 서로 희석되지 않는다.
 *  3. 오류 격리 — 한 호출의 실수가 다른 호출의 입력이 되지 않는다. 한때 Call 2·3에 Call 1의
 *     문항 목록을 넘겼는데(번호를 맞추려는 의도였다), 목록에 무엇을 담든 답이 오염됐다:
 *     선택지 원문을 담으면 Call 2가 마크 대신 스스로 푼 답을 냈고, 개수만 담으면("5 choices")
 *     프롬프트의 숫자 편중이 답을 그 숫자로 끌었다. 두 실측 모두 roster 주석에 남겼다.
 *
 * 번호는 세 호출이 각자 이미지에서 읽는다. 그래서 표기 규칙(bare "3", 섹션은 "A-1")을 세
 * 프롬프트가 공유하고, 남은 흔들림은 numKey가 흡수하며, 병합은 구조를 기준선으로 삼되
 * Call 2·3이 함께 본 번호는 구조가 놓쳤어도 살린다. 4-Pass는 크롭 bbox로 정합을 맞추려다
 * bbox가 틀리면 통째로 무너졌는데, 여기서는 크롭 없이 전체 이미지를 세 번 보낸다.
 *
 * 비용은 이미지 입력이 3배. 지연은 셋 다 병렬이라 1단계(+ 분류 Pass C).
 * 진입점(index.js runAnalysisPipeline)에서 SPLIT_PIPELINE 플래그로 스위치한다.
 */

import { generateWithRetry, extractTextFromResponse, parseJsonResponse } from './aiClient.js';
import { executePassC } from './passes.js';
import { normalizeItem, dedupeByNumber } from './simplePipeline.js';

/** 1순위 gemini-3.6-flash (2026-08-16 교체).
 *
 *  근거는 사용자 실측이다. 같은 이미지의 실제 학생 답이 `5145213`일 때
 *    - Gemini 웹(3.6-flash, 원본 이미지, thinking ON): `5144213` — 1개 오차
 *    - 프로덕션(3.5-flash, 1200px 압축, thinking OFF):  `5353215` — 4개 오차
 *  조건이 셋이나 달라 모델 단독 기여도는 분리되지 않지만, 웹에서 확인된 조합을
 *  프로덕션에서 재현하는 것이 지금 목표다.
 *
 *  폴백은 3.5-flash를 유지한다(직전까지 프로덕션에서 돌던 검증된 모델).
 *  3.6이 400·쿼터·회귀로 죽어도 어제 수준으로는 자동 복귀한다.
 *  ⚠️ 3.6은 temperature/top_p/top_k를 **거부하지 않고 조용히 무시한다**(실측: 400 아님, 200).
 *     그래서 잘못 보내도 증상이 없다 — aiClient의 NO_SAMPLING_PARAMS가 걸러주고
 *     재현성은 아래 SEED + THINKING_LEVEL이 맡는다. */
const STRUCTURE_MODEL_SEQUENCE = ['gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-3.1-flash-lite'];
const ANSWER_MODEL_SEQUENCE = ['gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-3.1-flash-lite'];

/** 호출별 출력 상한. 구조는 지문 전문을 담아 크고, 답은 문항당 몇 글자라 작다.
 *  JSON 모드(aiClient가 responseMimeType을 강제)라 자유텍스트만큼 폭주하지 않지만,
 *  2026-08-15 degeneration(197,293자) 전례가 있어 상한은 건다. */
const MAX_OUTPUT_TOKENS = {
  structure: { perImage: 8_192, cap: 32_768 },
  answer: { perImage: 4_096, cap: 16_384 },
};

const CALL_TIMEOUT_MS = 300_000;

/** 이 경로는 thinking을 명시적으로 high로 올린다.
 *
 *  근거: 전역 THINKING_BUDGET은 prod env에서 0이다. 지연을 25s→7.9s로 줄이려는 스위치인데,
 *  config.js 주석 스스로 "정확도 영향은 eval A/B 검증 후 prod 적용"이라 단서를 달아놨고
 *  그 검증은 이뤄지지 않았다. split의 세 호출은 정확도가 존재 이유다 — 특히 Call 3은
 *  문제를 실제로 푸는 추론 작업이라 thinking을 끄면 가장 크게 무너진다.
 *  사용자가 Gemini 웹에서 같은 프롬프트·같은 이미지로 얻은 "완벽한" 결과도 thinking이 켜진
 *  조건이었다. 웹과 조건을 맞추되, 정확도가 최우선이므로 한 단계 더 올린다.
 *
 *  thinking이 붙으면 호출당 baseline이 ~25s로 오른다(실측: 2장 세션 42s → 89s).
 *  high면 더 길어진다. aiClient 기본 타임아웃 90s로는 밀집 지문에서 폴백(약한 모델)로
 *  새기 쉬우므로 이 경로만 180s로 늘린다. 세 호출이 병렬이라 최악이 180s(+ Pass C)로,
 *  워커 상한 540s 안에 넉넉히 든다 — Call1 → (Call2 ∥ Call3) 2단계이던 때는 360s였다.
 *  바깥 callJson 타임아웃 300s > 이 값 > 기본 90s 순서를 유지할 것. */
const MODEL_TIMEOUT_MS = 180_000;
const THINKING_LEVEL = 'high';

/** 재현성 시드. 3.6 이후 세대는 temperature를 무시하므로(문서: "strip temperature/top_p/top_k",
 *  실측: T=0.0에서도 출력이 갈림) 같은 이미지가 실행마다 다른 답을 낼 수 있다.
 *  seed를 고정하면 "mostly deterministic"까지는 간다 — 공식 레퍼런스의 표현도 딱 그 정도다.
 *  실측상 seed 단독으로는 부족하고 thinkingLevel과 함께 고정해야 잡힌다(aiClient 주석의 표 참조).
 *
 *  값 자체에 의미는 없다. 바꾸면 결과가 달라질 수 있으니 정확도 실측 중에는 건드리지 말 것. */
const SEED = 42;

function tokenCap(kind, numImages) {
  const { perImage, cap } = MAX_OUTPUT_TOKENS[kind];
  return Math.min(perImage * Math.max(1, numImages), cap);
}

/**
 * Call 1 — 구조 추출. 인쇄된 문제만 읽는다.
 * export: 손글씨 배제 지시가 빠지면 Call 2·3의 전제가 무너지므로 테스트로 고정한다.
 */
export function buildParsePrompt(numImages) {
  const scope = numImages > 1 ? `${numImages} images` : 'an image';
  return `The following is ${scope} of a Korean English exam paper. Read **only the printed questions themselves** and structure them as JSON, one entry per item.

## Not part of this task
- **Completely ignore** handwritten answers: pencil circles, checks, underlines.
- **Completely ignore** red-pen grading marks (O/X, slashes, curves).
- **Do not decide** what the correct answer is. A later stage does that.
- Where handwriting overlaps printed characters, read **only the printed characters** underneath.

Output ONLY a JSON object in this shape (no markdown, no commentary):
{"items": [ <item>, ... ]}

Each <item>:
{
  "problem_number": string,   // item number, unique within the page (see rules). Never an empty string
  "passage": string|null,     // full passage text (repeat it on every item that shares it); null if none
  "visual_context": null | {"type": string, "title": string, "content": string},  // table/chart/notice; null if none
  "instruction": string|null, // the question prompt line
  "question_body": string|null, // extra body text that is not the passage; null if none
  "choices": [ {"label": "1".."5", "text": "..."} ],  // [] for free-response items
  "answer_format": "single" | "multi_select" | "multi_blank",
  "blank_count": number|null  // number of blanks when answer_format="multi_blank"; null otherwise
}

Rules:
- **Transcribe every string in its original language, exactly as printed.** Never translate,
  paraphrase or correct it — Korean prompts and passages stay in Korean, character for character.
- Write circled numerals (①②③④⑤) as ASCII digits (1..5) in \`label\`.
- Passages go in full per item, never summarized or truncated. Join a passage spanning several
  pages into one.
- Emit each problem_number exactly once (no duplicates).
- Number uniqueness: workbook drills (Unit Exercise and the like) restart numbering at 1 for each
  section (A, B, C...) on one page. There, prefix the section — "A-1", "B-2" — so numbers stay
  unique within the page. With no section, write the bare number ("3"). Never invent a section
  that isn't printed.
- **Do not miss a single item visible on the page.** That includes workbook drills with no exam
  numbering (e.g. "Let's Use It", pick-from-parentheses practice).
- Deciding answer_format:
  - "multi_select": a multiple-choice item whose prompt asks for two or more answers. Korean papers
    phrase this as "모두 고르시오", "정답 2개", "(단, 2개)", "두 개를 고르세요", "2개를 고르시오";
    English as "all that apply". **Any phrasing that states a count counts** — written as a digit
    ("2개") or as a Korean numeral word ("두 개"), treat them the same.
  - "multi_blank": a free-response item with several parenthesized blanks under it, like (1)(2)(3).
    Put the number of blanks in blank_count.
  - Everything else: "single".
- Order by item number.`;
}

/* 문항 목록(roster)을 Call 2·3에 넘기지 않는다 — 세 호출은 서로의 출력을 보지 않는다.
 *
 * 두 번 시도했고 두 번 다 실측에서 답을 오염시켰다.
 *   - 발문·선택지 원문을 실었을 때: Call 2가 문항을 풀 수 있게 되어 학생 마크 대신 자기가
 *     추론한 정답을 냈다(학생 ③ / 출력 ⑤ = 정답, 2회차 재현).
 *   - 선택지 개수만 남겼을 때("- Q39: 5 choices" × 7줄): 프롬프트 안의 숫자가 5로 편중되고
 *     (5가 14회, 나머지 3~8회) 답 형식이 마침 "1"–"5" 한 자리라, 오독한 문항이 전부 5로
 *     쏠렸다. 오독 1건 → 3건으로 늘었다.
 * 무엇을 넣든 같은 자리에서 새는 것이 요점이다. 목록은 Call 2에게 "이 칸을 채우라"는
 * 압력으로 작동하는데, 판독은 이미지에서 끝나야 하고 종이에 없는 정보는 답의 근거가 될 수 없다.
 *
 * 뺄 수 있는 이유:
 *   - 번호: 이미지에 인쇄돼 있다. 표기가 흔들려도 mergeCallResults의 numKey가 흡수한다.
 *   - 선택지 개수: answerFormatRules가 이미 범위("1"–"5")를 말한다. 중복이었다.
 *   - 형식 태그: 스칼라냐 배열이냐는 Call 1의 answer_format이 병합 때 정한다(normalizeItem).
 *     Call 2는 "칠해진 것을 전부" 보고하기만 하면 되고, 그건 이미지만 보고도 된다.
 */

/** 답 형식 공통 규칙 — Call 2·3이 같은 단위로 답해야 직접 비교가 된다.
 *  (구 prompts.js의 UNIT MATCHING 규칙: 서로 다른 단위로 나오면 비교 자체가 성립하지 않는다)
 *
 *  복수답 조건은 호출마다 근거가 다르다. 학생답은 **종이에 칠해진 개수**가, 정답은 **발문이
 *  요구하는 개수**가 정한다. 예전에는 Call 1이 붙인 [MULTI-SELECT] 태그로 양쪽을 한꺼번에
 *  지시했는데, 태그를 넘기려면 roster가 필요했다(위 주석 참고). 각자 이미지에서 읽게 한다. */
function answerFormatRules(field) {
  const isUser = field === 'user_answer';
  const arrField = isUser ? 'user_answers' : 'correct_answers';
  const multiWhen = isUser
    ? `If the student marked **two or more** numbers on one item and neither is crossed out, that is a
  multiple-answer item — not a correction. Put every marked number in`
    : `If the prompt asks for two or more answers ("모두 고르시오", "정답 2개", "두 개를 고르세요",
  "all that apply"), put every correct number in`;
  return `## Answer format
- Multiple choice (①②③④⑤ or numbered choices 1–5): **a single ASCII digit** ("1"–"5"). Never emit
  the circled numeral itself — always convert ①→"1" … ⑤→"5".
- Underline-type MC ("밑줄 친 부분 중 …적절하지 않은 것은?"), sentence insertion, ordering, grammar
  and vocabulary items all answer with the **choice number**. Do not copy out the underlined word
  ("appear") or a sentence from the passage.
- Sentence-pattern items (choices labeled "1형식".."5형식"): **read the digit in the label**, not the
  position of the box. If "5형식" sits in the first box the answer is still "5".
- Pick-in-parentheses (grammar choice such as "(who/which)"): answer with the **word itself**, spelled
  exactly as printed, not a number. A digit here is a guaranteed miss.
- Free response: only what fills the blank, as one natural chunk. Do not chop it up with commas or
  slashes (NOT "they, do", NOT "Didn't / she / go" → "Yes, they do", "Didn't she go home late yesterday?").
- ${multiWhen} ${arrField} as an ascending array of strings (e.g. ["1","2"]),
  and also join them in the ${field} scalar as "1, 2". Reporting one and stopping makes the whole
  item count as wrong.
- Free-response items with several parenthesized blanks under them, like (1)(2)(3): put one entry per
  blank in ${arrField} in blank order (null for a blank you cannot fill), and also fill the ${field}
  scalar as "(1) … (2) …".`;
}

/**
 * Call 2 — 학생이 종이에 남긴 흔적만 읽는다.
 * export: 이 프롬프트의 판독 지시가 이 파이프라인의 존재 이유다. 누락을 테스트로 잡는다.
 *
 * 길이를 의도적으로 억제한다. 이 프롬프트의 조상(prompts.js)은 한 호출이 문제·학생답·정답을
 * 동시에 내던 시절의 방어 문구가 층층이 쌓여 있었는데, 그중 상당수는 호출을 나눈 지금
 * **스키마가 이미 막는 것**이다 — Call 2의 응답 스키마에는 correct_answer 자리가 없으므로
 * "정답을 판단하지 마라"를 여러 줄로 반복할 이유가 없다. 금지 문구가 많을수록 모델은
 * 그 개념을 오히려 붙잡고, 정작 "무엇을 보라"는 지시가 묻힌다.
 * 여기 남긴 것은 두 부류뿐이다: (1) 실측 오답을 직접 겨냥한 것(VERBATIM·흐린 마크·복수정답·
 * 자체 풀이 금지), (2) 스키마로는 막을 수 없는 것(인쇄된 정답표를 user_answer 칸에 옮기는 오염).
 * 새 지시를 추가할 때는 둘 중 어디에 속하는지 먼저 답할 것.
 *
 * "Do not solve the items"는 부류 (1)이다. 스키마에 correct_answer 자리가 없어도 **정답과 같은
 * 값을 user_answer 칸에 적는 것**은 막지 못한다 — 실측에서 학생이 ③에 마크한 문항을 두 회차 연속
 * ⑤(=정답)로 냈고, 하필 정답과 같아 is_correct=true로 저장되어 오답이 정답으로 기록됐다.
 * 같은 사건을 겨냥해 Call 1의 문항 목록 자체를 끊었다(위 roster 주석 참고): 지시로 말리는 것과
 * 근거를 아예 주지 않는 것을 함께 건다. 이 호출에 들어가는 것은 이미지와 판독 지시뿐이다.
 */
export function buildUserAnswerPrompt(numImages) {
  const scope = numImages > 1 ? `${numImages} images` : 'an image';
  return `The following is ${scope} of an English exam paper a student has worked through.
Your single job is to read **the marks the student physically left on the paper**. Even if a
printed answer key or explanation appears on the page, that is not the student's mark; do not copy it.

## Do not solve the items
- **Never work out which choice is correct.** If you catch yourself weighing the choices against the
  passage, you have left your job — another call does that, and here it produces a wrong answer.
- A mark that differs from the correct answer is the **normal, expected case**; it is the whole reason
  this paper is worth reading. If the student wrote it wrong, reporting it wrong is the correct output.
- Report the number the pencil touched even when you are confident that number is wrong.

## What counts as the student's mark
- **Pencil, black or blue ballpoint** with irregular strokes — this alone is the answer.
- **Red pen** (circles, slashes, curves, O/X) — the teacher's grading. It is the boldest thing on the
  page and catches the eye first, but it is not the answer.
- **Printed type** (uniform typeface) — the question itself.
- **Text ghosting through from the back of the sheet** — not a mark. It washes out the contrast around
  a light pencil arc, so a column that looks murky needs a closer look, not a null.

## Reading the marks
- Inspect choices ①②③④⑤ **one at a time** before deciding. Do not stop at the first mark you notice.
- **Faint pencil traces, light circles and small tick marks all count as valid marks.**
- A hand-drawn loop around a number is the signal and it **does not have to close**. The common case
  is a bare arc — a "(" hugging the number's left side, a half circle, a curve that stops short. That
  arc picks its number exactly as a closed loop does; do not discount it for being open or faint.
- A slash through a number cancels it; an arrow means the number it lands on is the final answer.
- A long vertical curve dividing the left and right choice columns is a layout divider.
- If the student self-graded and put X and O on **different** numbers, the X marks the student's answer.

## Free response
- Copy only the handwritten strokes, and **never correct spelling or grammar** — if they wrote
  "beetween", the answer is "beetween". Transcribe in the original language, exactly as written.
- Leave out characters that were already printed around the blank ("A:"/"B:", "Yes,", a given
  sentence fragment, a word bank).
- If they erased and rewrote, take the final version. For several blanks, join them in reading order
  with a single space.

${answerFormatRules('user_answer')}

## Which items to report
- Work down the page and report **every item you can see**. No list is given — the page is the only
  source, and an item you skip is lost for good.
- Read each item number **as printed next to it**. Write it bare ("3"). Workbook drills that restart
  at 1 in every section (A, B, C…) take the section prefix — "A-1", "B-2" — so numbers stay unique
  on the page. Never invent a section that isn't printed.
- An item the student left blank still gets a row, with user_answer null. But null means you looked
  and the item carries **no hand-drawn stroke at all**. It is not the safe answer for a mark you find
  hard to read — a faint or half-drawn arc still names a number, so report that number. Going null on
  an item the student did mark loses the answer just as surely as dropping the row.

Output ONLY a JSON object in this shape (no markdown, no commentary):
{"answers": [
  {"problem_number": "3", "user_answer": "2", "user_answers": null, "user_marked_correctness": null}
]}
- user_answers: fill as an array only for MULTI-SELECT / MULTI-BLANK items; null otherwise.
- user_marked_correctness: "O" or "X" if a grading mark is visible on that item, else null.
- The values above are placeholders. Read the actual marks. Include every item without exception.`;
}

/**
 * Call 3 — 정답만 구한다. 학생 마크는 근거로 쓰지 않는다.
 * export: 학생 마크 배제 지시가 빠지면 Call 2와의 독립성이 무너진다 — 테스트로 고정.
 *
 * Call 1의 문항 목록을 받지 않는다. 이 호출은 문항을 실제로 푸는 것이 임무라 발문·선택지가
 * 근거인데, 그 원문은 이미지에 있다 — 목록으로 받으면 Call 1의 OCR 오류가 근거로 승격되고
 * (선택지 60자 절단본까지 그대로 들어갔다), 목록 자체가 답을 특정 값으로 끄는 부작용이 있다
 * (roster 주석의 "5 choices" 실측). 세 호출이 같은 이미지를 각자 읽는 것이 이 설계의 요점이다.
 */
export function buildCorrectAnswerPrompt(numImages) {
  const scope = numImages > 1 ? `${numImages} images` : 'an image';
  return `The following is ${scope} of an English exam paper.
Your single job is to establish the **actual correct answer** for each item.

## Absolute rule — the student's answer is not evidence
- The circles and checks the student drew in pencil **may be wrong.** Do not copy them as correct.
- Establish the answer from, in this order: (1) an answer key or explanation printed on the page,
  (2) the teacher's red-pen grading, (3) solving it yourself. The student's pencil marks are not evidence.
- A teacher's red O on a number means that number is correct. Conversely, an X on the student's
  answer means that answer is not correct.

## If no answer is printed, solve it yourself
- Read the passage and the choices and actually work the item out.
- For sentence-pattern items (choices labeled "1형식".."5형식") apply: Pattern 1 = S+V (intransitive
  sleep/go/arrive); Pattern 2 = S+V+C (be, become, seem, sense verbs look/feel/sound + complement —
  a noun or adjective after \`be\` makes it Pattern 2: "She is my business partner" → 2형식, not 3형식);
  Pattern 3 = S+V+O; Pattern 4 = S+V+IO+DO (ditransitive give/buy/make/send/tell + person + thing);
  Pattern 5 = S+V+O+OC (make/find/keep/call/leave + object + object complement: "I found it difficult"
  → 5형식, "keeps you healthy" → 5형식).

${answerFormatRules('correct_answer')}

## Do not invent
- If only an item number is visible and the actual content (prompt, choices, passage) is not on the
  page — a cropped page fragment, a group header like "[11-12]" — return null. Manufacturing an answer
  for content you cannot see is a guaranteed miss and worse than null.
- In every other case, always produce an answer.

## Which items to answer
- Work down the page and answer **every item you can see**. No list is given — the page is the only
  source, and an item you skip is lost for good.
- Read each item number **as printed next to it**. Write it bare ("3"). Workbook drills that restart
  at 1 in every section (A, B, C…) take the section prefix — "A-1", "B-2" — so numbers stay unique
  on the page. Never invent a section that isn't printed.

Output ONLY a JSON object in this shape (no markdown, no commentary):
{"answers": [
  {"problem_number": "3", "correct_answer": "2", "correct_answers": null}
]}
- correct_answers: fill as an array only for MULTI-SELECT / MULTI-BLANK items; null otherwise.
- The values above are placeholders. Solve them for real. Include every item without exception.`;
}

/** 이미지 파트 생성. 세 호출이 각자 같은 이미지를 받는다(크롭 없음). */
function imageParts(images) {
  return images.map((img) => ({ inlineData: { data: img.imageBase64, mimeType: img.mimeType } }));
}

/** 모델 시퀀스를 순회하며 JSON 응답을 받는다. 자체 타임아웃 + 폴백.
 *  @param pick 파싱된 JSON에서 배열을 꺼내는 함수. 빈 배열이면 다음 모델로 폴백한다. */
async function callJson({ ai, sessionId, parts, sequence, maxOutputTokens, pick, label }) {
  let lastErr = null;
  for (const model of sequence) {
    try {
      let timeoutHandle;
      const timeoutPromise = new Promise((_, rej) => {
        timeoutHandle = setTimeout(
          () => rej(new Error(`${label} timeout ${CALL_TIMEOUT_MS / 1000}s`)),
          CALL_TIMEOUT_MS,
        );
      });
      let response;
      try {
        ({ response } = await Promise.race([
          generateWithRetry({
            ai, model,
            contents: [{ role: 'user', parts }],
            sessionId, maxRetries: 2, baseDelayMs: 2000, temperature: 0.0, maxOutputTokens,
            // 전역 THINKING_BUDGET(=0)을 무시하고 thinking을 high로 고정한다. 위 주석 참조.
            // temperature는 3.6에서 무시되므로(aiClient가 걸러낸다) 재현성은 seed가 맡는다.
            thinkingLevel: THINKING_LEVEL,
            seed: SEED,
            timeoutMs: MODEL_TIMEOUT_MS,
          }),
          timeoutPromise,
        ]));
      } finally {
        clearTimeout(timeoutHandle);
      }
      const text = extractTextFromResponse(response, model);
      const parsed = parseJsonResponse(text, model);
      const arr = pick(parsed);
      if (Array.isArray(arr) && arr.length > 0) return { rows: arr, usedModel: model };
      console.warn(`[splitPipeline] ${label} ${model} 0건 → 폴백`, { sessionId });
    } catch (e) {
      lastErr = e;
      console.error(`[splitPipeline] ${label} ${model}: ${e?.message}`, { sessionId });
    }
  }
  if (lastErr) throw lastErr;
  return { rows: [], usedModel: sequence[0] };
}

/** Call 1: 이미지 → 문제 구조(답 없음). */
export async function parseStructure({ ai, sessionId, images }) {
  const parts = [{ text: buildParsePrompt(images.length) }, ...imageParts(images)];
  return callJson({
    ai, sessionId, parts,
    sequence: STRUCTURE_MODEL_SEQUENCE,
    maxOutputTokens: tokenCap('structure', images.length),
    pick: (p) => (Array.isArray(p) ? p : (p?.items || p?.problems || [])),
    label: 'Call1(구조)',
  });
}

/** Call 2: 이미지 → 학생 마크. Call 1의 결과를 받지 않는다(독립 호출). */
export async function detectUserAnswers({ ai, sessionId, images }) {
  const parts = [{ text: buildUserAnswerPrompt(images.length) }, ...imageParts(images)];
  return callJson({
    ai, sessionId, parts,
    sequence: ANSWER_MODEL_SEQUENCE,
    maxOutputTokens: tokenCap('answer', images.length),
    pick: (p) => (Array.isArray(p) ? p : (p?.answers || p?.items || [])),
    label: 'Call2(학생답)',
  });
}

/** Call 3: 이미지 → 정답. Call 1의 결과를 받지 않는다(독립 호출). */
export async function solveCorrectAnswers({ ai, sessionId, images }) {
  const parts = [{ text: buildCorrectAnswerPrompt(images.length) }, ...imageParts(images)];
  return callJson({
    ai, sessionId, parts,
    sequence: ANSWER_MODEL_SEQUENCE,
    maxOutputTokens: tokenCap('answer', images.length),
    pick: (p) => (Array.isArray(p) ? p : (p?.answers || p?.items || [])),
    label: 'Call3(정답)',
  });
}

/** 문항번호 정규화 — 세 호출의 표기가 미세하게 달라도("Q3", "3.", " 3") 같은 문항으로 묶는다.
 *  Call 1 목록을 그대로 쓰라고 지시하지만 모델이 장식을 붙이는 일이 있어 백스톱을 둔다. */
function numKey(v) {
  return String(v ?? '').trim().replace(/^[Qq]\s*/, '').replace(/[.)\s]+$/, '').toLowerCase();
}

/**
 * 세 호출 결과를 problem_number로 병합.
 *
 * 구조(Call 1)가 기준선이되 **유일한 근거는 아니다.** 세 호출이 각자 이미지를 읽으므로 번호
 * 집합이 어긋날 수 있는데, 예전처럼 구조에 없는 번호를 전부 버리면 Call 1의 누락 하나가
 * Call 2·3이 정확히 읽은 답까지 같이 버린다. 그렇다고 한쪽만 본 번호를 받으면 환각이 그대로
 * 들어온다. 그래서 **Call 2·3이 둘 다 같은 번호를 냈을 때만** 구제한다 — 서로를 모르는 두
 * 호출이 같은 번호에 도달했다면 그 문항은 종이에 있다고 보는 것이 합리적이다.
 * 구제된 행에는 발문·선택지·지문이 없다(구조를 못 읽었으므로). 답만이라도 남기는 쪽이
 * 통째로 사라지는 것보다 낫다는 판단이고, hasContent가 답만 있는 행도 살려 보낸다.
 *
 * export: 병합 규칙은 순수함수라 모델 호출 없이 테스트할 수 있다.
 */
export function mergeCallResults({ structureRows, userRows, correctRows }) {
  const index = (rows) => {
    const m = new Map();
    for (const r of rows || []) {
      const k = numKey(r?.problem_number);
      if (k && !m.has(k)) m.set(k, r);
    }
    return m;
  };
  const userByNum = index(userRows);
  const correctByNum = index(correctRows);

  // normalizeItem이 소비하는 형태로 합친다. answer_format은 구조(발문 근거)가 정하고
  // 답 호출은 그 형식에 맞춰 값만 채운다 — 형식과 값을 다른 근거로 정하는 것이 요점이다.
  const join = (s) => {
    const k = numKey(s?.problem_number);
    const u = userByNum.get(k) || {};
    const c = correctByNum.get(k) || {};
    return {
      ...s,
      user_answer: u.user_answer ?? null,
      user_answers: Array.isArray(u.user_answers) ? u.user_answers : null,
      user_marked_correctness: u.user_marked_correctness ?? null,
      correct_answer: c.correct_answer ?? null,
      correct_answers: Array.isArray(c.correct_answers) ? c.correct_answers : null,
    };
  };

  const merged = (structureRows || []).map(join);

  const known = new Set();
  for (const s of structureRows || []) {
    const k = numKey(s?.problem_number);
    if (k) known.add(k);
  }
  for (const [k, u] of userByNum) {
    if (known.has(k) || !correctByNum.has(k)) continue;
    merged.push(join({ problem_number: u.problem_number }));
    known.add(k);
  }

  return merged;
}

/**
 * 역할분리 파이프라인 실행: (구조 ∥ 학생답 ∥ 정답) 3중 병렬 → 병합 → (옵션)분류.
 * runSimpleExtractAndStructure와 반환 계약을 맞춘다(items/usedModel/structModel) —
 * 호출처(index.js·eval pipeline-runner)가 두 파이프라인을 같은 모양으로 소비한다.
 *
 * @returns {{items: object[], usedModel: string, structModel: string,
 *            userModel: string, correctModel: string}}
 */
export async function runSplitPipeline({
  ai, sessionId, images, taxonomyData, userLanguage = 'ko', runClassification = true,
}) {
  // Call 1·2·3: 서로의 출력을 보지 않으므로 셋을 한꺼번에 띄운다. 지연이
  // (구조 + max(학생답, 정답))에서 max(셋)으로 줄어든다 — 예전에 Call 2·3이 구조를
  // 기다린 것은 문항 목록을 넘기기 위해서였고, 그 목록을 끊은 지금 기다릴 이유가 없다.
  // 하나가 실패해도 나머지는 살린다: 구조가 없어도 답만으로 남길 가치가 있고, 답이 없어도
  // 문항 자체는 저장할 가치가 있다.
  const [structRes, userRes, correctRes] = await Promise.allSettled([
    parseStructure({ ai, sessionId, images }),
    detectUserAnswers({ ai, sessionId, images }),
    solveCorrectAnswers({ ai, sessionId, images }),
  ]);
  if (structRes.status === 'rejected') {
    console.error(`[splitPipeline] Call1(구조) 실패: ${structRes.reason?.message}`, { sessionId });
  }
  if (userRes.status === 'rejected') {
    console.error(`[splitPipeline] Call2(학생답) 실패: ${userRes.reason?.message}`, { sessionId });
  }
  if (correctRes.status === 'rejected') {
    console.error(`[splitPipeline] Call3(정답) 실패: ${correctRes.reason?.message}`, { sessionId });
  }
  const structureRows = structRes.status === 'fulfilled' ? structRes.value.rows : [];
  const userRows = userRes.status === 'fulfilled' ? userRes.value.rows : [];
  const correctRows = correctRes.status === 'fulfilled' ? correctRes.value.rows : [];
  const structModel = structRes.status === 'fulfilled' ? structRes.value.usedModel : '';
  const userModel = userRes.status === 'fulfilled' ? userRes.value.usedModel : '';
  const correctModel = correctRes.status === 'fulfilled' ? correctRes.value.usedModel : '';
  console.log(
    `[splitPipeline] 이미지 ${images.length}장 · Call1 구조 ${structureRows.length}문항(model=${structModel || '실패'})`
    + ` · Call2 학생답 ${userRows.length}건(model=${userModel || '실패'})`
    + ` · Call3 정답 ${correctRows.length}건(model=${correctModel || '실패'})`,
    { sessionId },
  );

  const merged = mergeCallResults({ structureRows, userRows, correctRows });
  if (merged.length > structureRows.length) {
    console.log(
      `[splitPipeline] 구조가 놓친 ${merged.length - structureRows.length}문항 구제(Call2·3이 둘 다 본 번호)`,
      { sessionId },
    );
  }
  const normalized = merged.map(normalizeItem).filter(Boolean);

  // 번호 없는 교재 연습문제(Let's Use It 등) 유지 — simplePipeline과 동일 백스톱.
  let fallbackSeq = 0;
  const hasContent = (it) => Boolean(
    (it.instruction && it.instruction.trim()) || (it.choices && it.choices.length)
    || (it.passage && it.passage.trim()) || it.user_answer || it.correct_answer
    || (Array.isArray(it.correct_answers) && it.correct_answers.some((v) => v != null))
    || (Array.isArray(it.user_answers) && it.user_answers.some((v) => v != null)),
  );
  for (const it of normalized) {
    const hasNum = it.problem_number != null && String(it.problem_number).trim() !== '';
    if (!hasNum && hasContent(it)) it.problem_number = `연습 ${++fallbackSeq}`;
  }
  const substantive = normalized.filter((it) => it.problem_number != null && String(it.problem_number).trim() !== '');
  const items = dedupeByNumber(substantive);
  console.log(`[splitPipeline] 병합 ${normalized.length}→${items.length}문항(중복제거)`, { sessionId });

  if (runClassification && items.length > 0) {
    try {
      const passC = await executePassC({ ai, sessionId, taxonomyData, pageItems: items, userLanguage });
      for (const cls of (passC.classifications || [])) {
        const m = items.find((p) => String(p.problem_number) === String(cls.problem_number));
        if (m) {
          if (cls.classification) m.classification = cls.classification;
          if (cls.metadata) m.metadata = cls.metadata;
        }
      }
      console.log(`[splitPipeline] Pass C: ${(passC.classifications || []).length}개 분류`, { sessionId });
    } catch (e) {
      console.error(`[splitPipeline] Pass C 분류 실패(추출 결과는 유지): ${e?.message}`, { sessionId });
    }
  }

  // usedModel은 계약상 "이미지를 읽은 주 모델" — 여기서는 구조 호출이 그 역할이다.
  // 구조가 실패해도 답 호출로 문항이 남을 수 있으므로, 빈 문자열 대신 실제로 읽은 모델을 준다.
  return {
    items, usedModel: structModel || userModel || correctModel, structModel, userModel, correctModel,
  };
}
