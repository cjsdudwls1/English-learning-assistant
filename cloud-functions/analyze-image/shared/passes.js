/**
 * Pass 실행 모듈
 * - Pass A: 구조 추출 (문제 텍스트, 선택지, 지문)
 * - Pass 0: 바운딩 박스 좌표 추출
 * - Pass B: 필기 인식 (user_answer + correct_answer)
 * - Pass C: 분류 (classification + metadata)
 */

import { callDocumentAI } from './documentAiClient.js';
import { callModelWithFailover, generateWithRetry, extractTextFromResponse, parseJsonResponse } from './aiClient.js';
import { LIGHTWEIGHT_MODEL_SEQUENCE, ANSWER_MODEL_SEQUENCE, USER_ANSWER_MODEL_SEQUENCE, CLASSIFICATION_SCHEMA } from './config.js';
import * as config from './config.js';
import {
  buildPrompt,
  buildBoundingBoxPrompt,
  buildCroppedUserAnswerPrompt,
  buildCroppedCorrectAnswerPrompt,
  buildClassificationPrompt,
  buildHandwritingDetectionPrompt,
} from './prompts.js';

// 원문자(①②③④⑤…) → ASCII 숫자 정규화 백스톱.
// 프롬프트로 ASCII 출력을 지시해도 모델이 간헐적으로 원문자를 반환하므로 코드 레벨에서 강제 변환한다.
const CIRCLED_TO_ASCII = { '①': '1', '②': '2', '③': '3', '④': '4', '⑤': '5', '⑥': '6', '⑦': '7', '⑧': '8', '⑨': '9', '⑩': '10' };
function normalizeChoiceValue(v) {
  if (v == null) return v;
  let s = String(v);
  for (const [glyph, digit] of Object.entries(CIRCLED_TO_ASCII)) {
    if (s.includes(glyph)) s = s.split(glyph).join(digit);
  }
  return s;
}

/**
 * MC 답안 범위 정합성(§3 하드닝): 객관식 답이 '한 자리 숫자인데 1~5 밖'이면 null로 무효화.
 * - 선택지 범위(1~5) 위반은 명백한 오인 → confident-wrong보다 null(기권)이 안전(정밀도 우선).
 * - 서술형(isSubjective)은 텍스트 답이므로 절대 건드리지 않는다.
 * - 여러 자리/단어 등은 보존(여기서 과도하게 null하지 않음 — 상위 폴백이 처리).
 */
function sanitizeMcAnswer(value, isSubjective) {
  if (value == null) return null;
  if (isSubjective) return value;
  const s = String(value).trim();
  if (s === '') return null;
  if (/^[0-9]$/.test(s)) return /^[1-5]$/.test(s) ? s : null;
  return value;
}

/**
 * 모델 시퀀스를 순서대로 시도하고 첫 성공 결과를 반환
 * @param {{ models: string[], callFn: (model: string) => Promise<any> }} opts
 * @returns {Promise<any>} 성공한 모델의 결과, 모두 실패 시 null 반환
 */
async function runWithModelFallback({ models, callFn }) {
  for (const model of models) {
    try {
      return await callFn(model);
    } catch (err) {
      console.warn(`[passes:runWithModelFallback] ${model} 실패:`, err?.message);
    }
  }
  return null;
}

/**
 * Pass A: 구조 추출 - 이미지에서 문제/지문/선택지 추출
 */
export async function executePassA({ ai, sessionId, imageBase64, mimeType, pageNum, totalPages, taxonomyData, preferredModel }) {
  // Document AI Pre-OCR: 환경변수가 설정된 경우에만 실행
  let ocrPages = [];

  if (config.DOCUMENT_AI_ENABLED) {
    try {
      console.log(`[PreOCR] Document AI Pre-OCR 시작 (Session: ${sessionId}, Page: ${pageNum}/${totalPages})`);
      const docAiResult = await callDocumentAI(imageBase64, mimeType);
      
      // Document AI 반환값 {text, pages}를 buildPrompt가 요구하는 형식으로 변환
      // buildPrompt의 ocrPages: Array<{page: number, text: string}>
      if (docAiResult.text && docAiResult.text.trim().length > 0) {
        ocrPages = [{ page: pageNum, text: docAiResult.text }];
        console.log(`[PreOCR] Document AI 성공: ${docAiResult.text.length}자 추출 (페이지 ${pageNum})`);
      } else {
        console.warn(`[PreOCR] Document AI가 텍스트를 반환하지 않음, Gemini 직접 OCR로 fallback`);
      }
    } catch (error) {
      console.error(`[PreOCR] Document AI 호출 실패, Gemini 직접 OCR로 fallback:`, error?.message);
      ocrPages = [];
    }
  }

  const prompt = buildPrompt(taxonomyData, 'ko', 1, ocrPages);

  const parts = [
    { text: prompt },
    { text: `Page ${pageNum} of ${totalPages}. Extract all printed text and structure from this exam page image.` },
    { inlineData: { data: imageBase64, mimeType } },
  ];
  return await callModelWithFailover({ ai, sessionId, parts, preferredModel });
}

/**
 * Pass 0: 바운딩 박스 좌표 추출
 * @returns {{ bboxes: Array, usageMetadata: object|null }}
 */
export async function executePass0({ ai, sessionId, imageBase64, mimeType }) {
  const prompt = buildBoundingBoxPrompt();
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
      const bboxes = parsed.problems || [];
      if (bboxes.length === 0) {
        console.warn(`[passes] Pass 0 모델 ${model}이 bbox 0개 반환, 다음 모델로 폴백`);
        throw new Error('bbox 0개');
      }
      return { bboxes, usageMetadata };
    },
  });

  return result ?? { bboxes: [], usageMetadata: null };
}

/**
 * 크롭된 이미지 배열에 대해 개별 모델 호출
 * 원본: analysisProcessor.ts#detectHandwritingFromCroppedImages
 * - 각 크롭 이미지를 개별 API 호출로 처리 (배치 3개씩 병렬)
 * - buildPromptFn에 problem_number를 전달하여 문제별 프롬프트 생성
 */
async function detectFromCrops({ ai, sessionId, crops, buildPromptFn, questionContextMap, temperature = 0.0, modelSequence }) {
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
            return {
              problem_number: parsed.problem_number || crop.problem_number,
              user_answer: sanitizeMcAnswer(normalizeChoiceValue(parsed.user_answer ?? null), isSubjective),
              correct_answer: sanitizeMcAnswer(normalizeChoiceValue(parsed.correct_answer ?? null), isSubjective),
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
 * Pass B: 필기 인식 - 크롭된 답안/문제 영역에서 user_answer, correct_answer 추출
 * user_answer: 필기 마크 인식 (지각 작업) - temperature=0.0으로 결정성 확보
 * correct_answer: 정답 추론 (논리 작업) - temperature=0.0 + 강한 모델 우선
 */
export async function executePassB({ ai, sessionId, answerAreaCrops, fullCrops, questionContextMap }) {
  const [userResult, correctResult] = await Promise.all([
    detectFromCrops({
      ai, sessionId, crops: answerAreaCrops,
      buildPromptFn: buildCroppedUserAnswerPrompt,
      questionContextMap,
      temperature: 0.0,
      // 필기 마크 '지각'은 신형 비전이 우월 → 3.5-flash 우선(2.5-flash의 인접번호 오인 회피)
      modelSequence: USER_ANSWER_MODEL_SEQUENCE,
    }),
    detectFromCrops({
      ai, sessionId, crops: fullCrops,
      buildPromptFn: buildCroppedCorrectAnswerPrompt,
      questionContextMap,
      temperature: 0.0,
      // 정답 추론은 정확도 우선 → 최상위 모델 시퀀스 사용 (config.ANSWER_MODEL_SEQUENCE)
      modelSequence: ANSWER_MODEL_SEQUENCE,
    }),
  ]);

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

/**
 * Pass C: 분류 - 추출된 문제에 classification과 metadata 할당
 * imageBase64, mimeType: visual_context가 있는 문제가 존재할 때 원본 이미지 전달용
 * 원본: pageAnalyzer.ts#analyzeOnePage (Pass C 섹션)
 */
export async function executePassC({ ai, sessionId, taxonomyData, pageItems, userLanguage, imageBase64, mimeType }) {
  const MAX_PASSAGE_LENGTH = 1500;
  const MAX_CHOICE_LENGTH = 200;

  const itemsSummary = pageItems.map(problem => {
    const instruction = problem.instruction || problem.question_text || problem.stem || '';
    const passage = (problem._resolved_passage || problem.passage || '').substring(0, MAX_PASSAGE_LENGTH);
    const choicesText = (problem.choices || [])
      .map(choice => (typeof choice === 'string' ? choice : (choice?.text || '')).substring(0, MAX_CHOICE_LENGTH))
      .join(' / ');
    // visual_context 정보도 포함 (그래프/도표/안내문 등)
    let visualInfo = '';
    if (problem.visual_context) {
      const vc = problem.visual_context;
      visualInfo = `\nVisual context [${vc.type || 'visual'}]: ${vc.title || ''}\n${(vc.content || '').substring(0, 500)}`;
    }
    return `### Problem ${problem.problem_number}\nInstruction: ${instruction}\nPassage: ${passage}${visualInfo}\nChoices: ${choicesText}`;
  }).join('\n\n');

  const prompt = buildClassificationPrompt(taxonomyData, itemsSummary, userLanguage);
  const parts = [{ text: prompt }];

  // visual_context가 있는 문제가 존재하면 원본 이미지를 함께 전달
  const hasVisualItems = pageItems.some(it => it.visual_context);
  if (hasVisualItems && imageBase64) {
    parts.push({ inlineData: { data: imageBase64, mimeType } });
  }


  const result = await runWithModelFallback({
    models: LIGHTWEIGHT_MODEL_SEQUENCE,
    callFn: async (model) => {
      const { response, usageMetadata } = await generateWithRetry({
        ai, model,
        contents: [{ role: 'user', parts }],
        sessionId, maxRetries: 1, baseDelayMs: 3000, temperature: 0.0,
        responseJsonSchema: CLASSIFICATION_SCHEMA,
      });
      const text = extractTextFromResponse(response, model);
      const parsed = parseJsonResponse(text, model);
      const classifications = parsed.classifications || (Array.isArray(parsed) ? parsed : []);
      return { classifications, usageMetadata };
    },
  });

  return result ?? { classifications: [], usageMetadata: null };
}
