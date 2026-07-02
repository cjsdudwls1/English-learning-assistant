/**
 * 채점 안전망 (Stage 1) — 백엔드 computeIsCorrect(cloud-functions/.../shared/dbOperations.js)의
 * detectMultiAnswer / extractOptionDigits / isDigitWordMismatch와 1:1 정합.
 *
 * 목적: 복수답안(Bug B)·어형선택 단위불일치(Bug D)처럼 단일값 비교로 채점 불가한 문항을
 * 프론트 표시 단계에서 감지하여 '수동 확인'으로 처리 — 저장된 구(舊) is_correct나 편집 시
 * 자동판정이 confident-wrong(자신있는 오답/오정답)을 내지 않도록 방어.
 *
 * 백엔드 수정은 향후 분석에만 반영되므로, 이미 저장된 라벨의 표시 교정은 이 클라이언트 게이트가 담당.
 * false-positive는 '수동 확인'(기권)으로 이어질 뿐이라 confident-wrong보다 안전(precision-first).
 */

/** "정답 N개 / 모두 고르면 / 단, N개" 지시문 또는 정답이 (1)…(2)… 번호매김인지 감지. */
export function detectMultiAnswer(instruction?: string | null, correctAns?: string | null): boolean {
  const inst = String(instruction || '');
  if (/모두\s*고르/.test(inst)) return true;
  if (/정답[^0-9]{0,3}[2-9]\s*개/.test(inst)) return true;
  if (/단[,\s]*[2-9]\s*개/.test(inst)) return true;
  if (/[2-9]\s*개[^.]{0,8}(고르|모두)/.test(inst)) return true;
  if (/\(\s*[1-9]\s*\)[\s\S]*\(\s*[1-9]\s*\)/.test(String(correctAns || ''))) return true;
  return false;
}

/** 문자열에서 선택지 번호(원문자 ①~⑨ 및 1~9 숫자)만 정수 집합으로 추출. */
export function extractOptionDigits(s?: string | null): Set<number> {
  const str = String(s || '');
  const set = new Set<number>();
  const circled = '①②③④⑤⑥⑦⑧⑨';
  for (const ch of str) {
    const ci = circled.indexOf(ch);
    if (ci !== -1) set.add(ci + 1);
  }
  for (const m of str.matchAll(/\d+/g)) {
    const n = parseInt(m[0], 10);
    if (n >= 1 && n <= 9) set.add(n);
  }
  return set;
}

/** choices 없는 빈칸에서 한쪽=순수 숫자, 다른쪽=알파벳/한글 단어인 단위 불일치(Bug D) 감지. */
export function isDigitWordMismatch(userAns?: string | null, correctAns?: string | null): boolean {
  const u = String(userAns || '').trim();
  const c = String(correctAns || '').trim();
  const isDigit = (x: string) => /^\d+$/.test(x);
  const isWord = (x: string) => /[a-zA-Z가-힣]/.test(x) && !/^\d+$/.test(x);
  return (isDigit(u) && isWord(c)) || (isDigit(c) && isWord(u));
}

export type ManualReviewReason = '복수정답' | '형식확인';

/**
 * 문항이 수동 확인 대상인지 판정. 백엔드 computeIsCorrect의 기권(null) 조건과 정합:
 *  - 복수답안: 객관식 정답 집합이 온전히 추출된 경우(hasChoices && |correct|>=2 && |user|>=|correct|)만
 *    백엔드가 완전일치로 채점하므로 그때는 null(자동 채점 신뢰) — 그 외에는 '복수정답'.
 *  - 어형선택 단위 불일치: choices 없고 숫자↔단어 불일치면 '형식확인'.
 * @returns 사유 문자열, 또는 자동 채점 가능하면 null
 */
export function getManualReviewReason(args: {
  instruction?: string | null;
  correctAnswer?: string | null;
  userAnswer?: string | null;
  hasChoices?: boolean;
}): ManualReviewReason | null {
  const { instruction, correctAnswer, userAnswer, hasChoices } = args;

  if (detectMultiAnswer(instruction, correctAnswer)) {
    const cd = extractOptionDigits(correctAnswer);
    const ud = extractOptionDigits(userAnswer);
    // 백엔드가 집합 완전비교로 채점하는 조건이면 자동 채점 신뢰(수동 확인 불필요)
    if (hasChoices && cd.size >= 2 && ud.size >= cd.size) return null;
    return '복수정답';
  }

  if (!hasChoices && isDigitWordMismatch(userAnswer, correctAnswer)) {
    return '형식확인';
  }

  return null;
}
