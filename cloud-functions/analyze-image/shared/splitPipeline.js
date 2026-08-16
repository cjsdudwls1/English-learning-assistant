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
 *   Call 2 (학생답) 이미지 + Call 1 문항목록 → user_answer만.
 *   Call 3 (정답)   이미지 + Call 1 문항목록 → correct_answer만.
 *
 * Call 2·3은 서로를 모르고 병렬로 돈다. 이것이 단순한 비용 증가가 아니라 구조적 이득인 이유:
 *
 *  1. 오염 차단 — 한 호출이 학생답과 정답을 동시에 내면 모델이 정답을 학생답 칸에 베낀다.
 *     구 프롬프트(prompts.js)가 "NEVER copy the solved answer into user_answer"를 네 군데서
 *     반복하는 것이 그 증거다. 호출이 분리되면 Call 2는 정답을 알지 못하므로 베낄 수가 없다.
 *  2. 전용 지시 — 각 호출이 자기 역할의 지시만 받는다. 학생답 호출은 필기 판독 노하우를,
 *     정답 호출은 풀이·정답표 규칙을 전부 받는다. 서로 희석되지 않는다.
 *  3. 번호 정합 — Call 2·3이 Call 1의 문항 목록을 받아 "이 목록의 답만 채우는" 형태라
 *     세 결과의 problem_number가 어긋날 수 없다. 4-Pass는 크롭 bbox로 이걸 맞추려다
 *     bbox가 틀리면 통째로 무너졌는데, 여기서는 크롭 없이 전체 이미지를 세 번 보낸다.
 *
 * 비용은 이미지 입력이 3배. 지연은 Call 2·3 병렬이라 2단계.
 * 진입점(index.js runAnalysisPipeline)에서 SPLIT_PIPELINE 플래그로 스위치한다.
 */

import { generateWithRetry, extractTextFromResponse, parseJsonResponse } from './aiClient.js';
import { executePassC } from './passes.js';
import { normalizeItem, dedupeByNumber } from './simplePipeline.js';

const STRUCTURE_MODEL_SEQUENCE = ['gemini-3.5-flash', 'gemini-3.1-flash-lite'];
const ANSWER_MODEL_SEQUENCE = ['gemini-3.5-flash', 'gemini-3.1-flash-lite'];

/** 호출별 출력 상한. 구조는 지문 전문을 담아 크고, 답은 문항당 몇 글자라 작다.
 *  JSON 모드(aiClient가 responseMimeType을 강제)라 자유텍스트만큼 폭주하지 않지만,
 *  2026-08-15 degeneration(197,293자) 전례가 있어 상한은 건다. */
const MAX_OUTPUT_TOKENS = {
  structure: { perImage: 8_192, cap: 32_768 },
  answer: { perImage: 4_096, cap: 16_384 },
};

const CALL_TIMEOUT_MS = 300_000;

function tokenCap(kind, numImages) {
  const { perImage, cap } = MAX_OUTPUT_TOKENS[kind];
  return Math.min(perImage * Math.max(1, numImages), cap);
}

/**
 * Call 1 — 구조 추출. 인쇄된 문제만 읽는다.
 * export: 손글씨 배제 지시가 빠지면 Call 2·3의 전제가 무너지므로 테스트로 고정한다.
 */
export function buildParsePrompt(numImages) {
  const scope = numImages > 1 ? `이미지 ${numImages}장` : '이미지';
  return `다음은 영어 시험지(문제지) ${scope}이다. **인쇄되어 있는 문제 자체**만 읽어서 문항별 JSON으로 구조화하라.

## 이 작업에서 하지 않는 것
- 학생이 손으로 쓴 답, 연필 동그라미·체크·밑줄은 **완전히 무시**한다.
- 교사가 빨간펜으로 그은 채점 표시(O/X, 사선, 곡선)도 **완전히 무시**한다.
- 정답이 무엇인지 **판단하지 않는다**. 그건 다른 단계에서 한다.
- 필기가 인쇄 글자 위에 겹쳐 있으면, 그 아래의 **인쇄 글자만** 읽어라.

반드시 아래 형식의 JSON 객체만 출력하라(마크다운/설명 금지):
{"items": [ <item>, ... ]}

각 <item>:
{
  "problem_number": string,   // 문항 번호. 페이지 안에서 고유해야 한다(아래 규칙). 빈 문자열 금지
  "passage": string|null,     // 지문 전문(공유 지문이면 각 문항에 반복). 없으면 null
  "visual_context": null | {"type": string, "title": string, "content": string},  // 표/그래프/안내문. 없으면 null
  "instruction": string|null, // 발문
  "question_body": string|null, // 지문 아닌 추가 본문. 없으면 null
  "choices": [ {"label": "1".."5", "text": "..."} ],  // 서술형이면 []
  "answer_format": "single" | "multi_select" | "multi_blank",
  "blank_count": number|null  // answer_format="multi_blank"일 때 빈칸 개수. 그 외 null
}

규칙:
- 선택지의 원문자(①②③④⑤)는 label에 ASCII 숫자(1..5)로 적는다.
- 지문은 요약·절삭 없이 문항별 전문으로. 여러 페이지에 걸친 지문은 하나로 이어 붙인다.
- 같은 문항 번호는 반드시 한 번만 출력한다(중복 금지).
- 문항 번호 고유성: 교재 연습(Unit Exercise 등)은 한 페이지 안에서 A·B·C 같은 구획마다 번호가
  1부터 다시 시작한다. 이때 problem_number를 "A-1", "B-2"처럼 구획 기호를 붙여 페이지 안에서
  겹치지 않게 한다. 구획이 없으면 번호만 적는다("3"). 없는 구획을 지어내지는 마라.
- **페이지에 보이는 모든 문항을 하나도 빠뜨리지 마라.** 시험 번호가 없는 교재 연습문제
  (예: "Let's Use It", 괄호에서 고르기 연습 등)도 반드시 포함한다.
- answer_format 판정:
  - "multi_select": 발문이 답을 둘 이상 고르라고 지시한 객관식. "모두 고르시오", "정답 2개",
    "(단, 2개)", "두 개를 고르세요", "2개를 고르시오", "all that apply" 등 **개수를 명시한 모든 표현**을
    포함한다 — 숫자로 적혔든("2개") 한글 수사로 적혔든("두 개") 똑같이 취급한다.
  - "multi_blank": 한 문항 아래에 (1)(2)(3)처럼 괄호 번호가 붙은 빈칸이 여러 개인 서술형.
    blank_count에 빈칸 개수를 적는다.
  - 그 외 전부 "single".
- 문항 번호 순서대로 정리한다.`;
}

/** Call 2·3 프롬프트에 넣을 문항 목록. 지문 전문은 넣지 않는다 — 이미지에 있고,
 *  넣으면 프롬프트가 비대해져 정작 중요한 판독 지시가 묻힌다. 답을 어느 칸에 어떤
 *  형식으로 채울지 알기에 필요한 최소치(번호·발문·선택지·형식)만 준다. */
function buildItemRoster(items) {
  return items.map((it) => {
    const choices = Array.isArray(it.choices) && it.choices.length > 0
      ? it.choices.map((c) => `${c.label ?? '?'}) ${String(c.text ?? '').slice(0, 60)}`).join(' / ')
      : '(선택지 없음 — 서술형)';
    const fmt = it.answer_format === 'multi_select' ? ' [복수정답]'
      : it.answer_format === 'multi_blank' ? ` [다중빈칸 ${it.blank_count ?? '?'}개]` : '';
    const instruction = String(it.instruction ?? '').slice(0, 120);
    return `- Q${it.problem_number}${fmt}: ${instruction}\n    ${choices}`;
  }).join('\n');
}

/** 답 형식 공통 규칙 — Call 2·3이 같은 단위로 답해야 직접 비교가 된다.
 *  (구 prompts.js의 UNIT MATCHING 규칙: 서로 다른 단위로 나오면 비교 자체가 성립하지 않는다) */
function answerFormatRules(field) {
  const arrField = field === 'user_answer' ? 'user_answers' : 'correct_answers';
  return `## 답의 형식
- 객관식(①②③④⑤ 또는 1~5 번호 선택지): **ASCII 숫자 한 글자**("1"~"5"). 원문자(①②③④⑤)를 그대로
  출력하지 말고 반드시 ①→"1" … ⑤→"5"로 변환한다.
- 밑줄형 객관식("밑줄 친 부분 중 …적절하지 않은 것은?"), 문장삽입, 순서배열, 어법, 어휘 문제도
  전부 **선택지 번호**로 답한다. 밑줄 친 단어("appear")나 지문 문장을 그대로 옮기지 마라.
- 문장 형식 고르기(선택지가 "1형식".."5형식"): "N형식" 라벨에서 **숫자를 읽어** 답한다. 몇 번째
  칸에 있는지(위치)가 아니다. "5형식"이 첫 칸에 있어도 답은 "5"다.
- 괄호고르기(어법 선택형: "(who/which)"처럼 괄호 안 단어 중 하나 고르기): 번호가 아니라
  **단어 자체**를 인쇄된 철자 그대로 답한다. 여기서 숫자를 내면 확실한 오답이다.
- 서술형: 빈칸에 들어가는 내용만 자연스러운 한 덩어리로. 쉼표나 슬래시로 토막 내지 마라
  (NOT "they, do", NOT "Didn't / she / go" → "Yes, they do", "Didn't she go home late yesterday?").
- 복수정답 [복수정답] 표시 문항: ${arrField}에 해당 번호를 **전부** 오름차순 문자열 배열로 담고
  (예: ["1","2"]), ${field} 스칼라에도 "1, 2"처럼 이어 붙인다. 하나만 적고 끊으면 그 문항은
  통째로 오답 처리된다.
- 다중빈칸 [다중빈칸 N개] 표시 문항: ${arrField}에 빈칸 순서대로 정확히 N개 길이의 배열을 담고
  (해당 없는 칸은 null), ${field} 스칼라에도 "(1) … (2) …" 형태로 함께 채운다.`;
}

/**
 * Call 2 — 학생이 종이에 남긴 흔적만 읽는다.
 * export: 이 프롬프트의 판독 지시가 이 파이프라인의 존재 이유다. 누락을 테스트로 잡는다.
 */
export function buildUserAnswerPrompt(items, numImages) {
  const scope = numImages > 1 ? `이미지 ${numImages}장` : '이미지';
  return `다음은 학생이 풀어놓은 영어 시험지 ${scope}이다.
너의 유일한 임무는 **학생이 종이에 물리적으로 남긴 흔적**을 읽어 각 문항의 답을 보고하는 것이다.

## 절대 규칙 — 문제를 풀지 마라
- 너는 정답이 무엇인지 **판단하지 않는다**. 정답은 다른 단계가 따로 구한다.
- 학생이 틀린 답을 썼으면 **틀린 그대로** 보고한다. 그게 이 앱의 목적이다 —
  틀렸다는 걸 알려주려면 학생이 실제로 쓴 것이 필요하다.
- 인쇄된 정답표·해설이 페이지에 보이더라도 그것을 답으로 옮기지 마라. 오직 필기 흔적만이 근거다.

## 세 겹의 필기를 구분하라 (가장 중요)
시험지 한 장에 성격이 다른 필기가 겹쳐 있다. 반드시 구분하라.
1. **인쇄체** — 균일한 활자체. 문제 자체다. 답이 아니다.
2. **학생 필기** — 연필 또는 검정·파랑 볼펜. 획이 불규칙하고 기울거나 흘려 쓴다. **이것만이 답이다.**
3. **교사 채점** — 빨간펜. 동그라미·사선·곡선·O/X. 학생이 쓴 것이 아니므로 **답이 아니다.**
   빨간 곡선이 선택지 위를 길게 지나가더라도 그것은 채점 흔적이지 학생의 선택이 아니다.
   빨간펜이 시각적으로 가장 크고 진해서 눈에 먼저 들어오지만, 거기에 이끌리지 마라.

## 마크 찾기
- 동그라미, 체크(✓), 밑줄, 사선, 번호 위나 옆의 연필 자국을 모두 살핀다.
- **흐린 연필 자국, 옅은 동그라미, 작은 틱 마크도 전부 유효한 마크다.** 진하지 않다고 넘기지 마라.
- 선택지 ①②③④⑤를 **하나씩 개별로** 확인한 뒤 판단한다. 처음 눈에 띈 마크에서 멈추지 마라 —
  동그라미가 쳐진 번호가 첫 번째가 아닌 경우가 많다.
- 좌우 선택지 단을 가르는 긴 세로 곡선은 **레이아웃 구분선**이지 답 표시가 아니다.
  그 선이 지나간다는 이유로 가까운 번호를 답으로 읽지 마라.

## 답을 고쳤을 때 — 최종 선택이 답이다
학생은 풀면서 마음을 바꾼다. 우선순위대로 판단한다.
1. 손으로 그린 원/타원에 **완전히 둘러싸인** 번호가 가장 강한 선택 신호다. 다른 번호의
   사선·틱보다 우선한다.
2. 한 번호에서 다른 번호로 선/화살표를 그었다면 **화살표가 도착한 쪽**이 최종 답이다.
3. 번호를 **관통하는 사선**은 보통 취소를 뜻한다 — 동그라미 쳐진 다른 번호를 택한다.

## 시험 후 자가채점 표시 구분
학생이 시험 후 스스로 채점하며 O/X를 적기도 한다.
- 한 번호에 X가 있고 **다른** 번호에 O가 있으면: X 쳐진 쪽이 학생의 원래 답(user_answer),
  O 쳐진 쪽은 나중에 적은 정답이므로 user_answer가 **아니다**.
- 한 번호에만 표시가 있고 X가 없으면: 그 번호가 user_answer다.
- X와 O가 서로 다른 번호에 명확히 보일 때만 이 규칙을 적용한다.

## 서술형 — 쓴 그대로 옮겨라
- **철자·문법 오류를 절대 고치지 마라.** 학생이 "beetween"이라 썼으면 "beetween"이다.
  "between"으로 고쳐 적으면 학생의 오답이 정답으로 둔갑해 이 앱의 목적이 무너진다.
- 손으로 쓴 획만 옮긴다. 빈칸 주변에 **원래 인쇄되어 있던** 글자(대화 표시 "A:"/"B:",
  인쇄된 "Yes,"/"No,", 주어진 문장 조각, 단어 보기)는 학생이 손으로 쓰지 않았다면 제외한다.
- 빈칸은 인쇄된 문장 **중간**에 뚫려 있는 경우가 많다("____ at the bank?"). 빈칸에 채워 넣은
  것만 옮기고, 바로 앞뒤의 인쇄된 단어를 붙이지 마라. 가장 흔한 실수가 빈칸 직후의 인쇄된
  첫 단어를 손글씨에 붙이는 것이다.
- 학생이 지우고 다시 썼으면 최종본만. 교정 화살표(→)가 있으면 화살표 뒤의 것만.
- 빈칸이 여러 개면 읽는 순서대로 공백 하나로 이어 붙인다(슬래시 금지).

${answerFormatRules('user_answer')}

## 확신이 없으면 기권하라
- 마크가 아예 없으면 null.
- 마크가 있는 것 같은데 **어느 선택지의 것인지 확신할 수 없으면**(흐리거나, 애매하거나,
  두 번호에 걸쳐 있으면) null을 반환한다. **추측하지 마라 — 틀린 답은 null보다 나쁘다.**
- 문항 번호만 보이고 실제 문제 내용(발문·선택지)이 페이지에 없으면(잘린 페이지 조각, "[11-12]"
  같은 묶음 머리글) null을 반환한다.

## 대상 문항
아래 문항들에 대해 답하라. **목록의 번호를 그대로 사용**하고, 목록에 없는 번호를 만들지 마라.
${buildItemRoster(items)}

반드시 아래 형식의 JSON 객체만 출력하라(마크다운/설명 금지):
{"answers": [
  {"problem_number": "3", "user_answer": "2", "user_answers": null, "user_marked_correctness": null}
]}
- user_answers: 복수정답·다중빈칸 문항에서만 배열로 채우고, 그 외에는 null.
- user_marked_correctness: 그 문항에 채점 표시가 보이면 "O" 또는 "X", 없으면 null.
- 위 예시 값은 자리표시자다. 실제 마크를 읽어 채워라. 모든 문항을 빠짐없이 포함하라.`;
}

/**
 * Call 3 — 정답만 구한다. 학생 마크는 근거로 쓰지 않는다.
 * export: 학생 마크 배제 지시가 빠지면 Call 2와의 독립성이 무너진다 — 테스트로 고정.
 */
export function buildCorrectAnswerPrompt(items, numImages) {
  const scope = numImages > 1 ? `이미지 ${numImages}장` : '이미지';
  return `다음은 영어 시험지 ${scope}이다.
너의 유일한 임무는 각 문항의 **실제 정답**을 확정하는 것이다.

## 절대 규칙 — 학생의 답을 근거로 삼지 마라
- 학생이 연필로 친 동그라미·체크는 **틀렸을 수 있다.** 그것을 정답으로 옮기지 마라.
- 정답은 (1) 페이지에 인쇄된 정답·해설, (2) 교사가 빨간펜으로 표시한 채점, (3) 네가 직접 푼 결과
  순서로 판단한다. 학생의 연필 마크는 근거가 아니다.
- 교사의 빨간펜 O 표시가 특정 번호에 있으면 그 번호가 정답이다. 반대로 학생 답에 X가 쳐져
  있으면 그 답은 정답이 아니다.

## 인쇄된 정답이 없으면 직접 풀어라
- 지문과 선택지를 읽고 문제를 실제로 풀어 정답을 확정한다.
- 문장 형식 고르기는 다음을 적용한다: 1형식=S+V(자동사 sleep/go/arrive); 2형식=S+V+C
  (be·become·seem·감각동사 look/feel/sound + 보어 — be동사 뒤에 명사나 형용사가 오면 2형식이다.
  "She is my business partner"→2형식, 3형식 아님); 3형식=S+V+O; 4형식=S+V+IO+DO
  (수여동사 give/buy/make/send/tell + 사람 + 사물); 5형식=S+V+O+OC(make/find/keep/call/leave +
  목적어 + 목적격보어. "I found it difficult"→5형식, "keeps you healthy"→5형식).

${answerFormatRules('correct_answer')}

## 지어내지 마라
- 문항 번호만 보이고 실제 문제 내용(발문·선택지·지문)이 페이지에 없으면(잘린 페이지 조각,
  "[11-12]" 같은 묶음 머리글) null을 반환한다. 보이지 않는 내용의 정답을 만들어 내는 것은
  확실한 오답이며 null보다 나쁘다.
- 그 외의 경우에는 반드시 정답을 낸다.

## 대상 문항
아래 문항들에 대해 답하라. **목록의 번호를 그대로 사용**하고, 목록에 없는 번호를 만들지 마라.
${buildItemRoster(items)}

반드시 아래 형식의 JSON 객체만 출력하라(마크다운/설명 금지):
{"answers": [
  {"problem_number": "3", "correct_answer": "2", "correct_answers": null}
]}
- correct_answers: 복수정답·다중빈칸 문항에서만 배열로 채우고, 그 외에는 null.
- 위 예시 값은 자리표시자다. 실제로 풀어서 채워라. 모든 문항을 빠짐없이 포함하라.`;
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

/** Call 2: 이미지 + 문항목록 → 학생 마크. */
export async function detectUserAnswers({ ai, sessionId, images, items }) {
  const parts = [{ text: buildUserAnswerPrompt(items, images.length) }, ...imageParts(images)];
  return callJson({
    ai, sessionId, parts,
    sequence: ANSWER_MODEL_SEQUENCE,
    maxOutputTokens: tokenCap('answer', images.length),
    pick: (p) => (Array.isArray(p) ? p : (p?.answers || p?.items || [])),
    label: 'Call2(학생답)',
  });
}

/** Call 3: 이미지 + 문항목록 → 정답. */
export async function solveCorrectAnswers({ ai, sessionId, images, items }) {
  const parts = [{ text: buildCorrectAnswerPrompt(items, images.length) }, ...imageParts(images)];
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
 * 구조(Call 1)가 기준이다 — Call 2·3이 목록에 없는 번호를 냈다면 버린다(환각 방어).
 * export: 병합 규칙은 순수함수라 모델 호출 없이 테스트할 수 있다.
 */
export function mergeCallResults({ structureRows, userRows, correctRows }) {
  const userByNum = new Map();
  for (const r of userRows || []) {
    const k = numKey(r?.problem_number);
    if (k && !userByNum.has(k)) userByNum.set(k, r);
  }
  const correctByNum = new Map();
  for (const r of correctRows || []) {
    const k = numKey(r?.problem_number);
    if (k && !correctByNum.has(k)) correctByNum.set(k, r);
  }

  return (structureRows || []).map((s) => {
    const k = numKey(s?.problem_number);
    const u = userByNum.get(k) || {};
    const c = correctByNum.get(k) || {};
    // normalizeItem이 소비하는 형태로 합친다. answer_format은 구조(발문 근거)가 정하고
    // 답 호출은 그 형식에 맞춰 값만 채운다 — 형식과 값을 다른 근거로 정하는 것이 요점이다.
    return {
      ...s,
      user_answer: u.user_answer ?? null,
      user_answers: Array.isArray(u.user_answers) ? u.user_answers : null,
      user_marked_correctness: u.user_marked_correctness ?? null,
      correct_answer: c.correct_answer ?? null,
      correct_answers: Array.isArray(c.correct_answers) ? c.correct_answers : null,
    };
  });
}

/**
 * 역할분리 파이프라인 실행: 구조 추출 → (학생답 ∥ 정답) 병렬 → 병합 → (옵션)분류.
 * runSimpleExtractAndStructure와 반환 계약을 맞춘다(items/usedModel/structModel) —
 * 호출처(index.js·eval pipeline-runner)가 두 파이프라인을 같은 모양으로 소비한다.
 *
 * @returns {{items: object[], usedModel: string, structModel: string,
 *            userModel: string, correctModel: string}}
 */
export async function runSplitPipeline({
  ai, sessionId, images, taxonomyData, userLanguage = 'ko', runClassification = true,
}) {
  // Call 1: 구조
  const { rows: structureRows, usedModel: structModel } = await parseStructure({ ai, sessionId, images });
  console.log(
    `[splitPipeline] Call1 구조 ${structureRows.length}문항 (이미지 ${images.length}장, model=${structModel})`,
    { sessionId },
  );
  if (structureRows.length === 0) {
    return { items: [], usedModel: structModel, structModel, userModel: '', correctModel: '' };
  }

  // Call 2·3: 서로를 모른 채 병렬. 한쪽이 실패해도 다른 쪽 결과는 살린다 —
  // 학생답만 있고 정답이 없어도(또는 그 반대) 문항 자체는 저장할 가치가 있다.
  const [userRes, correctRes] = await Promise.allSettled([
    detectUserAnswers({ ai, sessionId, images, items: structureRows }),
    solveCorrectAnswers({ ai, sessionId, images, items: structureRows }),
  ]);
  if (userRes.status === 'rejected') {
    console.error(`[splitPipeline] Call2(학생답) 실패: ${userRes.reason?.message}`, { sessionId });
  }
  if (correctRes.status === 'rejected') {
    console.error(`[splitPipeline] Call3(정답) 실패: ${correctRes.reason?.message}`, { sessionId });
  }
  const userRows = userRes.status === 'fulfilled' ? userRes.value.rows : [];
  const correctRows = correctRes.status === 'fulfilled' ? correctRes.value.rows : [];
  const userModel = userRes.status === 'fulfilled' ? userRes.value.usedModel : '';
  const correctModel = correctRes.status === 'fulfilled' ? correctRes.value.usedModel : '';
  console.log(
    `[splitPipeline] Call2 학생답 ${userRows.length}건(model=${userModel}) · `
    + `Call3 정답 ${correctRows.length}건(model=${correctModel})`,
    { sessionId },
  );

  const merged = mergeCallResults({ structureRows, userRows, correctRows });
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
  return { items, usedModel: structModel, structModel, userModel, correctModel };
}
