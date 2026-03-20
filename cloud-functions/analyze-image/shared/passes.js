/**
 * Pass 실행 모듈
 * - Pass A: 구조 추출 (문제 텍스트, 선택지, 지문)
 * - Pass 0: 바운딩 박스 좌표 추출
 * - Pass B: 필기 인식 (user_answer + correct_answer)
 * - Pass C: 분류 (classification + metadata)
 */

import { callModelWithFailover, generateWithRetry, extractTextFromResponse, parseJsonResponse } from './aiClient.js';
import { LIGHTWEIGHT_MODEL_SEQUENCE, CLASSIFICATION_SCHEMA } from './config.js';
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
  const prompt = buildPrompt(taxonomyData, 'ko', 1);
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
        sessionId, maxRetries: 1, baseDelayMs: 3000, temperature: 0.0,
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
 * 크롭된 이미지 배열에 대해 모델 호출
 */
async function detectFromCrops({ ai, sessionId, crops, buildPromptFn }) {
  if (crops.length === 0) return { marks: [], usageMetadata: null };

  const parts = [{ text: buildPromptFn(crops.length) }];
  for (const crop of crops) {
    parts.push({ text: `Problem ${crop.problem_number}:` });
    parts.push({ inlineData: { data: crop.croppedBase64, mimeType: crop.mimeType } });
  }

  for (const model of LIGHTWEIGHT_MODEL_SEQUENCE) {
    try {
      const { response, usageMetadata } = await generateWithRetry({
        ai, model,
        contents: [{ role: 'user', parts }],
        sessionId, maxRetries: 1, baseDelayMs: 3000, temperature: 0.0,
      });
      const text = extractTextFromResponse(response, model);
      const parsed = parseJsonResponse(text, model);
      const marks = Array.isArray(parsed) ? parsed : (parsed.marks || parsed.problems || []);
      return { marks, usageMetadata };
    } catch (modelError) {
      console.warn(`[passes] Pass B 모델 ${model} 실패:`, modelError?.message);
      continue;
    }
  }

  return { marks: [], usageMetadata: null };
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
export async function executePassB({ ai, sessionId, answerAreaCrops, fullCrops }) {
  const [userResult, correctResult] = await Promise.all([
    detectFromCrops({ ai, sessionId, crops: answerAreaCrops, buildPromptFn: buildCroppedUserAnswerPrompt }),
    detectFromCrops({ ai, sessionId, crops: fullCrops, buildPromptFn: buildCroppedCorrectAnswerPrompt }),
  ]);

  const mergedMarks = mergeUserAndCorrectMarks(userResult.marks, correctResult.marks);
  return {
    marks: mergedMarks,
    usageMetadata: userResult.usageMetadata || correctResult.usageMetadata,
  };
}

/**
 * Pass C: 분류 - 추출된 문제에 classification과 metadata 할당
 */
export async function executePassC({ ai, sessionId, taxonomyData, pageItems, userLanguage }) {
  const MAX_PASSAGE_LENGTH = 1500;
  const MAX_CHOICE_LENGTH = 200;

  const itemsSummary = pageItems.map(problem => {
    const instruction = problem.instruction || problem.question_text || problem.stem || '';
    const passage = (problem._resolved_passage || problem.passage || '').substring(0, MAX_PASSAGE_LENGTH);
    const choicesText = (problem.choices || [])
      .map(choice => (typeof choice === 'string' ? choice : (choice?.text || '')).substring(0, MAX_CHOICE_LENGTH))
      .join(' / ');
    return `### Problem ${problem.problem_number}\nInstruction: ${instruction}\nPassage: ${passage}\nChoices: ${choicesText}`;
  }).join('\n\n');

  const prompt = buildClassificationPrompt(taxonomyData, itemsSummary, userLanguage);
  const parts = [{ text: prompt }];

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
