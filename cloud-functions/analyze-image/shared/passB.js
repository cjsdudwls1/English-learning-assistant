/**
 * Pass B 계열: 필기 인식 — user_answer(마크 지각) + correct_answer(정답 추론)
 * - executePassB: 크롭 기반 주경로(answerArea에서 user, fullCrop에서 correct)
 * - executePassBFullImage: 전체 이미지 fallback(bbox 실패/통째 누락/correct 결손 보충)
 * - detectSubjectiveUserAnswers / detectMultiBlankAnswers: 서술형·다중빈칸 전용(전체 이미지 1회)
 */

import { generateWithRetry, extractTextFromResponse, parseJsonResponse } from './aiClient.js';
import { LIGHTWEIGHT_MODEL_SEQUENCE, ANSWER_MODEL_SEQUENCE, USER_ANSWER_MODEL_SEQUENCE } from './config.js';
import * as config from './config.js';
import {
  buildCroppedUserAnswerPrompt,
  buildCroppedCorrectAnswerPrompt,
  buildHandwritingDetectionPrompt,
} from './prompts.js';
import {
  sanitizeMcAnswer, normalizeChoiceValue, sanitizeWordChoiceAnswer, flattenMcAnswerSet,
} from './answerSanitizers.js';
import { runWithModelFallback } from './modelFallback.js';

/**
 * 크롭된 이미지 배열에 대해 개별 모델 호출
 * 원본: analysisProcessor.ts#detectHandwritingFromCroppedImages
 * - 각 크롭 이미지를 개별 API 호출로 처리 (배치 3개씩 병렬)
 * - buildPromptFn에 problem_number를 전달하여 문제별 프롬프트 생성
 */
export async function detectFromCrops({ ai, sessionId, crops, buildPromptFn, questionContextMap, temperature = 0.0, modelSequence }) {
  if (crops.length === 0) return { marks: [], usageMetadata: null };

  const marks = [];
  let lastUsageMetadata = null;
  const models = modelSequence || LIGHTWEIGHT_MODEL_SEQUENCE;

  const BATCH_SIZE = 3;
  for (let i = 0; i < crops.length; i += BATCH_SIZE) {
    const batch = crops.slice(i, i + BATCH_SIZE);

    const batchResults = await Promise.allSettled(
      batch.map(async (crop) => {
        const questionContext = questionContextMap?.get(String(crop.problem_number));
        const prompt = buildPromptFn(crop.problem_number, questionContext);
        const parts = [
          { text: prompt },
          { inlineData: { data: crop.croppedBase64, mimeType: crop.mimeType } },
        ];

        for (const model of models) {
          try {
            const { response, usageMetadata } = await generateWithRetry({
              ai, model,
              contents: [{ role: 'user', parts }],
              sessionId, maxRetries: 2, baseDelayMs: 1500, temperature,
            });
            lastUsageMetadata = usageMetadata;
            const text = extractTextFromResponse(response, model);
            const parsed = parseJsonResponse(text, model);
            const isSubjective = questionContext?.isSubjective;
            const choices = questionContext?.choices;
            // 괄호고르기(word-choice, 어법 선택형): "(he/who)"처럼 문장 속 괄호 후보 중 하나를 고르는 문항.
            // 정답/사용자답을 '옵션 단어'로 정규화한다(인덱스 "2" 오출력을 옵션 단어로 환원, 무관 답은 기권).
            // questionContext 단계에서 미리 판정(isWordChoice)되며, 이 경우 choices=[]로 비워져 MC 인덱스화가 안 됨.
            const isWordChoice = questionContext?.isWordChoice === true;
            const wcOptions = questionContext?.wordChoiceOptions;
            // 다중정답(multi MC): 문두에 "모두 고르시오/정답 N개" 등 신호가 있는 문항(questionContext
            // 단계에서 미리 판정됨)은 단일 강제(sanitizeMcAnswer)가 아니라 집합 파싱(sanitizeMcAnswerSet)
            // 경로를 탄다. 신호 없는 문항(isMulti=false)은 기존 sanitizeMcAnswer 경로 그대로 — 무회귀.
            const isMulti = questionContext?.isMultiFormat === true && !isSubjective && !isWordChoice;
            const normalizeAnswer = (raw) => {
              if (isWordChoice) return sanitizeWordChoiceAnswer(raw == null ? null : String(raw).trim(), wcOptions);
              if (isMulti) return flattenMcAnswerSet(raw, choices);
              return sanitizeMcAnswer(normalizeChoiceValue(raw ?? null), isSubjective, choices);
            };
            return {
              problem_number: parsed.problem_number || crop.problem_number,
              user_answer: normalizeAnswer(parsed.user_answer),
              correct_answer: normalizeAnswer(parsed.correct_answer),
            };
          } catch (err) {
            console.warn(`[passes:detectFromCrops] Q${crop.problem_number} ${model} 실패: ${err?.message}, 다음 모델로 폴백`);
            continue;
          }
        }
        console.error(`[passes:detectFromCrops] Q${crop.problem_number} 모든 모델 실패`);
        return null;
      })
    );

    for (const result of batchResults) {
      if (result.status === 'fulfilled' && result.value) {
        marks.push(result.value);
      }
    }
  }

  console.log(`[passes:detectFromCrops] 완료: ${marks.length}/${crops.length}개 감지`, { sessionId });
  return { marks, usageMetadata: lastUsageMetadata };
}

/**
 * user_answer marks와 correct_answer marks를 problem_number 기준으로 병합
 */
function mergeUserAndCorrectMarks(userMarks, correctMarks) {
  const mergedMarks = userMarks.map(userMark => {
    const correctMark = correctMarks.find(
      mark => mark.problem_number === userMark.problem_number
    );
    return {
      problem_number: userMark.problem_number,
      user_answer: userMark.user_answer,
      correct_answer: correctMark?.correct_answer ?? null,
    };
  });

  // correct_answer만 있고 user_answer가 없는 문제 추가
  for (const correctMark of correctMarks) {
    const isAlreadyMerged = mergedMarks.some(
      mark => mark.problem_number === correctMark.problem_number
    );
    if (!isAlreadyMerged) {
      mergedMarks.push({
        problem_number: correctMark.problem_number,
        user_answer: null,
        correct_answer: correctMark.correct_answer,
      });
    }
  }

  return mergedMarks;
}

/**
 * correctSource='fullpage' 잔여 보충용: 지정 fullCrops에서 correct_answer만 크롭 추론.
 * - 풀페이지 1회로 correct를 채울 때 문항이 많은 페이지(예: 어법지 12문항)는 일부 문항을
 *   누락한다(실측: Q5 correct 3런 내내 null). 그 잔여 문항만 문항별 크롭으로 보충하면
 *   recall을 회복하면서도 호출 수는 누락분(보통 0~소수)만 추가된다.
 */
export async function detectCorrectFromCrops({ ai, sessionId, fullCrops, questionContextMap }) {
  return detectFromCrops({
    ai, sessionId, crops: fullCrops,
    buildPromptFn: buildCroppedCorrectAnswerPrompt,
    questionContextMap,
    temperature: 0.0,
    modelSequence: ANSWER_MODEL_SEQUENCE,
  });
}

/**
 * Pass B: 필기 인식 - 크롭된 답안/문제 영역에서 user_answer, correct_answer 추출
 * user_answer: 필기 마크 인식 (지각 작업) - temperature=0.0으로 결정성 확보
 * correct_answer: 정답 추론 (논리 작업) - temperature=0.0 + 강한 모델 우선
 */
export async function executePassB({ ai, sessionId, answerAreaCrops, fullCrops, questionContextMap, correctSource = 'crop' }) {
  // correctSource:
  //  - 'crop'(기본, 행위보존): 문항별 fullCrop으로 correct_answer를 추론(문항 N개 → N호출).
  //  - 'fullpage': correct 크롭 호출을 생략한다. 상위 processPage가 correct 결손을 감지해
  //    full-image fallback(풀페이지 1회)으로 correct를 채운다. eval 실측상 correct_answer는
  //    풀페이지 단일 호출로 100%라 문항별 N호출이 낭비 → 호출 수를 N→1로 절감.
  //  user_answer(answerArea 크롭) 경로는 두 모드에서 동일하다(confident-wrong 방지 가치 유지).
  // ⚠️ user_answer를 fullCrop에서 읽으면 안 된다: fullCrop은 지문 전체가 보여 모델이
  //   "손글씨 마크 인식" 대신 "정답 독해 추론"에 오염된다. 실측(gold Q27): 사용자 마크는 ②인데
  //   fullCrop이 지문을 읽고 정답 ⑤를 user_answer로 반환(confident-wrong). answerArea(좁은 답칸)는
  //   지문이 안 보여 순수 마크만 읽으므로 이 오염이 없다. 25번류(마크 누락)는 bbox 개선으로 해결한다.
  const userPromise = detectFromCrops({
    ai, sessionId, crops: answerAreaCrops,
    buildPromptFn: buildCroppedUserAnswerPrompt,
    questionContextMap,
    temperature: 0.0,
    // 필기 마크 '지각'은 신형 비전이 우월 → 3.5-flash 우선(2.5-flash의 인접번호 오인 회피)
    modelSequence: USER_ANSWER_MODEL_SEQUENCE,
  });
  const correctPromise = correctSource === 'crop'
    ? detectFromCrops({
        ai, sessionId, crops: fullCrops,
        buildPromptFn: buildCroppedCorrectAnswerPrompt,
        questionContextMap,
        temperature: 0.0,
        // 정답 추론은 정확도 우선 → 최상위 모델 시퀀스 사용 (config.ANSWER_MODEL_SEQUENCE)
        modelSequence: ANSWER_MODEL_SEQUENCE,
      })
    : Promise.resolve({ marks: [], usageMetadata: null });
  const [userResult, correctResult] = await Promise.all([userPromise, correctPromise]);

  const mergedMarks = mergeUserAndCorrectMarks(userResult.marks, correctResult.marks);

  // §4 교차뷰 확인 대상 식별용: answerArea(주 뷰)에서 비-null로 잡힌 문항만 추적.
  // (null-retry로 fullCrop에서 채워진 답은 동일 뷰 재확인이 되므로 대상에서 제외)
  const answerAreaPns = new Set(
    userResult.marks
      .filter(m => m.user_answer != null && String(m.user_answer).trim() !== '')
      .map(m => String(m.problem_number))
  );

  // ── 정밀 보충: user_answer가 null인 문제를 fullCrop에서 재독해 ──
  // answer_area_bbox가 좁거나 빗나가 선택지 번호 위 마크(예: ③에 친 동그라미)를 놓치면
  // user_answer=null이 된다. fullCrop은 문제 전체(선택지 ①~⑤ 포함) + 2배 확대 + 문제별 격리라
  // 다운스케일된 전체 페이지 fallback보다 마크 위치 인식이 훨씬 정확하다.
  const needRetry = new Set(
    mergedMarks
      .filter(m => m.user_answer == null || String(m.user_answer).trim() === '')
      .map(m => String(m.problem_number))
  );
  // mergedMarks에 아직 없지만 fullCrop은 있는 문제(answerArea 크롭 자체가 없던 경우)도 포함
  for (const fc of fullCrops) {
    const pn = String(fc.problem_number);
    if (!mergedMarks.some(m => String(m.problem_number) === pn)) needRetry.add(pn);
  }
  const retryFullCrops = fullCrops.filter(fc => needRetry.has(String(fc.problem_number)));
  if (retryFullCrops.length > 0) {
    console.log(`[passes:PassB] user_answer 누락 ${retryFullCrops.length}개 → fullCrop 재독해: [${retryFullCrops.map(c => c.problem_number).join(',')}]`, { sessionId });
    const retryResult = await detectFromCrops({
      ai, sessionId, crops: retryFullCrops,
      buildPromptFn: (pn, ctx) => buildCroppedUserAnswerPrompt(pn, ctx, true), // isFullCrop=true
      questionContextMap,
      temperature: 0.0,
      modelSequence: USER_ANSWER_MODEL_SEQUENCE, // 1차와 동일하게 3.5-flash 우선
    });
    for (const rm of retryResult.marks) {
      if (rm.user_answer == null || String(rm.user_answer).trim() === '') continue;
      const existing = mergedMarks.find(m => String(m.problem_number) === String(rm.problem_number));
      if (existing) {
        if (existing.user_answer == null || String(existing.user_answer).trim() === '') {
          existing.user_answer = rm.user_answer;
        }
      } else {
        mergedMarks.push({ problem_number: String(rm.problem_number), user_answer: rm.user_answer, correct_answer: null });
      }
    }
  }

  // ── §4 user_answer 교차뷰 확인 (consensus, feature-flag, 기본 OFF) ──
  // answerArea(주 뷰)에서 비-null로 잡힌 user_answer를 fullCrop(다른 뷰)으로 1회 교차확인.
  //  · 일치 → 유지(고신뢰)  · fullCrop=null → answerArea 유지(fullCrop은 마크 누락 잦음)
  //  · 불일치(둘 다 비-null, 값 다름) → null(기권). '자신있는 오답'은 null보다 해롭다(정밀도 우선).
  // 부하: 문항당 +1 호출 상한(N×아님). 기본 OFF라 prod 30명 동시부하 무영향.
  if (config.USER_ANSWER_CONSENSUS && answerAreaPns.size > 0) {
    const confirmCrops = fullCrops.filter(fc => {
      const pn = String(fc.problem_number);
      if (!answerAreaPns.has(pn)) return false;
      const ctx = questionContextMap?.get(pn);
      return !ctx?.isSubjective; // 서술형 제외(텍스트 교차확인 무의미)
    });
    if (confirmCrops.length > 0) {
      console.log(`[passes:PassB] consensus 교차확인 ${confirmCrops.length}개: [${confirmCrops.map(c => c.problem_number).join(',')}]`, { sessionId });
      const confirmResult = await detectFromCrops({
        ai, sessionId, crops: confirmCrops,
        buildPromptFn: (pn, ctx) => buildCroppedUserAnswerPrompt(pn, ctx, true), // isFullCrop=true
        questionContextMap, temperature: 0.0,
        modelSequence: USER_ANSWER_MODEL_SEQUENCE,
      });
      const confirmMap = new Map(confirmResult.marks.map(m => [String(m.problem_number), m.user_answer]));
      for (const m of mergedMarks) {
        const pn = String(m.problem_number);
        if (!answerAreaPns.has(pn)) continue;
        if (m.user_answer == null || String(m.user_answer).trim() === '') continue;
        const conf = confirmMap.get(pn);
        if (conf == null || String(conf).trim() === '') continue; // fullCrop 미검출 → 유지
        if (String(conf).trim() !== String(m.user_answer).trim()) {
          console.log(`[passes:PassB] consensus 불일치 Q${pn}: answerArea=${m.user_answer} ≠ fullCrop=${conf} → null(기권)`, { sessionId });
          m.user_answer = null;
        }
      }
    }
  }

  return {
    marks: mergedMarks,
    usageMetadata: userResult.usageMetadata || correctResult.usageMetadata,
  };
}

/**
 * Subjective questions: full-image based user_answer detection
 * Cropped images are unreliable for subjective answers (handwriting spans margins/wide areas),
 * so we use the full page image and ask the model to read specific problems' handwritten answers.
 */
export async function detectSubjectiveUserAnswers({ ai, sessionId, imageBase64, mimeType, subjectiveProblems }) {
  if (subjectiveProblems.length === 0) return { marks: [], usageMetadata: null };

  const problemList = subjectiveProblems
    .map(p => `- Q${p.problem_number}: ${p.instruction || ''} / ${p.questionBody || ''}`)
    .join('\n');

  const prompt = `You are looking at an exam page image. Read the student's HANDWRITTEN answers for the following SHORT ANSWER questions.

Questions:
${problemList}

Rules:
- Transcribe the student's handwritten text EXACTLY as written, including spelling mistakes
- Do NOT correct the student's answer — report what they physically wrote
- If you see a correction with an arrow (→), report ONLY the text after the arrow
- If no handwritten answer is found for a question, return null for that question

Output JSON only:
{
  "marks": [
    { "problem_number": "6", "user_answer": "cutting" },
    { "problem_number": "7", "user_answer": "Are" }
  ]
}`;

  const parts = [
    { text: prompt },
    { inlineData: { data: imageBase64, mimeType } },
  ];

  const result = await runWithModelFallback({
    models: LIGHTWEIGHT_MODEL_SEQUENCE,
    callFn: async (model) => {
      const { response, usageMetadata } = await generateWithRetry({
        ai, model,
        contents: [{ role: 'user', parts }],
        sessionId, maxRetries: 2, baseDelayMs: 2000, temperature: 0.0,
      });
      const text = extractTextFromResponse(response, model);
      const parsed = parseJsonResponse(text, model);
      const marks = Array.isArray(parsed?.marks) ? parsed.marks : (Array.isArray(parsed) ? parsed : []);
      console.log(`[passes:SubjectiveUserAnswers] ${model}: ${marks.length}개 주관식 user_answer 감지`, { sessionId });
      return { marks, usageMetadata };
    },
  });
  return result ?? { marks: [], usageMetadata: null };
}

/**
 * 다중빈칸 서술형(multi_blank) 전용 추출 — 한 문항 안의 N개 번호빈칸((1)…(2)…(3)…)에 대해
 * 빈칸별 학생답(user_answers[])과 정답(correct_answers[])을 '배열'로 받는다.
 * - 전체 이미지 1회 호출(detectSubjectiveUserAnswers와 동형). 각 문항의 blankStems(인쇄된 빈칸 문장)를
 *   프롬프트에 명시해 빈칸-답 정렬을 결정적으로 유도.
 * - 빈 빈칸은 user_answers[i]=null. correct_answers[i]는 항상 풀이(빈칸 조건 기반).
 * - 배열 길이는 각 문항 blankStems 길이에 맞춰 pad/truncate(정렬 안정성).
 * - 채점은 상위(computeIsCorrect)에서 항상 기권(자유서술 정확일치 불가) — 여기선 표시용 추출만.
 * @returns {{marks: Array<{problem_number, user_answers: Array<string|null>, correct_answers: Array<string|null>}>, usageMetadata}}
 */
export async function detectMultiBlankAnswers({ ai, sessionId, imageBase64, mimeType, multiBlankProblems }) {
  if (!Array.isArray(multiBlankProblems) || multiBlankProblems.length === 0) {
    return { marks: [], usageMetadata: null };
  }

  const problemBlocks = multiBlankProblems.map((p) => {
    const stems = Array.isArray(p.blankStems) ? p.blankStems : [];
    const blankLines = stems.map((s, i) => `    (${i + 1}) ${String(s || '').replace(/\s+/g, ' ').trim()}`).join('\n');
    return `- Q${p.problem_number} — ${p.instruction || ''}\n  This question has ${stems.length} numbered blanks:\n${blankLines}`;
  }).join('\n');

  const prompt = `You are looking at an exam page image. Some questions contain MULTIPLE numbered blanks (1)(2)(3)… inside ONE problem, and the student fills each blank with a handwritten sentence/phrase (some blanks may be left EMPTY).

Questions (each with its numbered blanks):
${problemBlocks}

Your task, for EACH question, return TWO arrays aligned to the blanks IN ORDER:
- "user_answers": for each blank (1),(2),(3)…, the student's HANDWRITTEN answer transcribed EXACTLY as written (keep their spelling/grammar mistakes). If that specific blank is EMPTY (no handwriting), use null for that position. Do NOT shift answers up — position i MUST correspond to blank (i+1).
- "correct_answers": for each blank, the correct answer you solve for that blank (based on the question conditions / the table shown). Always provide a best correct answer per blank (never null unless truly indeterminable).

Rules:
- Both arrays MUST have EXACTLY one entry per numbered blank, in blank order.
- Transcribe handwriting only (not printed stems/labels). If a correction arrow (→) is present, report only the text after it.
- Write each entry as natural text (no slashes splitting tokens).

Output JSON only:
{
  "marks": [
    { "problem_number": "28", "user_answers": ["the writer who won ...", null, null], "correct_answers": ["the writer who won ...", "the artist who painted ...", "the inventor who invented ..."] }
  ]
}`;

  const parts = [
    { text: prompt },
    { inlineData: { data: imageBase64, mimeType } },
  ];

  const lenByNum = new Map(multiBlankProblems.map(p => [String(p.problem_number), (Array.isArray(p.blankStems) ? p.blankStems.length : 0)]));
  const fitLen = (arr, n) => {
    const a = Array.isArray(arr) ? arr.slice(0, n) : [];
    while (a.length < n) a.push(null);
    return a.map((v) => {
      if (v == null) return null;
      const s = String(v).trim();
      return s === '' ? null : s;
    });
  };

  const result = await runWithModelFallback({
    models: LIGHTWEIGHT_MODEL_SEQUENCE,
    callFn: async (model) => {
      const { response, usageMetadata } = await generateWithRetry({
        ai, model,
        contents: [{ role: 'user', parts }],
        sessionId, maxRetries: 2, baseDelayMs: 2000, temperature: 0.0,
      });
      const text = extractTextFromResponse(response, model);
      const parsed = parseJsonResponse(text, model);
      const raw = Array.isArray(parsed?.marks) ? parsed.marks : (Array.isArray(parsed) ? parsed : []);
      const marks = raw.map((m) => {
        const pn = String(m.problem_number ?? '').trim();
        const n = lenByNum.get(pn) || (Array.isArray(m.correct_answers) ? m.correct_answers.length : 0) || (Array.isArray(m.user_answers) ? m.user_answers.length : 0);
        return {
          problem_number: pn,
          user_answers: fitLen(m.user_answers, n),
          correct_answers: fitLen(m.correct_answers, n),
        };
      });
      console.log(`[passes:MultiBlank] ${model}: ${marks.length}개 다중빈칸 문항 배열 추출`, { sessionId });
      return { marks, usageMetadata };
    },
  });
  return result ?? { marks: [], usageMetadata: null };
}

/**
 * Pass B (Full Image Fallback): bbox 감지 실패 또는 크롭 실패 시
 * 전체 이미지 기반으로 user_answer + correct_answer를 감지
 * 원본: analysisProcessor.ts#detectHandwritingMarks + pageAnalyzer.ts fallback
 */

export async function executePassBFullImage({ ai, sessionId, imageBase64, mimeType, totalPages, focusNumbers = null, modelSequence = LIGHTWEIGHT_MODEL_SEQUENCE }) {
  const prompt = buildHandwritingDetectionPrompt(totalPages, focusNumbers);
  const imagePart = { inlineData: { data: imageBase64, mimeType } };

  // problem_number → mark 인덱스 Map (O(n) 누적)
  const marksMap = new Map();
  let lastUsageMetadata = null;

  for (const model of modelSequence) {
    try {
      console.log(`[passes:PassB-FullImage] ${model}로 전체 이미지 기반 필기 감지 시작...`, { sessionId });

      const parts = [{ text: prompt }, imagePart];
      const { response, usageMetadata } = await generateWithRetry({
        ai, model,
        contents: [{ role: 'user', parts }],
        // 필기 마크 '지각'은 결정성 우선(temp=0.0). 1.0은 동일 마크를 run마다 다른 번호로
        // 흔들어 confident-wrong을 유발(실측: Q40 ③을 2.5-flash가 ①로 오인).
        sessionId, maxRetries: 1, baseDelayMs: 2000, temperature: 0.0,
      });
      lastUsageMetadata = usageMetadata;
      const text = extractTextFromResponse(response, model);
      const parsed = parseJsonResponse(text, model);

      let marks = [];
      if (Array.isArray(parsed?.marks)) {
        marks = parsed.marks;
      } else if (Array.isArray(parsed)) {
        marks = parsed;
      }

      if (marks.length === 0) {
        console.warn(`[passes:PassB-FullImage] ${model}: 0개 marks 반환`, { sessionId });
      } else {
        console.log(`[passes:PassB-FullImage] ${model}: ${marks.length}개 marks 감지`, { sessionId });
      }

      // marks 누적 (problem_number 기준 중복 제거, 기존 null → 새 값으로 업데이트)
      if (marks.length > 0) {
        for (const mark of marks) {
          mark.user_answer = normalizeChoiceValue(mark.user_answer);
          mark.correct_answer = normalizeChoiceValue(mark.correct_answer);
          const key = String(mark.problem_number);
          const existing = marksMap.get(key);
          if (!existing) {
            marksMap.set(key, mark);
          } else if (!existing.user_answer && mark.user_answer) {
            marksMap.set(key, { ...existing, user_answer: mark.user_answer });
          }
        }

        // 조기 종료 판단:
        // - focusNumbers 지정 시: 모든 focus 문항이 답안과 함께 잡혔을 때만 종료
        //   (모델이 focus 문항을 아예 누락하면 다음 모델을 계속 시도)
        // - 미지정 시: 반환된 모든 marks에 답안이 있으면 종료
        if (Array.isArray(focusNumbers) && focusNumbers.length > 0) {
          const allFocusAnswered = focusNumbers.every(n => {
            const mk = marksMap.get(String(n));
            return mk && mk.user_answer != null && String(mk.user_answer).trim() !== '';
          });
          if (allFocusAnswered) {
            console.log(`[passes:PassB-FullImage] 모든 focus 문항(${focusNumbers.join(',')}) 답안 확보, 조기 종료`, { sessionId });
            break;
          }
        } else {
          const nullCount = [...marksMap.values()].filter(m => !m.user_answer).length;
          if (nullCount === 0) {
            console.log(`[passes:PassB-FullImage] 모든 marks에 답안 있음, 조기 종료`, { sessionId });
            break;
          }
        }
      }
    } catch (err) {
      console.warn(`[passes:PassB-FullImage] ${model} 실패 (비치명적):`, err?.message, { sessionId });
    }
  }

  const allMarks = [...marksMap.values()];
  console.log(`[passes:PassB-FullImage] 완료: ${allMarks.length}개 marks`, { sessionId });
  return { marks: allMarks, usageMetadata: lastUsageMetadata };
}
