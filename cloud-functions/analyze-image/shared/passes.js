/**
 * passes.js — 하위호환 barrel
 *
 * 4-Pass 실행기·답 정제기가 역할별 모듈로 분리되었다(행위보존 리팩터링):
 *   - answerSanitizers.js : 답 정규화/정제 순수함수 (normalizeChoiceValue, sanitizeMcAnswer 등)
 *   - modelFallback.js    : runWithModelFallback
 *   - passA.js            : executePassA (구조 추출 + DocAI Pre-OCR)
 *   - pass0.js            : executePass0 (bbox 좌표)
 *   - passB.js            : Pass B 계열 (크롭/전체이미지 필기 인식, 주관식·다중빈칸)
 *   - passC.js            : executePassC (분류)
 *
 * 기존 import 경로(./passes.js)를 깨지 않기 위해 원본 공개 API 16종을 전부 re-export한다.
 * 새 코드는 개별 모듈을 직접 import할 것.
 */

export {
  normalizeChoiceValue,
  sanitizeMcAnswer,
  parseInlineChoiceOptions,
  sanitizeWordChoiceAnswer,
  parseNumberedBlanks,
  sanitizeMcAnswerSet,
  flattenMcAnswerSet,
} from './answerSanitizers.js';

export { executePassA } from './passA.js';

export { executePass0 } from './pass0.js';

export {
  detectFromCrops,
  detectCorrectFromCrops,
  executePassB,
  detectSubjectiveUserAnswers,
  detectMultiBlankAnswers,
  executePassBFullImage,
} from './passB.js';

export { executePassC } from './passC.js';
