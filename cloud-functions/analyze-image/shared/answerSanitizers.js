/**
 * 답안 정제기(순수함수) 모음 — 모델 출력의 형식 오염을 코드 레벨에서 차단한다.
 * 모든 함수는 부수효과 없음(로그 제외). AI 호출·이미지 처리 의존성 없음.
 *
 * 공통 원칙(precision-first): 자신있는 오답(confident-wrong)은 null(기권)보다 해롭다.
 * 형식이 어긋난 답은 환원을 시도하고, 실패하면 null로 기권시킨다.
 */

// 원문자(①②③④⑤…) → ASCII 숫자 정규화 백스톱.
// 프롬프트로 ASCII 출력을 지시해도 모델이 간헐적으로 원문자를 반환하므로 코드 레벨에서 강제 변환한다.
const CIRCLED_TO_ASCII = { '①': '1', '②': '2', '③': '3', '④': '4', '⑤': '5', '⑥': '6', '⑦': '7', '⑧': '8', '⑨': '9', '⑩': '10' };
export function normalizeChoiceValue(v) {
  if (v == null) return v;
  let s = String(v);
  for (const [glyph, digit] of Object.entries(CIRCLED_TO_ASCII)) {
    if (s.includes(glyph)) s = s.split(glyph).join(digit);
  }
  return s;
}

// 매칭용 정규화: 대소문자·공백·구두점 제거(선택지 텍스트 ↔ 답 텍스트 정확 대조).
function normalizeForMatch(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9가-힣]/g, '');
}

/**
 * MC 답안 형식 정합성(§3 하드닝 + 타입체크): 객관식 답은 반드시 선택지 번호("1"~"5")여야 한다.
 * - 서술형(isSubjective)은 텍스트 답이므로 절대 건드리지 않는다.
 * - 한 자리 숫자인데 1~5 밖 → null(선택지 범위 위반 = 명백한 오인).
 * - 숫자가 아닌 텍스트(예: 선택지 문구 "him")가 객관식 답으로 온 경우 → 선택지와 대조해
 *   일치하는 항목의 번호로 환원(형식 정합성 복원). 환원 실패 시 null.
 *   객관식인데 번호로 환원 불가한 텍스트를 그대로 저장하면 채점이 반드시 어긋난다
 *   (실측 12번: correct_answer가 선택지 문구 "him"으로 추출돼 정답을 오답 처리).
 *   null이면 상위 재독해/폴백이 다시 시도하므로 confident-wrong보다 안전(정밀도 우선).
 */
export function sanitizeMcAnswer(value, isSubjective, choices) {
  if (value == null) return null;
  if (isSubjective) return value;
  const s = String(value).trim();
  if (s === '') return null;
  if (/^[0-9]$/.test(s)) return /^[1-5]$/.test(s) ? s : null;
  // 숫자가 아닌 텍스트 답: 선택지와 대조해 번호로 환원 시도.
  const list = Array.isArray(choices) ? choices : [];
  // 선택지 부재 → 객관식 형식 강제 불가(환원 대상 없음). isSubjective=false로 잘못 분류된
  // 서술형 문항(실측 20250420 Q7 정답 "Are"·Q9 문장형)의 자유텍스트 답을 null로 파괴하지
  // 않도록 원값을 보존한다. 진짜 객관식은 항상 선택지를 보유하므로 오염 차단(실측 12번류
  // correct="him")은 그대로 유지된다. 이 게이트가 detectFromCrops(크롭 주경로)와
  // mergeHandwritingMarks(병합 백스톱) 양 호출처를 일괄 보호하는 단일 지점이다.
  if (list.length === 0) return value;
  const target = normalizeForMatch(s);
  if (target) {
    const idx = list.findIndex((c) => {
      const t = typeof c === 'string' ? c : (c?.text || c?.label || '');
      return normalizeForMatch(t) === target;
    });
    if (idx >= 0 && idx < 5) {
      console.log(`[passes:sanitizeMcAnswer] 객관식 텍스트답 "${s}" → 선택지 #${idx + 1} 환원`);
      return String(idx + 1);
    }
  }
  // 환원 실패: 객관식 답을 텍스트로 둘 수 없음 → null(재시도 유도, 정밀도 우선).
  console.warn(`[passes:sanitizeMcAnswer] 객관식 비-번호 답 "${s}" 환원 실패 → null`);
  return null;
}

/**
 * 괄호고르기(word-choice, 어법 선택형) 옵션 파서.
 * 문장 속 괄호/대괄호 안 '/'로 구분된 단어 후보를 추출한다.
 *   예: "The man is an actor (he / who) has a lot of fans." → ["he","who"]
 *       "She wants a jacket (who/that) is blue." → ["who","that"]
 * 판정 신호(정밀도 우선, 오탐 시 최악=기권):
 *  - 괄호-선택 그룹이 정확히 1개이고, 그 안이 '/'로 나뉜 2~4개의 짧은 '단어형' 후보일 때만 인정.
 *  - 각 후보는 영문 알파벳 포함 + 3단어 이하 + 20자 이하(문장/지문 슬래시·숫자 슬래시 오탐 차단).
 *  - 여러 괄호-선택 그룹(다중 빈칸형)은 제외(빈 배열) — 단순 word-choice로 한정.
 * @param {string} text
 * @returns {string[]} 옵션 배열(0 또는 2~4개)
 */
export function parseInlineChoiceOptions(text) {
  const s = String(text || '');
  const groups = [];
  const re = /[([]([^()[\]]{1,60})[)\]]/g; // (...) 또는 [...]
  let m;
  while ((m = re.exec(s)) !== null) {
    const inner = m[1];
    if (!inner.includes('/')) continue;
    const parts = inner.split('/').map((t) => t.trim()).filter(Boolean);
    if (parts.length < 2 || parts.length > 4) continue;
    const ok = parts.every((p) => /[A-Za-z]/.test(p) && p.split(/\s+/).length <= 3 && p.length <= 20);
    if (ok) groups.push(parts);
  }
  // 정확히 1개의 괄호-선택 그룹일 때만 단순 word-choice로 인정(다중 그룹은 별도 처리 대상).
  return groups.length === 1 ? groups[0] : [];
}

/**
 * 괄호고르기(word-choice) 답을 '옵션 단어'로 정규화한다.
 *  - value가 옵션 중 하나와 (대소문자·구두점 무시) 일치 → 표준 옵션 단어 반환.
 *  - value가 숫자 N이고 1..options.length 범위 → options[N-1]로 환원(인덱스 오출력 방어;
 *    실측 "(he/who)" 정답이 "2"로 새던 confident-wrong을 옵션 단어 "who"로 복원).
 *  - 그 외(옵션과 무관한 단어·범위밖 숫자) → null(기권, 정밀도 우선).
 * @param {string|null} value
 * @param {string[]} options
 * @returns {string|null}
 */
export function sanitizeWordChoiceAnswer(value, options) {
  const opts = Array.isArray(options) ? options : [];
  if (value == null || opts.length === 0) return value ?? null;
  const s = String(value).trim();
  if (s === '') return null;
  const norm = (x) => String(x).toLowerCase().replace(/[^a-z0-9가-힣]/g, '');
  const target = norm(s);
  // 1) 옵션 단어 직접 일치 → 표준 옵션 반환
  const hit = opts.find((o) => norm(o) === target);
  if (hit) return hit;
  // 2) 인덱스 숫자 → 옵션 환원(모델이 번호로 오출력한 경우 복원)
  if (/^[0-9]+$/.test(s)) {
    const n = parseInt(s, 10);
    if (n >= 1 && n <= opts.length) {
      console.log(`[passes:sanitizeWordChoiceAnswer] 인덱스 "${s}" → 옵션 "${opts[n - 1]}" 환원`);
      return opts[n - 1];
    }
    return null; // 범위밖 숫자
  }
  // 3) 옵션과 무관 → 기권(정밀도 우선)
  console.warn(`[passes:sanitizeWordChoiceAnswer] 옵션(${opts.join('/')})과 불일치한 답 "${s}" → null`);
  return null;
}

/**
 * 다중빈칸 서술형(multi_blank)용 번호매김 빈칸 파서.
 * "(1) ... (2) ... (3) ..." 형태를 순서대로 분리해 각 빈칸의 문장 stem을 반환한다.
 *   예: "(1) Han Kang is ___ (2) Leonardo da Vinci is ___ (3) Thomas Edison is ___"
 *       → ["Han Kang is ___", "Leonardo da Vinci is ___", "Thomas Edison is ___"]
 * 조건: (1)부터 시작하는 연속 시퀀스(1,2,3,…) 2개 이상일 때만 인정(오탐 차단, 정밀도 우선).
 * @param {string} text
 * @returns {string[]} 빈칸 stem 배열(0 또는 2개 이상)
 */
export function parseNumberedBlanks(text) {
  const s = String(text || '');
  const marker = /\(\s*([1-9])\s*\)/g;
  const idxs = [];
  let m;
  while ((m = marker.exec(s)) !== null) {
    idxs.push({ n: parseInt(m[1], 10), pos: m.index, end: marker.lastIndex });
  }
  if (idxs.length < 2) return [];
  for (let i = 0; i < idxs.length; i++) {
    if (idxs[i].n !== i + 1) return []; // 1,2,3… 연속 아님 → 미인정
  }
  const stems = [];
  for (let i = 0; i < idxs.length; i++) {
    const start = idxs[i].end;
    const stop = i + 1 < idxs.length ? idxs[i + 1].pos : s.length;
    stems.push(s.slice(start, stop).trim());
  }
  return stems;
}

/**
 * 다중정답(multi MC) 답안 집합 파싱: 원문에서 선택지 번호(원문자 ①~⑨ 및 콤마/공백 구분 숫자)를
 * 모두 추출해 1..choices.length 범위로 검증 후 오름차순 정렬·중복제거한 number[]를 반환한다.
 * - 원문자와 숫자를 원문(raw) 그대로에서 개별 스캔한다. normalizeChoiceValue의 문자열 치환은
 *   인접 원문자를 이어붙여버릴 수 있어("③④" → "3④" → "34", 즉 3·4가 아니라 34로 오파싱) 이
 *   용도로는 쓰지 않는다 — extractOptionDigits(dbOperations.js)와 동일한 안전한 스캔 방식.
 * - choices 부재(선택지 없음)면 빈 배열(주관형 오분류 방어 — sanitizeMcAnswer의 "원값 보존"과
 *   달리, multi는 집합 자체가 무의미하므로 안전하게 빈 배열. 상위 채점 로직이 기권으로 처리한다).
 * - 범위 밖 번호는 개별 폐기(전체 폐기 아님): 예 "3, 4, 9"에서 choices=5개면 9만 버리고 [3,4].
 * @param {string|null} raw
 * @param {Array} choices
 * @returns {number[]}
 */
export function sanitizeMcAnswerSet(raw, choices) {
  const list = Array.isArray(choices) ? choices : [];
  if (raw == null || list.length === 0) return [];
  const s = String(raw);
  const max = list.length;
  const nums = new Set();
  const circled = '①②③④⑤⑥⑦⑧⑨';
  for (const ch of s) {
    const ci = circled.indexOf(ch);
    if (ci !== -1) nums.add(ci + 1);
  }
  for (const m of s.matchAll(/\d+/g)) {
    const n = parseInt(m[0], 10);
    if (!isNaN(n)) nums.add(n);
  }
  return Array.from(nums).filter((n) => n >= 1 && n <= max).sort((a, b) => a - b);
}

/**
 * sanitizeMcAnswerSet 결과를 하위호환 스칼라 문자열("2, 4")로 평탄화.
 * 추출된 번호가 없으면 null(=sanitizeMcAnswer의 "마크 없음"과 동일 의미, 하위 로직 일관성 유지).
 * @param {string|null} raw
 * @param {Array} choices
 * @returns {string|null}
 */
export function flattenMcAnswerSet(raw, choices) {
  if (raw == null) return null;
  const set = sanitizeMcAnswerSet(raw, choices);
  return set.length > 0 ? set.join(', ') : null;
}
