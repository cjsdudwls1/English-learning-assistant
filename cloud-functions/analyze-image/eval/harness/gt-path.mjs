/**
 * GT 라벨 파일 선택 (`--gt <파일>`).
 *
 * 라벨 세트는 품질 계층이 다르다 — `ground-truth.json`은 correct_answer 근거가 사람 추론이고,
 * `draft-answerkey-*.json`은 인쇄된 해설지로 확정한 것이다. 한 파일에 합치면 "정확도 X%"가
 * 두 계층의 평균이 되어 어느 쪽 문제인지 분간할 수 없고, 문항 수가 달라져 이전 결과 파일과의
 * 상대 비교(이 하네스가 유일하게 신뢰하는 비교 방식)도 끊긴다. 그래서 합치지 않고 고른다.
 *
 * 기본값은 종전과 같은 `ground-truth.json`이라 옵션을 안 주면 동작이 바뀌지 않는다.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const LABELS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../labels');
const DEFAULT_GT = path.join(LABELS_DIR, 'ground-truth.json');

/** 파일명만 주면 eval/labels/ 기준, 경로가 섞여 있으면 cwd 기준으로 해석한다. */
function resolve(v) {
  return v.includes('/') || v.includes('\\') ? path.resolve(v) : path.join(LABELS_DIR, v);
}

/**
 * argv에서 `--gt <파일>`을 떼어낸다.
 * @returns {{ gtPath: string, rest: string[] }} rest는 `--gt` 쌍을 제거한 argv (위치 인자용)
 */
export function takeGtPath(argv) {
  const rest = [];
  let gtPath = DEFAULT_GT;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--gt' && i + 1 < argv.length) gtPath = resolve(argv[++i]);
    else rest.push(argv[i]);
  }
  return { gtPath, rest };
}

/** 위치 인자를 쓰지 않는 스크립트용 단축형. */
export function resolveGtPath(argv) {
  return takeGtPath(argv).gtPath;
}
