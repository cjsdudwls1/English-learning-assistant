/**
 * Pass C: 분류 — 추출된 문제에 classification과 metadata 할당
 */

import { generateWithRetry, extractTextFromResponse, parseJsonResponse } from './aiClient.js';
import { LIGHTWEIGHT_MODEL_SEQUENCE, CLASSIFICATION_SCHEMA } from './config.js';
import { buildClassificationPrompt } from './prompts.js';
import { runWithModelFallback } from './modelFallback.js';

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
