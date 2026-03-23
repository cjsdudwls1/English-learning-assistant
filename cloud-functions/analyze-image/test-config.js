/**
 * test-config.js — 테스트 케이스 정의
 *
 * ground truth: 이미지 5장, 총 23문제
 * - 이어지는 지문 4장: 객관식 14문제 (4+3+3+4)
 * - 맨 처음 받은거 1장: 객관식 5 + 주관식 4 = 9문제
 */

import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 테스트 이미지 루트 경로
const IMAGE_DIR = path.resolve(__dirname, '../../test_image/이어지는 지문');
const IMAGE_DIR_2 = path.resolve(__dirname, '../../test_image/맨 처음 받은거');

export const TEST_CASES = [
  {
    id: 'img06',
    imagePath: path.join(IMAGE_DIR, 'KakaoTalk_20251202_101043325_06.jpg'),
    expectedUser: '1,4,3,4',
    expectedCorrect: '4,5,3,1',
    flexibleUser: { 0: ['1', '2'] },
  },
  {
    id: 'img07',
    imagePath: path.join(IMAGE_DIR, 'KakaoTalk_20251202_101043325_07.jpg'),
    expectedUser: '4,5,2',
    expectedCorrect: '5,3,5',
    flexibleUser: {},
  },
  {
    id: 'img08',
    imagePath: path.join(IMAGE_DIR, 'KakaoTalk_20251202_101043325_08.jpg'),
    expectedUser: '3,4,5',
    expectedCorrect: '5,2,1',
    flexibleUser: { 1: ['4', '5'] },
  },
  {
    id: 'img09',
    imagePath: path.join(IMAGE_DIR, 'KakaoTalk_20251202_101043325_09.jpg'),
    expectedUser: '2,2,4,1',
    expectedCorrect: '1,3,1,3',
    flexibleUser: { 0: ['2', '3'], 2: ['3', '4'] },
  },
  {
    id: 'img-subjective',
    imagePath: path.join(IMAGE_DIR_2, '20250420_134039.jpg'),
    expectedUser: '4,2,3,2,3,cutting,Are,They aren\'t going to clear the streets after school,We planning lot of events for children',
    expectedCorrect: '4,2,3,2,3,cutting,Are,They are not going to clean the streets after school,We are planning a lot of events for children',
    flexibleUser: { 4: ['2', '3'] },  // Q5: ③과 ②가 필기에서 혼동
    // 0-based indices of subjective (short-answer) problems — use fuzzy comparison
    subjectiveIndices: [5, 6, 7, 8],
  },
];

/**
 * Normalize text for subjective answer comparison:
 * lowercase, trim, remove trailing punctuation
 */
function normalizeText(str) {
  return String(str || '')
    .toLowerCase()
    .trim()
    .replace(/[.,!?;:]+$/g, '')
    .trim();
}

/**
 * Token-overlap ratio: fraction of expected tokens found in actual
 */
function tokenOverlap(expected, actual) {
  const expTokens = expected.split(/\s+/).filter(Boolean);
  const actTokens = actual.split(/\s+/).filter(Boolean);
  if (expTokens.length === 0) return actual.length === 0 ? 1 : 0;
  const matched = expTokens.filter(t => actTokens.includes(t)).length;
  return matched / expTokens.length;
}

/**
 * Subjective answer comparison:
 * 1. Exact match after normalization
 * 2. One contains the other (handles prefix/suffix differences)
 * 3. Token overlap >= 80%
 */
export function checkSubjectiveMatch(expected, actual) {
  if (!actual && !expected) return true;
  if (!actual || !expected) return false;

  const normExp = normalizeText(expected);
  const normAct = normalizeText(actual);

  if (normExp === normAct) return true;
  if (normAct.includes(normExp) || normExp.includes(normAct)) return true;
  if (tokenOverlap(normExp, normAct) >= 0.8) return true;

  return false;
}

/**
 * user_answer verification:
 * - flexibleUser: multiple allowed values for ambiguous handwriting
 * - subjectiveIndices: fuzzy comparison for short-answer questions
 * - otherwise: exact match
 */
export function checkUserAnswer(testCase, problemIdx, actualValue) {
  const allowed = testCase.flexibleUser[problemIdx];
  if (allowed) {
    return allowed.includes(String(actualValue));
  }
  const expected = testCase.expectedUser.split(',').map(s => s.trim());
  const expVal = expected[problemIdx];

  if (testCase.subjectiveIndices?.includes(problemIdx)) {
    return checkSubjectiveMatch(expVal, actualValue);
  }
  return String(actualValue) === expVal;
}

/**
 * correct_answer verification:
 * - subjectiveIndices: fuzzy comparison
 * - otherwise: exact match
 */
export function checkCorrectAnswer(testCase, problemIdx, actualValue) {
  const expected = testCase.expectedCorrect.split(',').map(s => s.trim());
  const expVal = expected[problemIdx];

  if (testCase.subjectiveIndices?.includes(problemIdx)) {
    return checkSubjectiveMatch(expVal, actualValue);
  }
  return String(actualValue) === expVal;
}
