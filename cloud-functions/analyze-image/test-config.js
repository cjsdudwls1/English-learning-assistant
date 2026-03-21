/**
 * test-config.js — 테스트 케이스 정의
 *
 * memo.md 기반 ground truth: 이미지 4장, 총 14문제
 * 분배: 4, 3, 3, 4
 */

import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 테스트 이미지 루트 경로
const IMAGE_DIR = path.resolve(__dirname, '../../../test_image/이어지는 지문/이어지는 지문');

export const TEST_CASES = [
  {
    id: 'img06',
    imagePath: path.join(IMAGE_DIR, 'KakaoTalk_20251202_101043325_06.jpg'),
    expectedUser: '1,4,3,4',
    expectedCorrect: '4,5,3,1',
    // 애매한 필기: 인덱스별 허용 user_answer 목록
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
    flexibleUser: { 1: ['4', '5'] },  // 전체 9번(인덱스1): 4 또는 5
  },
  {
    id: 'img09',
    imagePath: path.join(IMAGE_DIR, 'KakaoTalk_20251202_101043325_09.jpg'),
    expectedUser: '2,2,4,1',
    expectedCorrect: '1,3,1,3',
    flexibleUser: { 0: ['2', '3'], 2: ['3', '4'] },  // 전체 11번(인덱스0): 2또는3, 전체 13번(인덱스2): 3또는4
  },
];

/**
 * user_answer 검증: flexible 허용값이 있으면 includes, 없으면 exact match
 */
export function checkUserAnswer(testCase, problemIdx, actualValue) {
  const allowed = testCase.flexibleUser[problemIdx];
  if (allowed) {
    return allowed.includes(String(actualValue));
  }
  const expected = testCase.expectedUser.split(',').map(s => s.trim());
  return String(actualValue) === expected[problemIdx];
}
