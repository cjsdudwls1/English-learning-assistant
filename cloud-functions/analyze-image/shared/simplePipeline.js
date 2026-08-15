/**
 * 단순 2-스텝 파이프라인 (SIMPLE_PIPELINE)
 *
 * - Step 1: 입력된 모든 이미지를 한 번에 Gemini 3.5 Flash에 넣어 자유형식으로 추출.
 *   프롬프트는 단순히 "문제 내용·지문·보기·학습자가 체크한 답·실제 정답을 추출".
 *   (페이지별 분리/크롭/Document AI/Pass 0·A·B·C 크롭 로직 전부 대체 — 모델 성능을 신뢰)
 * - Step 2: 추출된 자유텍스트를 Gemini 3 Flash로 문항별 JSON 구조화(DB 저장/프론트 출력용).
 * - (옵션) 분류/메타: 기존 executePassC 재사용.
 *
 * 진입점(index.js runAnalysisPipeline)에서 SIMPLE_PIPELINE 플래그로 기존 4-Pass와 스위치한다.
 * 지문은 각 문항에 직접 포함(shared_passage_ref 미사용) → 지문 소실 구조적 차단.
 */

import { generateWithRetry, extractTextFromResponse, parseJsonResponse } from './aiClient.js';
import { EXTRACTION_TEMPERATURE, THINKING_BUDGET } from './config.js';
import { executePassC } from './passes.js';
import { sanitizeMcAnswerSet, isMultiSelectFmt } from './answerSanitizers.js';
import { toCardinality } from './answerShape.js';

// Step 1(추출): 사용자 지정 3.5 Flash 1순위, GA 폴백.
const EXTRACT_MODEL_SEQUENCE = ['gemini-3.5-flash', 'gemini-3.1-flash-lite', 'gemini-2.5-flash'];
// Step 2(구조화): 3.5 Flash(GA). 종전 1순위는 gemini-3-flash-preview였으나 2026-07-28
// preview 전면 제거 — Vertex DSQ 공유풀 제약으로 burst 시 429가 나고, 그때 폴백으로 내려간
// 모델이 무엇이었는지 결과에 남지 않아 정확도 수치의 출처가 불분명해진다. 폴백은 GA만 남긴다.
const STRUCTURE_MODEL_SEQUENCE = ['gemini-3.5-flash', 'gemini-3.1-flash-lite'];

const STEP1_TIMEOUT_MS = 300_000; // 다중 이미지 일괄 처리 → 넉넉히(worker 540s 내)

/** Step 1 출력 상한 — 반복 루프(degeneration) 방어.
 *
 *  2026-08-15 프로덕션: 같은 이미지 2장을 46분 간격으로 두 번 올렸는데 한 번은 7,413자로
 *  7문항이 45초에 끝났고, 다른 한 번은 같은 코드·같은 모델이 197,293자를 뱉었다. 후자는
 *  Step 1에만 4분 30초가 걸렸고, 그 텍스트가 Step 2에 통째로 들어가(66,676토큰) 구조화가
 *  문항 2개밖에 건지지 못했다. 입력도 코드도 같으니 모델 출력의 비결정성이다.
 *
 *  temperature 0.0이 이를 악화시킨다 — greedy 디코딩은 한번 반복 궤도에 들어가면 거기서
 *  빠져나올 확률적 요동이 없다. 상한이 없으면 컨텍스트가 허용하는 데까지 간다.
 *
 *  perImage는 실측 정상치(장당 약 3,700자 / 1,200토큰)의 5배 이상을 남긴 값이고,
 *  cap은 업로드 상한 10장(index.js MAX_IMAGES)이 전부 정상일 때(약 37,000자)의 2배다.
 *  charCap(80,000자)이 tokenCap(32,768토큰 ≈ 99,000자)보다 먼저 걸리도록 잡았다 —
 *  모델이 토큰 상한에 잘려 끝나는 것보다 이쪽이 먼저 감지돼 재시도로 이어지는 게 낫다.
 */
const STEP1_MAX_CHARS = { perImage: 20_000, cap: 80_000 };
const STEP1_MAX_OUTPUT_TOKENS = { perImage: 8_192, cap: 32_768 };

/** 이상 출력 후 재시도할 때 쓰는 온도. 0.0으로 다시 부르면 같은 궤도를 그대로 반복한다. */
const STEP1_RETRY_TEMPERATURE = 0.3;

/** Step 1 출력의 이상 여부 판정 상한(자). 이미지 수에 비례하되 전체 상한을 넘지 않는다. */
export function step1CharLimit(numImages) {
  return Math.min(STEP1_MAX_CHARS.perImage * Math.max(1, numImages), STEP1_MAX_CHARS.cap);
}

const SAFETY_SETTINGS = [
  { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
  { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
  { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
  { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
];

const CIRCLED_TO_ASCII = {
  '①': '1', '②': '2', '③': '3', '④': '4', '⑤': '5',
  '⑥': '6', '⑦': '7', '⑧': '8', '⑨': '9', '⑩': '10',
};

/** Step 1 프롬프트: 단순 자유형식 추출.
 *  export: buildStructurePrompt과 같은 이유 — 복수정답 지시문 누락을 테스트로 잡는다. */
export function buildExtractPrompt(numImages) {
  const scope = numImages > 1 ? `이미지 ${numImages}장` : '이미지';
  return `다음은 영어 시험지(문제지) ${scope}이다. 각 문항에 대해 아래 항목을 추출해줘:

- 문제 내용(발문)
- 지문
- 보기(선택지)
- 학습자가 손으로 체크한 답
- 실제 정답

발문에 "모두 고르시오", "정답 2개", "(단, 2개)", "all that apply"처럼 답이 둘 이상이라는 표시가 있으면,
체크한 답과 실제 정답을 표시된 것 **전부** 적어줘(예: "3, 4"). 하나만 적고 끊지 마.

교재 연습문제는 한 페이지 안에서 A·B·C 같은 구획마다 번호가 1부터 다시 시작하는 경우가 많다.
그럴 때는 문항 번호를 "A-1", "B-2"처럼 구획 기호와 함께 적어줘 — 한 페이지에 같은 번호가
여러 개 생기면 어느 문제인지 구분할 수 없다. 구획이 나뉘어 있지 않으면 번호만 적으면 된다.

문항 번호 순서대로 정리해줘. 여러 페이지에 걸친 지문은 하나로 이어서 봐줘.`;
}

/**
 * Step 2 프롬프트: 자유텍스트 → 문항별 JSON 구조화.
 * export: test/multiSelect.test.mjs가 복수정답 지시문 존재를 검증한다 — 4-Pass에서 2-스텝으로
 * 이관할 때 이 지시문이 통째로 누락돼 복수정답이 전부 기권 처리된 전례가 있다.
 */
export function buildStructurePrompt(rawText) {
  return `다음은 영어 시험지에서 추출한 내용이다. 이를 문항별 JSON으로 구조화하라.

반드시 아래 형식의 JSON 객체만 출력하라(마크다운/설명 금지):
{"items": [ <item>, ... ]}

각 <item>:
{
  "problem_number": string,          // 문항 번호. 페이지 안에서 고유해야 한다(아래 '문항 번호 고유성' 규칙). 빈 문자열 금지
  "passage": string|null,            // 지문 전문(공유 지문이면 각 문항에 반복). 없으면 null
  "visual_context": null | {"type": string, "title": string, "content": string},  // 표/그래프/안내문 등. 없으면 null
  "instruction": string|null,        // 발문
  "question_body": string|null,      // 지문 아닌 추가 본문. 없으면 null
  "choices": [ {"label": "1".."5", "text": "..."} ],  // 서술형이면 []
  "answer_format": "single" | "multi_select" | "multi_blank",  // 기본 "single". 아래 복수정답·다중빈칸 규칙 참고
  "user_answer": string|null,        // 학습자가 손으로 체크한 답. 객관식=ASCII 숫자, 서술형=텍스트. 없거나 불명확하면 null
  "correct_answer": string|null,     // 실제 정답. 객관식=ASCII 숫자, 서술형=텍스트. 없으면 null
  "user_answers": (string|null)[] | null,     // answer_format="multi_select"/"multi_blank"일 때만 채운다(그 외 null)
  "correct_answers": (string|null)[] | null,   // 〃
  "user_marked_correctness": "O"|"X"|null   // 채점 표시(O/✓=O, X/✗=X). 없으면 null
}

규칙:
- 선택지/답의 원문자(①②③④⑤)는 ASCII 숫자(1..5)로 변환.
- user_answer(학습자 손글씨)와 correct_answer(실제 정답)를 별개 필드로 구분.
- 지문은 요약·절삭 없이 문항별 전문으로.
- '표시 없음'/빈 값은 null로.
- 같은 문항 번호는 반드시 한 번만 출력한다(중복 금지). 지문이 여러 페이지에 나뉘어 있으면
  하나로 이어 붙여 해당 문항에 넣는다.
- 문항 번호 고유성: 교재 연습(Unit Exercise 등)은 한 페이지 안에서 A·B·C 같은 구획마다 번호가
  1부터 다시 시작한다. 이때 problem_number를 "A-1", "B-2", "C-3"처럼 구획 기호를 붙여 적어
  페이지 안에서 겹치지 않게 한다. 구획이 없으면 번호만 적는다("3"). 시험지 번호 그대로가 원칙이고,
  없는 구획을 지어내지는 마라.
- **추출 내용에 등장하는 모든 문항을 하나도 빠뜨리지 말고 item으로 만든다.** 여러 이미지·여러 유형
  (수능형/내신형/교재 연습문제)이 섞여 있어도 전부 포함하며, 시험 번호가 없는 교재 연습문제
  (예: "Let's Use It", 괄호에서 고르기 연습 등)도 반드시 포함한다. 어떤 이미지의 문항도 생략하지 마라.
- 복수정답 객관식: 발문에 "모두 고르시오", "정답 2개", "(단, 2개)", "all that apply"처럼 답이 둘 이상이라는
  지시가 있으면 answer_format="multi_select"로 표기한다. user_answers/correct_answers에 해당하는 선택지
  번호를 **전부** 오름차순 문자열 배열로 담고(예: ["2","4"]), user_answer/correct_answer 스칼라에도
  쉼표+공백으로 이어 붙여 함께 채운다(예: "2, 4"). 번호 하나로 줄이면 그 문항은 통째로 오답 처리된다.
  단, 학습자가 지시된 개수보다 적게 표시했으면 실제 표시된 것만 담는다(빠진 답을 지어내지 마라).
- 다중빈칸 서술형: 한 문항(고유 번호 1개) 아래에 (1)(2)(3)처럼 괄호 번호가 붙은 빈칸이 여러 개인
  서술형이면, 이를 하나의 item으로 두고 answer_format="multi_blank"로 표기한다. user_answers/
  correct_answers를 빈칸 순서대로 같은 길이의 배열로 채우고(학습자 미작성 칸=null),
  user_answer/correct_answer 스칼라에도 "(1) … (2) …" 형태로 함께 채운다.

추출 내용:
---
${rawText}`;
}

/** O/X 채점 마크 정규화(명확한 것만; 애매하면 null). */
function normalizeMarkedCorrectness(v) {
  if (v == null) return null;
  const s = String(v).trim().toLowerCase();
  if (s === 'o' || s === '○' || s === '✓' || s === 'correct' || s === '정답' || s === '맞음') return 'O';
  if (s === 'x' || s === '✗' || s === '×' || s === 'wrong' || s === '오답' || s === '틀림') return 'X';
  return null;
}

/** 답 정규화: 빈/무의미값→null, 원문자→ASCII 백스톱. */
function normalizeAnswer(v) {
  if (v == null) return null;
  let s = String(v).trim();
  if (s === '' || /^(null|none|없음|미체크|미표기|표시\s?없음|해당\s?없음|n\/?a|blank)$/i.test(s)) return null;
  s = s.replace(/[①②③④⑤⑥⑦⑧⑨⑩]/g, (ch) => CIRCLED_TO_ASCII[ch] || ch);
  return s;
}

/** 구조화 원시 아이템 → dbOperations(buildContentJson) 계약에 맞는 아이템.
 *  export: 순수함수라 test/multiSelect.test.mjs가 모델 출력 없이 직접 검증한다. */
export function normalizeItem(raw) {
  if (!raw || typeof raw !== 'object') return null;

  const choices = Array.isArray(raw.choices)
    ? raw.choices.map((c) => {
        if (typeof c === 'string') return { text: c };
        const label = c.label ?? c.mark ?? c.number;
        const text = c.text ?? c.content ?? c.value ?? '';
        return label != null && String(label).trim() !== ''
          ? { label: String(label).trim(), text: String(text) }
          : { text: String(text) };
      }).filter((c) => (c.text && c.text.trim() !== '') || c.label)
    : [];

  const item = {
    problem_number: raw.problem_number != null ? String(raw.problem_number).trim() : null,
    passage: raw.passage ? String(raw.passage).trim() : null,
    visual_context: raw.visual_context && typeof raw.visual_context === 'object' ? raw.visual_context : null,
    instruction: raw.instruction ? String(raw.instruction).trim() : (raw.question ? String(raw.question).trim() : null),
    question_body: raw.question_body ? String(raw.question_body).trim() : null,
    choices,
    user_answer: normalizeAnswer(raw.user_answer),
    correct_answer: normalizeAnswer(raw.correct_answer),
    user_marked_correctness: normalizeMarkedCorrectness(raw.user_marked_correctness),
  };

  // 모델 원출력을 통째로 달아 보낸다. 위 정규화는 아는 필드만 남기고 나머지를 버리는데, 버린 필드가
  // 나중에 필요해지면 이미지를 다시 분석하는 수밖에 없다(비용 + 결과가 매번 달라짐).
  // buildContentJson이 이걸 content.raw로 저장해 재파싱·재채점을 DB만으로 할 수 있게 한다.
  // non-enumerable: 기존 코드가 item을 순회·직렬화·비교할 때 갑자기 끼어들지 않게 한다.
  Object.defineProperty(item, '_raw', { value: raw, enumerable: false });

  // 우리가 모르는 형식은 이름을 그대로 남긴다. 예전엔 여기서 조용히 사라져 단일답으로 취급됐는데,
  // 순서·매칭처럼 단일 비교가 성립하지 않는 유형이 그렇게 되면 confident-wrong으로 채점된다.
  // 이름이 남아 있으면 하류(computeIsCorrect·프론트)가 toCardinality로 판정 불가를 보고 기권한다.
  // 아는 형식은 아래 분기가 계약값으로 다시 세팅하므로 여기서 손대지 않는다.
  if (raw.answer_format != null && toCardinality(raw.answer_format) === null) {
    item.answer_format = String(raw.answer_format).trim();
  }

  // 복수정답 객관식: 선택지 번호 '집합'이라 순서·중복이 무의미 → 정렬·중복제거·범위검증(sanitizeMcAnswerSet).
  // 모델·GT 라벨의 어휘는 'multi_select'이지만 DB/프론트 계약값은 'multi'(multi_answer_contract §2)라,
  // 모델 출력 경계인 여기서 별칭을 한 번만 정규화해 하위 로직이 두 이름을 알 필요가 없게 한다.
  // choices 2개 미만이면 적용하지 않는다 — 선택지 없는 문항에 multi_select가 잘못 붙었을 때
  // sanitizeMcAnswerSet이 빈 배열을 돌려주어 원래 서술형 답을 null로 파괴하는 것을 막는다.
  if (isMultiSelectFmt(raw.answer_format) && choices.length >= 2) {
    // 배열이 비었으면 스칼라에서 뽑는다(모델이 한쪽만 채우는 경우가 있다). 둘 다 있으면 배열 우선.
    const pick = (arr, scalar) => (Array.isArray(arr) && arr.length > 0 ? arr : scalar);
    const cor = sanitizeMcAnswerSet(pick(raw.correct_answers, raw.correct_answer), choices);
    const usr = sanitizeMcAnswerSet(pick(raw.user_answers, raw.user_answer), choices);
    item.answer_format = 'multi';
    item.correct_answers = cor;
    item.user_answers = usr;
    // 스칼라는 하위호환 표시용("2, 4"). 집합이 비면 null(=마크 없음) → 상위에서 기권 처리.
    item.correct_answer = cor.length > 0 ? cor.join(', ') : null;
    item.user_answer = usr.length > 0 ? usr.join(', ') : null;
    return item;
  }

  // 다중빈칸 서술형: resolveAnswerFormat이 answer_format==='multi_blank'만 명시 존중.
  // 빈칸 순서(인덱스) 정렬이 프론트 N행 UI의 생명이므로 길이·인덱스는 보존하고 값만 정규화.
  if (raw.answer_format === 'multi_blank' && (Array.isArray(raw.correct_answers) || Array.isArray(raw.user_answers))) {
    const normBlank = (v) => {
      if (v == null) return null;
      const s = String(v).trim();
      if (s === '' || /^(미작성|미기재|미표기|표시\s?없음|없음|blank|null|none|n\/?a)$/i.test(s)) return null;
      return s;
    };
    const cor = Array.isArray(raw.correct_answers) ? raw.correct_answers : [];
    const usr = Array.isArray(raw.user_answers) ? raw.user_answers : [];
    const len = Math.max(cor.length, usr.length);
    item.answer_format = 'multi_blank';
    item.correct_answers = Array.from({ length: len }, (_, i) => normBlank(cor[i]));
    item.user_answers = Array.from({ length: len }, (_, i) => normBlank(usr[i]));
  }

  return item;
}

/** 같은 문항 번호 중복 제거 백스톱(페이지에 걸친 지문이 2개로 쪼개진 경우).
 *  정보량(지문 길이 + 선택지 수 + 답 유무)이 많은 쪽을 유지, 첫 등장 순서 보존. */
function dedupeByNumber(items) {
  const score = (x) => (x.passage || '').length + (x.choices || []).length * 50
    + (x.user_answer ? 10 : 0) + (x.correct_answer ? 10 : 0);
  const map = new Map();
  const order = [];
  for (const it of items) {
    const key = String(it.problem_number);
    if (!map.has(key)) { map.set(key, it); order.push(key); continue; }
    if (score(it) > score(map.get(key))) map.set(key, it);
  }
  return order.map((k) => map.get(k));
}

/** Step 1: 모든 이미지를 한 번에 3.5로 자유추출(자체 타임아웃 + 모델 폴백 + 이상 출력 방어).
 *  export: 반복 루프 방어가 실제로 재시도·절단으로 이어지는지 테스트로 고정한다. */
export async function extractAllImages({ ai, sessionId, images }) {
  const imageParts = images.map((img) => ({ inlineData: { data: img.imageBase64, mimeType: img.mimeType } }));
  const parts = [{ text: buildExtractPrompt(images.length) }, ...imageParts];

  const charLimit = step1CharLimit(images.length);
  const maxOutputTokens = Math.min(
    STEP1_MAX_OUTPUT_TOKENS.perImage * Math.max(1, images.length),
    STEP1_MAX_OUTPUT_TOKENS.cap,
  );

  let lastErr = null;
  // 모든 모델·시도가 이상 출력이면 마지막 것을 절단해서라도 쓴다 — 전량 실패보다 낫다.
  let lastOversized = null;
  for (const model of EXTRACT_MODEL_SEQUENCE) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const config = {
        // 재시도는 직전 시도가 반복 궤도에 빠졌을 수 있는 상황이다. greedy(0.0)로 다시
        // 부르면 같은 출력을 그대로 재생하므로 온도를 올려 궤도를 벗어나게 한다.
        temperature: attempt === 0 ? EXTRACTION_TEMPERATURE : STEP1_RETRY_TEMPERATURE,
        maxOutputTokens,
      };
      if (THINKING_BUDGET !== undefined && !Number.isNaN(THINKING_BUDGET)) {
        config.thinkingConfig = { thinkingBudget: THINKING_BUDGET };
      }
      try {
        let timeoutHandle;
        const timeoutPromise = new Promise((_, rej) => {
          timeoutHandle = setTimeout(() => rej(new Error(`Step1 timeout ${STEP1_TIMEOUT_MS / 1000}s`)), STEP1_TIMEOUT_MS);
        });
        let resp;
        try {
          resp = await Promise.race([
            ai.models.generateContent({ model, contents: [{ role: 'user', parts }], safetySettings: SAFETY_SETTINGS, config }),
            timeoutPromise,
          ]);
        } finally {
          clearTimeout(timeoutHandle);
        }
        const text = extractTextFromResponse(resp, model);
        if (text && text.trim()) {
          // 빈 응답만이 실패가 아니다. 상한을 넘는 출력은 반복 루프의 산물이고, 그대로
          // 넘기면 Step 2가 쓰레기 더미에서 문항을 놓친다(실제로 7문항 → 2문항).
          if (text.length > charLimit) {
            if (!lastOversized || text.length < lastOversized.text.length) {
              lastOversized = { text, usedModel: model };
            }
            console.warn(
              `[simplePipeline] Step1 ${model} 이상 출력 ${text.length}자(상한 ${charLimit}) → 재시도/폴백`,
              { sessionId },
            );
            continue;
          }
          return { text, usedModel: model };
        }
        console.warn(`[simplePipeline] Step1 ${model} 빈 응답 → 폴백`, { sessionId });
      } catch (e) {
        lastErr = e;
        console.error(`[simplePipeline] Step1 ${model} attempt${attempt + 1}: ${e?.message}`, { sessionId });
      }
    }
  }
  if (lastOversized) {
    console.warn(
      `[simplePipeline] Step1 전 시도 이상 출력 → ${charLimit}자로 절단 진행 (원본 ${lastOversized.text.length}자)`,
      { sessionId },
    );
    return { text: lastOversized.text.slice(0, charLimit), usedModel: lastOversized.usedModel };
  }
  if (lastErr) throw lastErr;
  throw new Error('Step1 추출 실패(빈 응답)');
}

/** Step 2: 자유텍스트 → 문항별 JSON 구조화(3 Flash, 모델 폴백). */
async function structureItems({ ai, sessionId, rawText }) {
  const prompt = buildStructurePrompt(rawText);
  let lastErr = null;
  for (const model of STRUCTURE_MODEL_SEQUENCE) {
    try {
      const { response } = await generateWithRetry({
        ai, model,
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        sessionId, maxRetries: 2, baseDelayMs: 2000, temperature: 0.0,
      });
      const text = extractTextFromResponse(response, model);
      const parsed = parseJsonResponse(text, model);
      const items = Array.isArray(parsed) ? parsed : (parsed?.items || parsed?.problems || []);
      if (Array.isArray(items) && items.length > 0) {
        return { items, usedModel: model };
      }
      console.warn(`[simplePipeline] Step2 ${model} 0문항 → 폴백`, { sessionId });
    } catch (e) {
      lastErr = e;
      console.error(`[simplePipeline] Step2 ${model}: ${e?.message}`, { sessionId });
    }
  }
  if (lastErr) throw lastErr;
  return { items: [], usedModel: STRUCTURE_MODEL_SEQUENCE[0] };
}

/**
 * 단순 파이프라인 실행: 모든 이미지 일괄 추출 → 구조화 → (옵션)분류.
 * @returns {{items: object[], usedModel: string, structModel: string}}
 *   usedModel=Step1(추출), structModel=Step2(구조화)에서 실제 응답한 모델.
 *   둘 다 폴백 결과일 수 있어 "1순위가 답했다"고 가정하면 안 된다 — eval 하네스가
 *   이 값을 결과 파일에 기록해 정확도 수치의 출처를 사후 확인한다.
 */
export async function runSimpleExtractAndStructure({
  ai, sessionId, images, taxonomyData, userLanguage = 'ko', runClassification = true,
}) {
  // Step 1: 전체 이미지 일괄 자유추출
  const { text: rawText, usedModel } = await extractAllImages({ ai, sessionId, images });
  // 이미지 수를 함께 남긴다 — 장당 자수를 봐야 이상 출력인지 사후에 판단할 수 있다.
  console.log(
    `[simplePipeline] Step1 추출 ${rawText.length}자 (이미지 ${images.length}장, model=${usedModel})`,
    { sessionId },
  );

  // Step 2: 3 Flash 구조화
  const { items: rawItems, usedModel: structModel } = await structureItems({ ai, sessionId, rawText });
  const normalized = rawItems.map(normalizeItem).filter(Boolean);
  // 번호 없는 교재 연습문제(Let's Use It 등)가 통째로 누락되던 회귀 방어:
  // problem_number가 비어도 실질 내용(발문/선택지/지문/답)이 있으면 고유 폴백 번호를 부여해 유지.
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
  console.log(`[simplePipeline] Step2 구조화 ${normalized.length}→${items.length}문항(중복제거) (model=${structModel})`, { sessionId });

  // (옵션) 분류/메타: 기존 Pass C 재사용. 이미지 미전달(다중 페이지) → 텍스트 기반 분류.
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
      console.log(`[simplePipeline] Pass C: ${(passC.classifications || []).length}개 분류`, { sessionId });
    } catch (e) {
      console.error(`[simplePipeline] Pass C 분류 실패(추출 결과는 유지): ${e?.message}`, { sessionId });
    }
  }

  return { items, usedModel, structModel };
}
