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
  if (/모두\s*고른/.test(inst)) return true;
  if (/정답[^0-9]{0,3}[2-9]\s*개/.test(inst)) return true;
  if (/단[,\s]*[2-9]\s*개/.test(inst)) return true;
  if (/[2-9]\s*개[^.]{0,8}(고르|모두)/.test(inst)) return true;
  if (/all\s*that\s*apply/i.test(inst)) return true;
  if (/select\s*all/i.test(inst)) return true;
  if (/\(\s*[1-9]\s*\)[\s\S]*\(\s*[1-9]\s*\)/.test(String(correctAns || ''))) return true;
  if (/[①②③④⑤⑥⑦⑧⑨][\s,、·]*[①②③④⑤⑥⑦⑧⑨]/.test(String(correctAns || ''))) return true;
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

/** 두 정수 집합의 완전 일치 여부(부분점수 없음). 백엔드 dbOperations.js#eqSet과 정합. */
export function eqSet(a: Set<number>, b: Set<number>): boolean {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}

export type ManualReviewReason = '복수정답' | '형식확인';

/**
 * 문항이 수동 확인 대상인지 판정. 백엔드 computeIsCorrect의 기권(null) 조건과 정합:
 *  - answerFormat==='unknown': 백엔드가 형식 판단 불가로 표시 → 현행 기권 안전망 유지('형식확인').
 *  - 복수답안(answerFormat==='multi' 또는 문자열 휴리스틱 감지):
 *    - correctAnswers/userAnswers(번호 집합)가 |correct|>=2 && |user|>=|correct| 조건을 충족하면
 *      백엔드가 eqSet 완전일치로 채점 → null(자동 채점 신뢰). (백엔드 computeIsCorrect 게이트와 1:1 정합)
 *    - 배열이 없거나 조건 미충족이면(레거시 데이터·미확신·정답 1개 추출·선택 부족) 기존 문자열 기반
 *      추출(extractOptionDigits)로 폴백 — hasChoices && |correct|>=2 && |user|>=|correct| 조건
 *      충족 시만 null, 그 외 '복수정답'.
 *  - 어형선택 단위 불일치: choices 없고 숫자↔단어 불일치면 '형식확인'.
 * @returns 사유 문자열, 또는 자동 채점 가능하면 null
 */
export function getManualReviewReason(args: {
  instruction?: string | null;
  correctAnswer?: string | null;
  userAnswer?: string | null;
  hasChoices?: boolean;
  answerFormat?: 'single' | 'multi' | 'multi_blank' | 'unknown' | null;
  correctAnswers?: number[] | null;
  userAnswers?: number[] | null;
}): ManualReviewReason | null {
  const { instruction, correctAnswer, userAnswer, hasChoices, answerFormat, correctAnswers, userAnswers } = args;

  if (answerFormat === 'unknown') return '형식확인';

  // 다중빈칸 서술형(multi_blank): 빈칸별 자유서술 → 단일 비교/집합 채점 불가. 항상 수동 확인(자동 O/X 금지).
  // (flat correct_answer가 "(1)…(2)…" 형태라 아래 detectMultiAnswer에 걸려도 오작동하지 않도록 여기서 선차단.)
  if (answerFormat === 'multi_blank') return '형식확인';

  if (answerFormat === 'multi' || detectMultiAnswer(instruction, correctAnswer)) {
    // 백엔드가 번호 집합을 확신 추출한 경우 → computeIsCorrect와 동일 게이트로 자동 채점 신뢰
    // (정답 2개 이상 + 사용자 선택이 정답 수 이상일 때만; 정답 1개 추출이거나 사용자가 덜 골랐으면 기권)
    if (Array.isArray(correctAnswers) && Array.isArray(userAnswers)
      && correctAnswers.length >= 2 && userAnswers.length >= correctAnswers.length) {
      return null;
    }
    // 배열 없음(레거시 데이터 또는 미확신) → 기존 문자열 기반 추출로 폴백
    const cd = extractOptionDigits(correctAnswer);
    const ud = extractOptionDigits(userAnswer);
    if (hasChoices && cd.size >= 2 && ud.size >= cd.size) return null;
    return '복수정답';
  }

  if (!hasChoices && isDigitWordMismatch(userAnswer, correctAnswer)) {
    return '형식확인';
  }

  return null;
}
