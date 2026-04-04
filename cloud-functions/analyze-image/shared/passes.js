/**
 * Pass 실행 모듈
 * - Pass A: 구조 추출 (문제 텍스트, 선택지, 지문)
 * - Pass 0: 바운딩 박스 좌표 추출
 * - Pass B: 필기 인식 (user_answer + correct_answer)
 * - Pass C: 분류 (classification + metadata)
 */

import { callDocumentAI } from './documentAiClient.js';
import { callModelWithFailover, generateWithRetry, extractTextFromResponse, parseJsonResponse } from './aiClient.js';
import { LIGHTWEIGHT_MODEL_SEQUENCE, CLASSIFICATION_SCHEMA } from './config.js';
import * as config from './config.js';
import {
  buildPrompt,
  buildBoundingBoxPrompt,
  buildCroppedUserAnswerPrompt,
  buildCroppedCorrectAnswerPrompt,
  buildClassificationPrompt,
} from './prompts.js';

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

  for (const model of LIGHTWEIGHT_MODEL_SEQUENCE) {
    try {
      const { response, usageMetadata } = await generateWithRetry({
        ai, model,
        contents: [{ role: 'user', parts }],
        sessionId, maxRetries: 2, baseDelayMs: 2000, temperature: 1.0,
      });
      const text = extractTextFromResponse(response, model);
      const parsed = parseJsonResponse(text, model);
      return { bboxes: parsed.problems || [], usageMetadata };
    } catch (modelError) {
      console.warn(`[passes] Pass 0 모델 ${model} 실패:`, modelError?.message);
      continue;
    }
  }

  return { bboxes: [], usageMetadata: null };
}

/**
 * 크롭된 이미지 배열에 대해 개별 모델 호출
 * 원본: analysisProcessor.ts#detectHandwritingFromCroppedImages
 * - 각 크롭 이미지를 개별 API 호출로 처리 (배치 3개씩 병렬)
 * - buildPromptFn에 problem_number를 전달하여 문제별 프롬프트 생성
 */
async function detectFromCrops({ ai, sessionId, crops, buildPromptFn, questionContextMap, temperature = 1.0 }) {
  if (crops.length === 0) return { marks: [], usageMetadata: null };

  const model = LIGHTWEIGHT_MODEL_SEQUENCE[0];
  const marks = [];
  let lastUsageMetadata = null;

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

        try {
          const { response, usageMetadata } = await generateWithRetry({
            ai, model,
            contents: [{ role: 'user', parts }],
            sessionId, maxRetries: 2, baseDelayMs: 1500, temperature,
          });
          lastUsageMetadata = usageMetadata;
          const text = extractTextFromResponse(response, model);
          const parsed = parseJsonResponse(text, model);
          return {
            problem_number: parsed.problem_number || crop.problem_number,
            user_answer: parsed.user_answer ?? null,
            correct_answer: parsed.correct_answer ?? null,
          };
        } catch (err) {
          console.error(`[passes:detectFromCrops] Q${crop.problem_number} 실패:`, err?.message);
          return null;
        }
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
 */
export async function executePassB({ ai, sessionId, answerAreaCrops, fullCrops, questionContextMap }) {
  const [userResult, correctResult] = await Promise.all([
    detectFromCrops({ ai, sessionId, crops: answerAreaCrops, buildPromptFn: buildCroppedUserAnswerPrompt, questionContextMap }),
    detectFromCrops({ ai, sessionId, crops: fullCrops, buildPromptFn: buildCroppedCorrectAnswerPrompt, questionContextMap }),
  ]);

  const mergedMarks = mergeUserAndCorrectMarks(userResult.marks, correctResult.marks);
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

  for (const model of LIGHTWEIGHT_MODEL_SEQUENCE) {
    try {
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
    } catch (err) {
      console.warn(`[passes:SubjectiveUserAnswers] ${model} 실패:`, err?.message, { sessionId });
      continue;
    }
  }
  return { marks: [], usageMetadata: null };
}

/**
 * Pass B (Full Image Fallback): bbox 감지 실패 또는 크롭 실패 시
 * 전체 이미지 기반으로 user_answer + correct_answer를 감지
 * 원본: analysisProcessor.ts#detectHandwritingMarks + pageAnalyzer.ts fallback
 */
import { buildHandwritingDetectionPrompt } from './prompts.js';

export async function executePassBFullImage({ ai, sessionId, imageBase64, mimeType, totalPages }) {
  const prompt = buildHandwritingDetectionPrompt(totalPages);
  const imagePart = { inlineData: { data: imageBase64, mimeType } };

  let allMarks = [];
  let lastUsageMetadata = null;

  for (const model of LIGHTWEIGHT_MODEL_SEQUENCE) {
    try {
      console.log(`[passes:PassB-FullImage] ${model}로 전체 이미지 기반 필기 감지 시작...`, { sessionId });

      const parts = [{ text: prompt }, imagePart];
      const { response, usageMetadata } = await generateWithRetry({
        ai, model,
        contents: [{ role: 'user', parts }],
        sessionId, maxRetries: 1, baseDelayMs: 2000, temperature: 1.0,
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
          const existing = allMarks.find(m => String(m.problem_number) === String(mark.problem_number));
          if (!existing) {
            allMarks.push(mark);
          } else if (!existing.user_answer && mark.user_answer) {
            const idx = allMarks.indexOf(existing);
            allMarks[idx] = { ...existing, user_answer: mark.user_answer };
          }
        }

        // 모든 marks에 user_answer가 있으면 조기 종료
        const nullCount = allMarks.filter(m => !m.user_answer).length;
        if (nullCount === 0) {
          console.log(`[passes:PassB-FullImage] 모든 marks에 답안 있음, 조기 종료`, { sessionId });
          break;
        }
      }
    } catch (err) {
      console.warn(`[passes:PassB-FullImage] ${model} 실패 (비치명적):`, err?.message, { sessionId });
    }
  }

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


  for (const model of LIGHTWEIGHT_MODEL_SEQUENCE) {
    try {
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
    } catch (modelError) {
      console.warn(`[passes] Pass C 모델 ${model} 실패:`, modelError?.message);
      continue;
    }
  }

  return { classifications: [], usageMetadata: null };
}
