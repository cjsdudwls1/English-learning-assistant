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

// Step 1(추출): 사용자 지정 3.5 Flash 1순위, GA 폴백.
const EXTRACT_MODEL_SEQUENCE = ['gemini-3.5-flash', 'gemini-3.1-flash-lite', 'gemini-2.5-flash'];
// Step 2(구조화): 사용자 지정 "3 플래시". preview burst 대비 GA 폴백.
const STRUCTURE_MODEL_SEQUENCE = ['gemini-3-flash-preview', 'gemini-3.1-flash-lite'];

const STEP1_TIMEOUT_MS = 300_000; // 다중 이미지 일괄 처리 → 넉넉히(worker 540s 내)

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

/** Step 1 프롬프트: 단순 자유형식 추출. */
function buildExtractPrompt(numImages) {
  const scope = numImages > 1 ? `이미지 ${numImages}장` : '이미지';
  return `다음은 영어 시험지(문제지) ${scope}이다. 각 문항에 대해 아래 항목을 추출해줘:

- 문제 내용(발문)
- 지문
- 보기(선택지)
- 학습자가 손으로 체크한 답
- 실제 정답

문항 번호 순서대로 정리해줘. 여러 페이지에 걸친 지문은 하나로 이어서 봐줘.`;
}

/** Step 2 프롬프트: 자유텍스트 → 문항별 JSON 구조화. */
function buildStructurePrompt(rawText) {
  return `다음은 영어 시험지에서 추출한 내용이다. 이를 문항별 JSON으로 구조화하라.

반드시 아래 형식의 JSON 객체만 출력하라(마크다운/설명 금지):
{"items": [ <item>, ... ]}

각 <item>:
{
  "problem_number": string,          // 문항 번호. 시험 번호가 없으면 그 연습의 소제목/순번으로 채운다(빈 문자열 금지)
  "passage": string|null,            // 지문 전문(공유 지문이면 각 문항에 반복). 없으면 null
  "visual_context": null | {"type": string, "title": string, "content": string},  // 표/그래프/안내문 등. 없으면 null
  "instruction": string|null,        // 발문
  "question_body": string|null,      // 지문 아닌 추가 본문. 없으면 null
  "choices": [ {"label": "1".."5", "text": "..."} ],  // 서술형이면 []
  "answer_format": "single" | "multi_blank",  // 기본 "single". 아래 다중빈칸 규칙 참고
  "user_answer": string|null,        // 학습자가 손으로 체크한 답. 객관식=ASCII 숫자, 서술형=텍스트. 없거나 불명확하면 null
  "correct_answer": string|null,     // 실제 정답. 객관식=ASCII 숫자, 서술형=텍스트. 없으면 null
  "user_answers": (string|null)[] | null,     // answer_format="multi_blank"일 때만 채운다(그 외 null)
  "correct_answers": (string|null)[] | null,   // answer_format="multi_blank"일 때만 채운다(그 외 null)
  "user_marked_correctness": "O"|"X"|null   // 채점 표시(O/✓=O, X/✗=X). 없으면 null
}

규칙:
- 선택지/답의 원문자(①②③④⑤)는 ASCII 숫자(1..5)로 변환.
- user_answer(학습자 손글씨)와 correct_answer(실제 정답)를 별개 필드로 구분.
- 지문은 요약·절삭 없이 문항별 전문으로.
- '표시 없음'/빈 값은 null로.
- 같은 문항 번호는 반드시 한 번만 출력한다(중복 금지). 지문이 여러 페이지에 나뉘어 있으면
  하나로 이어 붙여 해당 문항에 넣는다.
- **추출 내용에 등장하는 모든 문항을 하나도 빠뜨리지 말고 item으로 만든다.** 여러 이미지·여러 유형
  (수능형/내신형/교재 연습문제)이 섞여 있어도 전부 포함하며, 시험 번호가 없는 교재 연습문제
  (예: "Let's Use It", 괄호에서 고르기 연습 등)도 반드시 포함한다. 어떤 이미지의 문항도 생략하지 마라.
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

/** 구조화 원시 아이템 → dbOperations(buildContentJson) 계약에 맞는 아이템. */
function normalizeItem(raw) {
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

/** Step 1: 모든 이미지를 한 번에 3.5로 자유추출(자체 타임아웃 + 모델 폴백). */
async function extractAllImages({ ai, sessionId, images }) {
  const imageParts = images.map((img) => ({ inlineData: { data: img.imageBase64, mimeType: img.mimeType } }));
  const parts = [{ text: buildExtractPrompt(images.length) }, ...imageParts];

  const config = { temperature: EXTRACTION_TEMPERATURE };
  if (THINKING_BUDGET !== undefined && !Number.isNaN(THINKING_BUDGET)) {
    config.thinkingConfig = { thinkingBudget: THINKING_BUDGET };
  }

  let lastErr = null;
  for (const model of EXTRACT_MODEL_SEQUENCE) {
    for (let attempt = 0; attempt < 2; attempt++) {
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
          return { text, usedModel: model };
        }
        console.warn(`[simplePipeline] Step1 ${model} 빈 응답 → 폴백`, { sessionId });
      } catch (e) {
        lastErr = e;
        console.error(`[simplePipeline] Step1 ${model} attempt${attempt + 1}: ${e?.message}`, { sessionId });
      }
    }
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
 * @returns {{items: object[], usedModel: string}}  usedModel은 Step1(추출) 모델.
 */
export async function runSimpleExtractAndStructure({
  ai, sessionId, images, taxonomyData, userLanguage = 'ko', runClassification = true,
}) {
  // Step 1: 전체 이미지 일괄 자유추출
  const { text: rawText, usedModel } = await extractAllImages({ ai, sessionId, images });
  console.log(`[simplePipeline] Step1 추출 ${rawText.length}자 (model=${usedModel})`, { sessionId });

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

  return { items, usedModel };
}
