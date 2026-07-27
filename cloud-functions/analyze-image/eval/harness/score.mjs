/**
 * 채점 모듈 (precision-first)
 * - MC(객관식): correct / abstain(null, 허용) / wrong(confident-wrong, 해로움) 3분류.
 * - text(서술형): 정규화 후 exact/loose 매칭 (보조 지표).
 * - 멀티런: 인스턴스별 분포로 run-to-run 불안정(flaky) 탐지.
 *
 * 외부 의존 없음(순수 함수). 입출력은 JSON 직렬화 가능.
 */

/** 답안 정규화: 문자열화 + trim. 원/숫자 마킹은 "1".."5" 로 통일. */
export function normalizeMC(v) {
  if (v === null || v === undefined) return null;
  let s = String(v).trim();
  if (s === '') return null;
  // 원문자/괄호/특수표기 → 숫자
  const map = { '①': '1', '②': '2', '③': '3', '④': '4', '⑤': '5' };
  if (map[s]) return map[s];
  // "(3)", "3번", "3." 등에서 숫자만
  const m = s.match(/[1-5]/);
  return m ? m[0] : s;
}

/** 문제번호 정규화: 전체 숫자/식별자 보존 (앞뒤 공백/마침표/'번' 제거). MC답안 정규화와 분리. */
export function normalizeProblemNum(v) {
  if (v === null || v === undefined) return '';
  const s = String(v).trim();
  const m = s.match(/\d+/);
  return m ? m[0] : s;
}

// 영어 not-축약 정규화: "aren't"↔"are not" 처럼 의미동일·표면상이를 통일.
// 서술형 정답은 형식이 다양("be going to 부정문" = "They aren't going to..." 또는
// "They are not going to..." 둘 다 정답)하므로, gold가 한 형식만 담아 생기는 측정
// 아티팩트(둘 다 정답인데 wrong 처리)를 제거한다. not-축약만 처리(소유격 's·'d 등은
// 의미가 애매하여 제외) → 의미보존이라 false-positive 위험 없음.
const CONTRACTIONS = [
  [/\bwon't\b/g, 'will not'], [/\bshan't\b/g, 'shall not'], [/\bcan't\b/g, 'can not'],
  [/\bain't\b/g, 'is not'],
  [/\b(are|is|was|were|do|does|did|would|could|should|must|might|have|has|had|need|dare|ought)n't\b/g, '$1 not'],
];

/** 텍스트 정규화: 소문자 + not-축약 확장 + 영숫자/공백만 + 공백압축 */
export function normalizeText(v) {
  if (v === null || v === undefined) return null;
  let s = String(v).toLowerCase();
  for (const [re, rep] of CONTRACTIONS) s = s.replace(re, rep);
  s = s.replace(/\bcannot\b/g, 'can not'); // cannot ↔ can't 표면 통일
  s = s.replace(/[^a-z0-9\s']/g, ' ').replace(/\s+/g, ' ').trim();
  return s === '' ? null : s;
}

/**
 * MC 한 필드(user_answer 또는 correct_answer) 채점.
 * @param gtField { value? , ambiguous?, accept?, null_ok? }
 * @param predRaw 파이프라인이 낸 값(또는 null)
 * @returns 'correct' | 'abstain' | 'wrong'
 */
export function classifyMC(gtField, predRaw) {
  const pred = normalizeMC(predRaw);
  // 허용 정답 집합
  let accept;
  let nullOk;
  if (gtField.ambiguous) {
    accept = gtField.accept.map(normalizeMC);
    nullOk = gtField.null_ok !== false; // 애매 마킹은 기본 null 허용
  } else {
    accept = [normalizeMC(gtField.value)];
    nullOk = gtField.null_ok === true; // 단일정답은 기본 null=miss(=abstain 취급, 비처벌)
  }
  if (pred === null) return 'abstain';
  if (accept.includes(pred)) return 'correct';
  return 'wrong';
}

// ─── 복수정답(multi_select) 채점 ────────────────────────────────
// GT 라벨 규약 1(2026-07-27 확정): answer_format="multi_select" + user_answers/correct_answers 배열.
// 단일 MC와 버킷을 분리한다 — 집합 완전일치는 단일 선택보다 난도가 달라, 섞으면 지표 해석이 흐려지고
// 기존 mc_* 수치와 이전 결과 파일의 비교 가능성도 잃는다.

const CIRCLED = '①②③④⑤⑥⑦⑧⑨';

/**
 * 선택지 번호(원문자 ①~⑨ / 숫자 1~9)를 정수 집합으로 추출.
 * "3, 4" · "③④" · ["3","4"] · [{value:"3"}] 을 모두 같은 집합으로 본다.
 * dbOperations.extractOptionDigits와 같은 규칙이지만, 이 파일의 '외부 의존 없음' 규약을 지키려 재구현.
 * 문자열 치환이 아니라 원문 개별 스캔이라 "③④"를 34로 오파싱하지 않는다.
 */
export function extractChoiceDigits(v) {
  const set = new Set();
  const visit = (x) => {
    if (x === null || x === undefined) return;
    if (Array.isArray(x)) { x.forEach(visit); return; }
    if (typeof x === 'object') { visit(x.value); return; }  // [{value:"3"}, ...] 형태 수용
    const s = String(x);
    for (const ch of s) {
      const ci = CIRCLED.indexOf(ch);
      if (ci !== -1) set.add(ci + 1);
    }
    for (const m of s.matchAll(/\d+/g)) {
      const n = parseInt(m[0], 10);
      if (n >= 1 && n <= 9) set.add(n);
    }
  };
  visit(v);
  return set;
}

/** answer_format이 복수선택 계열인지. DB/프론트 계약값 'multi'와 GT 라벨값 'multi_select'를 함께 수용. */
export function isMultiSelectFormat(fmt) {
  return fmt === 'multi_select' || fmt === 'multi';
}

/**
 * multi GT 필드 → 허용 정답집합 목록.
 * 지원 형태:
 *   { values: ["3","4"] }                                   단일 허용집합
 *   ["3","4"] / [{value:"3"}, ...]                          단일 허용집합(배열형)
 *   { ambiguous: true, accept_sets: [["3","4"],["3","5"]] }  복수 허용집합(판독 모호)
 * @returns {Set<number>[]|null} null = 라벨이 없거나 형태 불명(채점 불가)
 */
export function parseGtAnswerSets(field) {
  if (field === null || field === undefined) return null;
  if (field.ambiguous && Array.isArray(field.accept_sets)) {
    return field.accept_sets.map(extractChoiceDigits);
  }
  const raw = Array.isArray(field) ? field : field.values;
  if (!Array.isArray(raw)) return null;
  return [extractChoiceDigits(raw)];
}

function eqSet(a, b) {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}

/** 정수 집합 → 안정 비교용 문자열 키("3,4"). 빈 집합은 null. */
export function setKey(set) {
  return set.size === 0 ? null : [...set].sort((a, b) => a - b).join(',');
}

/**
 * multi_select 한 필드 채점 — 집합 완전일치(부분점수 없음).
 * 부분집합("③④" 중 ③만 추출)도 wrong — 전사 누락은 기권이 아니라 오답이다.
 * 다만 아무것도 못 뽑았으면 abstain(비처벌) — precision-first.
 * @returns 'correct' | 'abstain' | 'wrong'
 */
export function classifyMultiSelect(gtField, predRaw) {
  const acceptSets = parseGtAnswerSets(gtField);
  if (acceptSets === null) return 'abstain';   // 라벨 결함 → 처벌·가점 모두 보류(multi_gt_invalid로 별도 집계)
  const pred = extractChoiceDigits(predRaw);
  if (pred.size === 0) return 'abstain';
  return acceptSets.some(s => eqSet(pred, s)) ? 'correct' : 'wrong';
}

/** text 한 필드 채점 → 'correct' | 'abstain' | 'wrong' (loose 매칭 포함) */
export function classifyText(gtField, predRaw) {
  const pred = normalizeText(predRaw);
  if (pred === null) return 'abstain';
  // 비대칭 매칭(precision-first): 정확일치 또는 pred가 gt를 '포함'(superset, 주어/군더더기 허용)할 때만 correct.
  // gt.includes(pred)는 의도적으로 제외 — 정답의 '부분문자열'(불완전 부분답)을 만점 처리하면
  // 짧은 오답이 긴 정답에 흡수되어 confident-wrong 을 은폐한다(예: pred="clean"이 긴 정답에 흡수).
  const looseMatch = (gt) => gt !== null && (gt === pred || pred.includes(gt));
  // 모호 라벨(흐릿/판독불가 손글씨): accept 집합 중 하나라도 loose 매칭이면 correct.
  // 손글씨 r/n 등 진성 모호로 gt 단정 불가 시, 가능한 판독을 모두 accept 에 담아
  // 그럴듯한 판독을 confident-wrong 으로 오처벌하지 않는다(precision-first).
  if (gtField.ambiguous) {
    const accepts = (gtField.accept || []).map(normalizeText);
    return accepts.some(looseMatch) ? 'correct' : 'wrong';
  }
  const gt = normalizeText(gtField.value);
  if (gt === null) return 'wrong';
  // loose: pred가 gt 이상(정확일치 또는 superset)일 때만 correct. 부분답은 wrong.
  return looseMatch(gt) ? 'correct' : 'wrong';
}

const EMPTY = () => ({ correct: 0, abstain: 0, wrong: 0, missing: 0 });

/**
 * 단일 런 채점.
 * @param groundTruth ground-truth.json 파싱본
 * @param runOutputs { [image]: [{problem_number, user_answer, correct_answer}] }
 * @returns { perInstance: [...], totals: {...} }
 */
export function scoreRun(groundTruth, runOutputs) {
  const perInstance = [];
  const totals = {
    mc_user: EMPTY(), mc_correct: EMPTY(),
    multi_user: EMPTY(), multi_correct: EMPTY(),
    text_user: EMPTY(), text_correct: EMPTY(),
    extra_problems: 0,
    multi_gt_invalid: 0,
  };

  for (const page of groundTruth.pages) {
    const out = runOutputs[page.image] || [];
    const byNum = new Map(out.map(o => [normalizeProblemNum(o.problem_number), o]));
    const seen = new Set();

    for (const q of page.questions) {
      const key = normalizeProblemNum(q.problem_number);
      const found = byNum.get(key);
      seen.add(key);
      const fmt = q.answer_format || 'single';
      const isMulti = isMultiSelectFormat(fmt);
      // multi_blank(순서 있는 텍스트 배열)는 집합채점 대상이 아니다 → 기존 text 경로 유지.
      const isText = q.type === 'text';
      // 복수정답은 배열 필드가 1순위 — 파이프라인이 스칼라("3, 4")만 냈으면 거기서 번호를 뽑는다.
      const ua = found ? (isMulti ? (found.user_answers ?? found.user_answer) : found.user_answer) : null;
      const ca = found ? (isMulti ? (found.correct_answers ?? found.correct_answer) : found.correct_answer) : null;
      const gtUa = isMulti ? q.user_answers : q.user_answer;
      const gtCa = isMulti ? q.correct_answers : q.correct_answer;

      let uaClass, caClass;
      if (isMulti) {
        uaClass = classifyMultiSelect(gtUa, ua);
        caClass = classifyMultiSelect(gtCa, ca);
        if (parseGtAnswerSets(gtUa) === null || parseGtAnswerSets(gtCa) === null) totals.multi_gt_invalid++;
      } else if (isText) {
        uaClass = classifyText(gtUa, ua);
        caClass = classifyText(gtCa, ca);
      } else {
        uaClass = classifyMC(gtUa, ua);
        caClass = classifyMC(gtCa, ca);
      }
      // 문제 자체가 누락된 경우(found 없음) → missing 으로 별도 표기 (abstain의 하위범주)
      const missing = !found;
      const suffix = isMulti ? 'multi' : isText ? 'text' : 'mc';
      const uaBucket = `${suffix}_user`;
      const caBucket = `${suffix}_correct`;
      totals[uaBucket][uaClass]++;
      totals[caBucket][caClass]++;
      if (missing) { totals[uaBucket].missing++; totals[caBucket].missing++; }

      perInstance.push({
        image: page.image, problem_number: q.problem_number, type: q.type, answer_format: fmt, missing,
        user_answer: { gt: gtUa ?? null, pred: ua ?? null, class: uaClass },
        correct_answer: { gt: gtCa ?? null, pred: ca ?? null, class: caClass },
      });
    }
    for (const o of out) {
      const k = normalizeProblemNum(o.problem_number);
      if (!seen.has(k)) totals.extra_problems++;
    }
  }

  totals.summary = summarize(totals);
  return { perInstance, totals };
}

/** precision/recall 요약 계산 */
function pr(b) {
  const committed = b.correct + b.wrong;
  const all = b.correct + b.wrong + b.abstain;
  return {
    correct: b.correct, wrong: b.wrong, abstain: b.abstain, missing: b.missing,
    precision: committed ? +(b.correct / committed).toFixed(4) : null,
    recall: all ? +(b.correct / all).toFixed(4) : null,
  };
}
function summarize(totals) {
  return {
    mc_user: pr(totals.mc_user),
    mc_correct: pr(totals.mc_correct),
    multi_user: pr(totals.multi_user),
    multi_correct: pr(totals.multi_correct),
    text_user: pr(totals.text_user),
    text_correct: pr(totals.text_correct),
    extra_problems: totals.extra_problems,
    multi_gt_invalid: totals.multi_gt_invalid,
  };
}

/**
 * 멀티런 안정성 분석.
 * @param groundTruth
 * @param runs [{ [image]: marks[] }, ...]  (N개 런)
 * @returns { runScores: [...], stability: [...], agg: {...} }
 */
export function scoreMultiRun(groundTruth, runs) {
  const runScores = runs.map(r => scoreRun(groundTruth, r));
  // 인스턴스별로 N런의 분류 분포 집계 (key = image|problem|field)
  const dist = new Map();
  for (const rs of runScores) {
    for (const inst of rs.perInstance) {
      for (const field of ['user_answer', 'correct_answer']) {
        const k = `${inst.image}||${inst.problem_number}||${field}`;
        if (!dist.has(k)) dist.set(k, {
          image: inst.image, problem_number: inst.problem_number, type: inst.type,
          answer_format: inst.answer_format, field,
          gt: inst[field].gt, classes: [], preds: [],
        });
        dist.get(k).classes.push(inst[field].class);
        dist.get(k).preds.push(inst[field].pred);
      }
    }
  }
  const stability = [];
  for (const v of dist.values()) {
    // 복수정답은 배열/문자열 어느 쪽으로 와도 같은 집합이면 같은 예측이다 → 집합키로 비교.
    // normalizeMC를 그대로 쓰면 ["3","4"]가 "3"으로 뭉개져 flaky를 놓친다.
    const canon = (p) => {
      if (p === null || p === undefined) return 'null';
      return isMultiSelectFormat(v.answer_format) ? (setKey(extractChoiceDigits(p)) ?? 'null') : normalizeMC(p);
    };
    const uniqClass = new Set(v.classes);
    const uniqPred = new Set(v.preds.map(canon));
    const flakyClass = uniqClass.size > 1;       // 런마다 정/오/기권이 바뀜
    const flakyPred = uniqPred.size > 1;          // 런마다 예측값 자체가 바뀜
    stability.push({ ...v, flakyClass, flakyPred,
      classCounts: tally(v.classes), predCounts: tally(v.preds.map(canon)) });
  }
  // 집계: 평균 precision/recall + flaky 수 + confident-wrong 인스턴스
  const agg = {
    runs: runs.length,
    mc_user: avgPR(runScores, 'mc_user'),
    mc_correct: avgPR(runScores, 'mc_correct'),
    multi_user: avgPR(runScores, 'multi_user'),
    multi_correct: avgPR(runScores, 'multi_correct'),
    text_user: avgPR(runScores, 'text_user'),
    text_correct: avgPR(runScores, 'text_correct'),
    // GT는 런 간 동일하므로 첫 런 값이 대표값.
    multi_gt_invalid: runScores[0]?.totals.summary.multi_gt_invalid ?? 0,
    flaky_class: stability.filter(s => s.flakyClass).length,
    flaky_pred: stability.filter(s => s.flakyPred).length,
    ever_wrong: stability.filter(s => s.classes.includes('wrong')).length,
    always_wrong: stability.filter(s => s.classes.every(c => c === 'wrong')).length,
  };
  return { runScores, stability, agg };
}

function tally(arr) {
  const m = {};
  for (const x of arr) m[x] = (m[x] || 0) + 1;
  return m;
}
function avgPR(runScores, bucket) {
  const ps = runScores.map(r => r.totals.summary[bucket].precision).filter(x => x !== null);
  const rs = runScores.map(r => r.totals.summary[bucket].recall).filter(x => x !== null);
  const ws = runScores.map(r => r.totals.summary[bucket].wrong);
  const avg = a => a.length ? +(a.reduce((s, x) => s + x, 0) / a.length).toFixed(4) : null;
  return {
    precision_avg: avg(ps), recall_avg: avg(rs),
    wrong_avg: avg(ws), wrong_max: ws.length ? Math.max(...ws) : 0,
  };
}
