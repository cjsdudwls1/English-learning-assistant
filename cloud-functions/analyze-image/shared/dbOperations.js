/**
 * DB 작업 모듈
 * - 이미지 업로드 (Supabase Storage)
 * - 세션 생성 (image_urls 검증/정리 포함)
 * - 문제(problems) 저장 (content JSONB 상세 필드 + stem 합성 + choices 정규화)
 * - 라벨(labels) 저장 (O/X 마크 판정 + taxonomy 보강)
 * - 메타데이터 업데이트 (난이도 양방향 정규화)
 * - 세션 완료 (labeled 상태 가드)
 *
 * 원본: sessionManager.ts, problemSaver.ts, labelProcessor.ts (Edge Function b6fd71be)
 */

import { StageError } from './errors.js';
import { cleanOrNull, makeDepthKey, fuzzyMatchTaxonomy, canonicalDepth1 } from './taxonomy.js';
import { sanitizeMcAnswerSet } from './passes.js';

// ─── O/X 마크 정규화 ────────────────────────────────────────
// 원본: validation.ts#normalizeMark

/**
 * 다양한 O/X 표기를 'O' | 'X' | 'Unknown'으로 정규화한다.
 */
function normalizeMark(raw) {
  if (raw === undefined || raw === null) return 'Unknown';
  const value = String(raw).trim().toLowerCase();

  if (value === 'unknown') return 'Unknown';

  const truthy = new Set(['o', '✓', 'v', 'correct', 'true', '정답', '맞음', 'ok', '⭕', 'circle', 'check', 'checkmark', 'yes', 'pass']);
  if (truthy.has(value)) return 'O';

  const falsy = new Set(['x', '✗', 'incorrect', 'false', '오답', '틀림', 'no', 'fail', '❌']);
  if (falsy.has(value)) return 'X';

  return 'Unknown';
}

// ─── 답안 번호 파싱 ─────────────────────────────────────────

/**
 * 답안 번호를 정규화하여 숫자로 파싱
 * 원(①②③④⑤), "4번", "4." 등 다양한 형식 처리
 */
function parseAnswerNumber(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  const circled = '①②③④⑤';
  const circledIdx = circled.indexOf(s);
  if (circledIdx !== -1) return circledIdx + 1;
  // 순수 숫자 또는 '4번', '4.' 형식만 매칭 (단어 안의 숫자는 제외)
  // 예: "appear" → null, "3" → 3, "4번" → 4
  if (/^[0-9]+$/.test(s)) return parseInt(s, 10);
  const numMatch = s.match(/^(\d+)[번.)\s]?$/);
  return numMatch ? parseInt(numMatch[1], 10) : null;
}

// ─── 서술형 채점용 텍스트 정규화 ────────────────────────────

/**
 * 서술형/주관식 채점 비교용 정규화: 대소문자·문장부호(.,?!;:")·중복공백 차이를 무시한다.
 * - 어포스트로피(')·하이픈(-)은 보존: can't≠cant, well-known 등 철자 구분을 유지(과도한 관대 방지).
 * - 채점 과민(맞는 답을 구두점/공백 차이로 오답 처리 = 학습자에게 confident-wrong 피드백) 방지.
 *   실측 세션 4d1509b0: "Doesn't he like cats ?" vs "Doesn't he like cats",
 *   "will You" vs "will you" 등 다수가 표면 차이만으로 오답 처리되던 문제.
 * - 정답이 토큰 분절(예 "liked, the, English, ...")로 저장되거나 부분만 추출된 경우는
 *   이 정규화로 해결되지 않는다(정답 추출 품질 영역, 별도).
 */
export function normalizeAnswerText(s) {
  return String(s ?? '')
    .toLowerCase()
    .replace(/[.,?!;:"\/]/g, ' ')   // '/' 포함: 다중빈칸 답을 "A / B"로 이어 추출해도 구분자 차이로 오답처리 안 되게(ua/ca 한쪽만 / 인 경우 false-negative 방지)
    .replace(/\s+/g, ' ')
    .trim();
}

// ─── 단어→번호 매핑 (객관식 채점 fallback) ──────────────────

/**
 * 객관식 문제에서 correct_answer가 단어/구문으로 들어왔을 때
 * choices 배열에서 그 단어를 포함하는 항목을 찾아 1-based 번호로 변환.
 * - 정확 일치 우선, 그 다음 부분 일치(단어 포함)
 * - 매칭 실패 시 null
 *
 * 예: choices=[{text:"appear"}, {text:"rise"}, {text:"reach"}], correct="rise" → 2
 */
function mapWordToChoiceNumber(rawAnswer, choices) {
  if (!rawAnswer || !Array.isArray(choices) || choices.length === 0) return null;
  const answer = String(rawAnswer).trim().toLowerCase();
  if (!answer) return null;

  const normalize = (s) => String(s || '').trim().toLowerCase().replace(/[^a-z0-9가-힣\s]/gi, '').replace(/\s+/g, ' ');
  const normAnswer = normalize(answer);

  // 1단계: 정확 일치 (text 또는 label)
  for (let i = 0; i < choices.length; i++) {
    const c = choices[i];
    const text = typeof c === 'string' ? c : (c?.text || '');
    const label = typeof c === 'string' ? '' : (c?.label || '');
    if (normalize(text) === normAnswer || normalize(label) === normAnswer) {
      return i + 1;
    }
  }

  // 2단계: 부분 일치 (choice 텍스트가 answer를 단어 단위로 포함하거나, answer가 choice를 단어 단위로 포함)
  for (let i = 0; i < choices.length; i++) {
    const c = choices[i];
    const text = typeof c === 'string' ? c : (c?.text || '');
    const normText = normalize(text);
    if (!normText) continue;

    // 단어 경계 매칭: " word " 형태로 둘러싸서 부분 단어 매칭 방지
    const paddedText = ` ${normText} `;
    const paddedAnswer = ` ${normAnswer} `;
    if (paddedText.includes(paddedAnswer) || paddedAnswer.includes(paddedText)) {
      return i + 1;
    }
  }

  return null;
}

// ─── 복수답안(Bug B)·단어↔숫자 불일치(Bug D) 감지 헬퍼 ────────────

/**
 * "정답 N개 / 모두 고르면 / 단, N개" 지시문 또는 정답이 (1)…(2)… 번호매김인지 감지.
 * 복수답안은 단일 숫자/텍스트 비교로 채점 불가 → computeIsCorrect가 집합비교 또는 기권으로 분기.
 * false-positive는 기권(null)으로 이어질 뿐이라 confident-wrong보다 안전(precision-first).
 * multi_answer_contract §2 형식판정에도 이 함수를 재사용(answer_format='multi' 판정 신호원).
 * export: processPage.js가 Pass B 추출 단계에서 questionContextMap.isMultiFormat 산출에 사용.
 */
export function detectMultiAnswer(instruction, correctAns) {
  const inst = String(instruction || '');
  if (/모두\s*고르/.test(inst)) return true;                 // "모두 고르면/고르시오"
  if (/모두\s*고른/.test(inst)) return true;                  // "모두 고른 것은"(활용형, 위 정규식과 어간 형태가 달라 별도 매칭 필요)
  if (/정답[^0-9]{0,3}[2-9]\s*개/.test(inst)) return true;    // "정답 2개", "정답이 2개"
  if (/단[,\s]*[2-9]\s*개/.test(inst)) return true;           // "단, 2개"
  if (/[2-9]\s*개[^.]{0,8}(고르|모두)/.test(inst)) return true; // "2개 고르시오"
  if (/all\s*that\s*apply/i.test(inst)) return true;          // "select all that apply"
  if (/select\s*all/i.test(inst)) return true;                // "select all"
  // 정답 문자열이 (1)…(2)… 번호매김(서술형 다빈칸) → 단일 사용자답과 무조건 불일치하던 케이스
  if (/\(\s*[1-9]\s*\)[\s\S]*\(\s*[1-9]\s*\)/.test(String(correctAns || ''))) return true;
  // 정답 원문에 원문자 선택지 번호가 2개 이상(예 "③ ④", "①③"). 원문자 ①~⑨는 선택지 마커라
  // 주관식 자유서술 본문엔 등장하지 않음 → 이 검출은 confident-wrong 위험 없음(계약 §2 "③ ④" 정합).
  if (/[①②③④⑤⑥⑦⑧⑨][\s,、·]*[①②③④⑤⑥⑦⑧⑨]/.test(String(correctAns || ''))) return true;
  return false;
}

/** 문자열에서 선택지 번호(원문자 ①~⑨ 및 1~9 숫자)만 정수 집합으로 추출. */
function extractOptionDigits(s) {
  const str = String(s || '');
  const set = new Set();
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

/** 두 정수 집합의 완전 일치 여부(부분점수 없음). */
function eqSet(a, b) {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}

// ─── 다중정답(multi MC) 형식 판정 (buildContentJson·saveLabels 공유) ────

/**
 * 문항의 answer_format과 정답/사용자답 번호집합을 단일 지점에서 판정한다(multi_answer_contract §2~3).
 * - 객관식(choices≥2)이고 detectMultiAnswer가 복수정답 신호를 감지하면 'multi'.
 * - 그 외(주관식 포함)는 'single' — 기존 스칼라 채점·저장 경로 완전 불변. computeIsCorrect의
 *   single/서술형 분기는 이 함수의 산출물을 참조하지 않는다(문항 검사만 여기서 선행).
 * - multi일 때 correct_answers/user_answers는 sanitizeMcAnswerSet으로 추출(불확실하면 빈 배열 —
 *   빈 배열은 상위 computeIsCorrect·저장 로직에서 기권/빈 문자열로 이어진다. 정밀도 우선).
 * - buildContentJson(문제 저장)과 saveLabels(라벨/채점) 양쪽이 동일 입력에 이 함수를 각자 호출해
 *   같은 결과를 얻는다(순수함수라 결과 발산 없음, 두 함수 간 새 결합 없이 DRY).
 * @param {{instruction?, correct_answer?, user_answer?}} item
 * @param {Array} choiceArr - 정규화 여부 무관, length만 사용(범위 max)
 * @returns {{answerFormat: 'single'|'multi', correctAnswers: number[]|null, userAnswers: number[]|null, flatCorrect: string|null, flatUser: string|null}}
 */
function resolveAnswerFormat(item, choiceArr) {
  // 다중빈칸 서술형(multi_blank): processPage가 빈칸별 자유텍스트 배열(user_answers/correct_answers)을
  // 미리 채워 넘긴다. MC 번호집합이 아니므로 sanitizeMcAnswerSet(번호추출)을 태우지 않고 그대로 통과.
  // flat 값은 processPage가 만든 번호형 문자열("(1) X (2) Y")을 유지 → 기존 detectMultiAnswer 기권·UI 폴백.
  // 채점은 항상 기권(computeIsCorrect가 multi_blank→null, 정밀도 우선).
  if (item?.answer_format === 'multi_blank') {
    return {
      answerFormat: 'multi_blank',
      correctAnswers: Array.isArray(item.correct_answers) ? item.correct_answers : [],
      userAnswers: Array.isArray(item.user_answers) ? item.user_answers : [],
      flatCorrect: item?.correct_answer || null,
      flatUser: item?.user_answer || null,
    };
  }
  const list = Array.isArray(choiceArr) ? choiceArr : [];
  const isMulti = list.length >= 2 && detectMultiAnswer(item?.instruction, item?.correct_answer);
  if (!isMulti) {
    return {
      answerFormat: 'single',
      correctAnswers: null,
      userAnswers: null,
      flatCorrect: item?.correct_answer || null,
      flatUser: item?.user_answer || null,
    };
  }
  const correctAnswers = sanitizeMcAnswerSet(item?.correct_answer, list);
  const userAnswers = sanitizeMcAnswerSet(item?.user_answer, list);
  return {
    answerFormat: 'multi',
    correctAnswers,
    userAnswers,
    flatCorrect: correctAnswers.length > 0 ? correctAnswers.join(', ') : '',
    flatUser: userAnswers.length > 0 ? userAnswers.join(', ') : '',
  };
}

/**
 * choices 없는 빈칸에서 한쪽=순수 숫자, 다른쪽=알파벳/한글 단어인 단위 불일치(Bug D) 감지.
 * 어형선택(who/which 등)이 객관식으로 오분류돼 정답이 숫자로 날조된 경우 → 오답 단정 대신 기권.
 */
function isDigitWordMismatch(userAns, correctAns) {
  const u = String(userAns || '').trim();
  const c = String(correctAns || '').trim();
  const isDigit = (x) => /^\d+$/.test(x);
  const isWord = (x) => /[a-zA-Z가-힣]/.test(x) && !/^\d+$/.test(x);
  return (isDigit(u) && isWord(c)) || (isDigit(c) && isWord(u));
}

// ─── is_correct 판정 (prod 채점 단일 진실원) ──────────────────

/**
 * 정오답 판정. saveLabels(prod 저장)와 eval 하네스가 공유하는 단일 채점 함수.
 * 1차: 시험지의 O/X 채점 마크(user_marked_correctness) → true/false. 'Unknown'/없음이면 2차.
 * 2차: user_answer vs correct_answer 자동 비교.
 *   - 객관식(choices 있음): parseAnswerNumber + 단어→번호 fallback(mapWordToChoiceNumber) 후 숫자 비교.
 *   - 서술형(choices 없음) 또는 번호 파싱 불가: normalizeAnswerText 후 정확 일치.
 * 부분점수 없음(정확 일치만 정답).
 * 복수답안(Bug B)·어형선택 단위불일치(Bug D)는 오답 단정 대신 기권(null) — instruction으로 감지.
 * 다중정답(multi MC, multi_answer_contract §5): answer_format==='multi'(또는 detectMultiAnswer 참)면
 * correct_answers/user_answers(호출측이 resolveAnswerFormat으로 미리 뽑아 넘긴 number[])가 있으면
 * 그 집합으로 완전일치 채점, 없으면 기존 Bug B 안전망(스칼라 문자열에서 재추출)으로 폴백 — 이 인자를
 * 넘기지 않는 기존 호출부(eval 하네스 등)는 동작이 완전히 그대로다.
 * @param {{user_marked_correctness?, user_answer?, correct_answer?, choices?, instruction?, answer_format?, correct_answers?, user_answers?}} item
 * @returns {boolean|null} true=정답, false=오답, null=판정보류(미채점)
 */
export function computeIsCorrect({ user_marked_correctness, user_answer, correct_answer, choices, instruction, answer_format, correct_answers, user_answers } = {}) {
  let isCorrect = null;

  // 1차: 시험지의 O/X 채점 마크
  const rawMark = user_marked_correctness;
  if (rawMark != null && String(rawMark).trim() !== '') {
    const normalized = normalizeMark(rawMark);
    if (normalized === 'O') isCorrect = true;
    else if (normalized === 'X') isCorrect = false;
    // 'Unknown'이면 null 유지
  }

  // 2차: user_answer vs correct_answer 자동 비교
  if (isCorrect === null) {
    // 다중빈칸 서술형(multi_blank): 빈칸별 자유서술이라 단일 자동비교로 채점 불가 → 항상 기권.
    // (시험지 O/X 채점 마크가 있으면 위 1차에서 이미 반영됨. 여기선 자동비교만 차단.)
    if (answer_format === 'multi_blank') return null;
    const userAns = String(user_answer || '').trim();
    const correctAns = String(correct_answer || '').trim();
    const choiceArr = Array.isArray(choices) ? choices : [];
    const isObjective = choiceArr.length > 0;

    if (userAns && correctAns) {
      // Bug B(복수답안): "모두 고르면 / 정답 N개" 또는 정답이 (1)…(2)… 번호매김이면 단일 비교로 채점 불가.
      // 객관식 정답 집합이 온전히 추출된 경우만 완전일치로 채점, 아니면 기권(null) — 단일값만 저장된
      // 현 상태에서 오답 단정(confident-wrong) 방지. (집합/빈칸별 완전 추출은 Stage 2 프롬프트 개선 몫)
      if (detectMultiAnswer(instruction, correctAns) || answer_format === 'multi') {
        // 우선순위: 호출측(resolveAnswerFormat)이 sanitizeMcAnswerSet으로 정제한 correct_answers/
        // user_answers 배열을 넘겨줬으면 그것을 신뢰(원문 재파싱보다 정밀). 없으면 기존 Stage 1
        // 안전망(스칼라 문자열에서 번호집합 재추출)으로 폴백 — 게이트(cd.size>=2 && ud.size>=cd.size)는
        // 두 경로 동일하게 적용해 안전성 차이를 두지 않는다.
        let cd, ud;
        if (Array.isArray(correct_answers) && Array.isArray(user_answers)) {
          cd = new Set(correct_answers);
          ud = new Set(user_answers);
        } else {
          cd = extractOptionDigits(correctAns);
          ud = extractOptionDigits(userAns);
        }
        isCorrect = (isObjective && cd.size >= 2 && ud.size >= cd.size) ? eqSet(ud, cd) : null;
        return isCorrect;
      }

      let userNum = parseAnswerNumber(userAns);
      let correctNum = parseAnswerNumber(correctAns);

      // 객관식 fallback: parseAnswerNumber 실패 시 choices에서 단어 매칭으로 번호 복원
      if (isObjective) {
        if (userNum === null) {
          const mapped = mapWordToChoiceNumber(userAns, choiceArr);
          if (mapped !== null) userNum = mapped;
        }
        if (correctNum === null) {
          const mapped = mapWordToChoiceNumber(correctAns, choiceArr);
          if (mapped !== null) correctNum = mapped;
        }
      }

      if (userNum !== null && correctNum !== null) {
        isCorrect = userNum === correctNum;
      } else if (!isObjective && isDigitWordMismatch(userAns, correctAns)) {
        // Bug D(어형선택): choices 없는 빈칸에 한쪽=단어·한쪽=날조 숫자(단위 불일치) → 오답 단정 대신 기권.
        isCorrect = null;
      } else {
        // 서술형 등: 구두점/공백/대소문자 정규화 후 정확 일치. 정규화 후 빈 문자열이면 비교 안 함.
        const nu = normalizeAnswerText(userAns);
        const nc = normalizeAnswerText(correctAns);
        if (nu !== '' && nu === nc) {
          isCorrect = true;
        } else {
          // Bug A: 공백만 다른 경우(특히 한글 띄어쓰기 "학교 미술 대회" vs "학교미술대회")도 정답 인정.
          // 문자 순서는 보존되므로 순수 공백 변형만 동치가 됨(어포스트로피/하이픈 구분은 normalizeAnswerText가 유지 → can't≠cant).
          const su = nu.replace(/\s+/g, '');
          const sc = nc.replace(/\s+/g, '');
          isCorrect = su !== '' && su === sc;
        }
      }
    }
  }

  return isCorrect;
}

// ─── choices 정규화 ─────────────────────────────────────────
// 원본: problemSaver.ts#normalizeChoices

/**
 * 문자열/객체 배열 모두 { label?, text } 구조로 정규화
 */
function normalizeChoices(choices) {
  return (choices || []).map((c) => {
    if (typeof c === 'string') {
      return { text: c };
    }
    // 새 구조: { label: "①", text: "..." }
    if (c.label && c.text) {
      return { label: c.label, text: c.text };
    }
    return { text: c.text || String(c) };
  });
}

// ─── stem 텍스트 생성 ───────────────────────────────────────
// 원본: problemSaver.ts#buildStemFromItem

/**
 * instruction + passage + question_body + visual_context 조합 stem 텍스트 생성
 */
function buildStemFromItem(item) {
  // 기존 question_text가 있으면 그것을 사용 (하위 호환성)
  let stemText = item.question_text || '';
  if (!stemText && item.instruction) {
    // 새로운 구조: instruction을 기본으로 하고, passage가 있으면 앞에 추가
    const passageText = item._resolved_passage || item.passage || '';
    const questionBody = item.question_body || '';
    stemText = [
      passageText ? `[지문]\n${passageText}` : '',
      item.visual_context ? `[${item.visual_context.type || '자료'}] ${item.visual_context.title || ''}\n${item.visual_context.content || ''}` : '',
      `[문제] ${item.instruction}`,
      questionBody ? `\n${questionBody}` : ''
    ].filter(Boolean).join('\n\n');
  }
  return stemText;
}

// ─── content JSONB 구조 생성 ────────────────────────────────
// 원본: problemSaver.ts#buildContentJson

function buildContentJson(item, normalizedChoicesArr) {
  // 다중정답(multi MC, multi_answer_contract §3): answer_format 태깅 + (multi일 때만) 번호집합.
  // 기존 user_answer/correct_answer 스칼라는 하위호환을 위해 계속 채우되, multi면 평탄화 문자열
  // ("3, 4")로 대체된다(단일 문항은 fmt.flatUser/flatCorrect가 item 원값 그대로라 완전 무변화).
  const fmt = resolveAnswerFormat(item, normalizedChoicesArr);
  const content = {
    stem: buildStemFromItem(item),
    problem_number: item.problem_number || null,
    shared_passage_ref: item.shared_passage_ref || null,
    passage: item._resolved_passage || item.passage || null,
    visual_context: item.visual_context || null,
    instruction: item.instruction || null,
    question_body: item.question_body || null,
    choices: normalizedChoicesArr,
    user_answer: fmt.flatUser,
    user_marked_correctness: item.user_marked_correctness || null,
    correct_answer: fmt.flatCorrect,
    answer_format: fmt.answerFormat,
  };
  if (fmt.answerFormat === 'multi' || fmt.answerFormat === 'multi_blank') {
    // multi=MC 번호집합(number[]), multi_blank=빈칸별 자유텍스트 배열(string|null[]). 둘 다 배열 그대로 저장.
    content.correct_answers = fmt.correctAnswers;
    content.user_answers = fmt.userAnswers;
  }
  return content;
}

// ─── 이미지 업로드 ──────────────────────────────────────────

/**
 * 이미지를 Supabase Storage에 업로드하고 URL 반환
 * @returns {string[]} 업로드된 이미지 URL 배열
 */
export async function uploadImages(supabase, images, userId) {
  const baseTs = Date.now();
  const results = await Promise.all(
    images.map(async (imageData, index) => {
      const fileName = `${userId}/${baseTs}_${index}_${imageData.fileName || 'image.jpg'}`;
      const buffer = Buffer.from(imageData.imageBase64, 'base64');

      const { error: uploadError } = await supabase.storage
        .from('uploaded-images')
        .upload(fileName, buffer, { contentType: imageData.mimeType || 'image/jpeg' });

      if (uploadError) {
        console.error(`[dbOperations] 이미지 ${index} 업로드 실패:`, uploadError);
      }

      const { data: urlData } = supabase.storage.from('uploaded-images').getPublicUrl(fileName);
      return { index, url: urlData?.publicUrl || fileName };
    })
  );

  results.sort((a, b) => a.index - b.index);
  return results.map((r) => r.url);
}

// ─── 세션 생성 (image_urls 검증/정리 포함) ──────────────────
// 원본: sessionManager.ts#createSession

/**
 * 분석 세션을 생성한다.
 * - image_urls를 검증/정리하여 저장
 * - 저장 후 데이터 정합성 검증 로그 출력
 * @returns {string} 생성된 세션 ID
 */
export async function createSession(supabase, userId, imageUrls) {
  console.log('[dbOperations:createSession] 세션 생성 시작', {
    imageUrlsCount: imageUrls.length,
  });

  // image_urls 배열 검증 및 정리
  const cleanedImageUrls = imageUrls.filter((url) => url && typeof url === 'string' && url.trim().length > 0);
  if (cleanedImageUrls.length !== imageUrls.length) {
    console.warn('[dbOperations:createSession] 유효하지 않은 URL 필터링됨', {
      originalCount: imageUrls.length,
      cleanedCount: cleanedImageUrls.length,
    });
  }

  const finalImageUrls = cleanedImageUrls.length > 0 ? cleanedImageUrls : imageUrls;

  const { data: sessionData, error: sessionError } = await supabase
    .from('sessions')
    .insert({
      user_id: userId,
      image_urls: finalImageUrls,
      status: 'pending', // worker가 lease 잡을 때 'processing'으로 전환 — C1 race 회피
    })
    .select('id, image_urls')
    .single();

  if (sessionError || !sessionData) {
    console.error('[dbOperations:createSession] 에러 상세:', JSON.stringify(sessionError));
    throw new StageError('session_create', '세션 생성 실패', { sessionError });
  }

  const sessionId = sessionData.id;

  // 저장된 데이터 검증
  if (!Array.isArray(sessionData.image_urls)) {
    console.error('[dbOperations:createSession] WARNING - image_urls가 배열이 아님!', {
      sessionId,
      type: typeof sessionData.image_urls,
      value: sessionData.image_urls,
    });
  } else if (sessionData.image_urls.length !== imageUrls.length) {
    console.warn('[dbOperations:createSession] WARNING - image_urls 갯수 불일치!', {
      sessionId,
      expected: imageUrls.length,
      actual: sessionData.image_urls.length,
    });
  }

  console.log('[dbOperations:createSession] 세션 생성 완료', { sessionId });
  return sessionId;
}

// ─── 문제(problems) 저장 ────────────────────────────────────
// 원본: problemSaver.ts#saveProblems

/**
 * 추출된 문제 데이터를 DB에 저장
 * - choices 정규화 (문자열/객체 배열 모두 지원)
 * - stem 텍스트 생성 (instruction + passage + question_body 조합)
 * - content JSONB 상세 필드 포함
 * - problem_metadata 기본값 제공
 *
 * @returns {Array} 저장된 problems 배열 (id, index_in_image)
 */
export async function saveProblems(supabase, sessionId, validatedItems) {
  console.log(`[dbOperations:saveProblems] 문제 저장 시작`, { sessionId, itemCount: validatedItems.length });

  const problemsPayload = validatedItems.map((it, idx) => {
    const normalizedChoicesArr = normalizeChoices(it.choices);
    const contentJson = buildContentJson(it, normalizedChoicesArr);

    return {
      session_id: sessionId,
      index_in_image: idx, // 항상 배열 인덱스 사용 (0부터 순차적으로 증가)
      content: contentJson,
      problem_metadata: it.metadata || {
        difficulty: '중',
        word_difficulty: 5,
        problem_type: '분석 대기',
        analysis: '분석 정보 없음',
      },
    };
  });

  const { data: savedProblems, error: insertError } = await supabase
    .from('problems')
    .insert(problemsPayload)
    .select('id, index_in_image');

  if (insertError) {
    console.error('[dbOperations:saveProblems] problems insert 에러:', JSON.stringify(insertError));
    throw new StageError('insert_problems', '문제 저장 실패', { insertError });
  }

  console.log(`[dbOperations:saveProblems] ${savedProblems?.length || 0}개 문제 저장 완료`, { sessionId });

  return savedProblems;
}

// ─── 라벨(labels) 저장 ──────────────────────────────────────
// 원본: labelProcessor.ts#buildLabelsPayload + index.ts Step 5

/**
 * AI 분석 결과를 labels 테이블에 저장
 *
 * - is_correct 2단계 판정: O/X 마크 우선 → 자동 비교 폴백
 * - taxonomy 보강: depth→code/CEFR/난이도 조회, 부분 depth 시 전체 null, code 역방향 복원
 * - 실패 시 StageError throw
 *
 * @param {object} supabase
 * @param {string} sessionId
 * @param {Array} savedProblems - { id, index_in_image }
 * @param {Array} validatedItems - AI 추출 아이템
 * @param {Map} taxonomyByDepthKey - depth1␟depth2␟depth3␟depth4 → { code, cefr, difficulty }
 * @param {Map} taxonomyByCode - code → { depth1~4, code, cefr, difficulty }
 */
export async function saveLabels(supabase, sessionId, savedProblems, validatedItems, taxonomyByDepthKey, taxonomyByCode) {
  const idByIndex = new Map();
  for (const row of savedProblems) {
    if (idByIndex.has(row.index_in_image)) {
      console.error(`[dbOperations:saveLabels] 중복 index_in_image 감지: ${row.index_in_image}`, { sessionId, problemId: row.id });
    }
    idByIndex.set(row.index_in_image, row.id);
  }

  const labelsPayload = [];

  for (let idx = 0; idx < validatedItems.length; idx++) {
    const it = validatedItems[idx];
    const problemId = idByIndex.get(idx);
    if (!problemId) {
      console.error(`[dbOperations:saveLabels] index ${idx}에 대한 problem_id 없음`, {
        sessionId,
        idByIndexSize: idByIndex.size,
        idByIndexKeys: Array.from(idByIndex.keys()),
        itemsLength: validatedItems.length,
      });
      continue;
    }

    // ─── is_correct 판정 (computeIsCorrect 단일 진실원) ───
    // 1차: 시험지 O/X 채점 마크, 2차: user/correct 자동 비교. eval 하네스가 동일 함수로 재현.
    // 다중정답(multi MC): resolveAnswerFormat이 buildContentJson과 동일 규칙으로 answer_format/
    // correct_answers/user_answers를 산출해 computeIsCorrect에 전달(단일 문항은 fmt.answerFormat
    // ='single'이라 아래 두 호출 모두 기존 동작과 완전히 동일).
    const fmt = resolveAnswerFormat(it, it.choices);
    const isCorrect = computeIsCorrect({
      user_marked_correctness: it.user_marked_correctness,
      user_answer: it.user_answer,
      correct_answer: it.correct_answer,
      choices: it.choices,
      instruction: it.instruction,
      answer_format: fmt.answerFormat,
      correct_answers: fmt.correctAnswers,
      user_answers: fmt.userAnswers,
    });

    // ─── taxonomy 보강 ───
    const classification = it.classification || {};

    const rawDepth1 = cleanOrNull(classification.depth1);
    const rawDepth2 = cleanOrNull(classification.depth2);
    const rawDepth3 = cleanOrNull(classification.depth3);
    const rawDepth4 = cleanOrNull(classification.depth4);
    const rawCode = cleanOrNull(classification.code);

    let depth1 = rawDepth1;
    let depth2 = rawDepth2;
    let depth3 = rawDepth3;
    let depth4 = rawDepth4;

    let taxonomyCode = null;
    let taxonomyCefr = null;
    let taxonomyDifficulty = null;

    // 1) depth1~4가 모두 있으면 → depth로 code/cefr/difficulty 조회
    const hasAnyDepth = !!(depth1 || depth2 || depth3 || depth4);
    const hasAllDepth = !!(depth1 && depth2 && depth3 && depth4);

    if (hasAllDepth) {
      const mapped = taxonomyByDepthKey.get(makeDepthKey(depth1, depth2, depth3, depth4));
      taxonomyCode = mapped?.code ?? null;
      taxonomyCefr = mapped?.cefr ?? null;
      taxonomyDifficulty = mapped?.difficulty ?? null;
    }

    // 2) depth 완전일치 실패 & code만 있으면 → code로 depth 역방향 복원
    if (!taxonomyCode && rawCode) {
      const mapped = taxonomyByCode.get(rawCode);
      if (mapped) {
        taxonomyCode = mapped.code ?? null;
        taxonomyCefr = mapped.cefr ?? null;
        taxonomyDifficulty = mapped.difficulty ?? null;
        depth1 = mapped.depth1 ?? null;
        depth2 = mapped.depth2 ?? null;
        depth3 = mapped.depth3 ?? null;
        depth4 = mapped.depth4 ?? null;
      } else {
        console.warn(`[dbOperations:saveLabels] 유효하지 않은 taxonomy code: "${rawCode}"`);
      }
    }

    // 3) depth/code 정식매핑 모두 실패 + depth 일부라도 제공 → 부분매칭 fallback
    //    AI가 경로를 미세하게 어긋나게 생성(백틱/공백 오타, depth 누락 축약)해도 구제한다.
    //    정확도 우선: 유일 수렴만 채택, 모호하면 대분류만 유지하거나 미분류.
    if (!taxonomyCode && hasAnyDepth) {
      const fuzzy = fuzzyMatchTaxonomy([rawDepth1, rawDepth2, rawDepth3, rawDepth4], taxonomyByCode);
      if (fuzzy) {
        depth1 = fuzzy.depth1 ?? null;
        depth2 = fuzzy.depth2 ?? null;
        depth3 = fuzzy.depth3 ?? null;
        depth4 = fuzzy.depth4 ?? null;
        taxonomyCode = fuzzy.code ?? null;
        taxonomyCefr = fuzzy.cefr ?? null;
        taxonomyDifficulty = fuzzy.difficulty ?? null;
        console.log(`[dbOperations:saveLabels] Taxonomy 부분매칭 복원: ${rawDepth1}/${rawDepth2}/${rawDepth3}/${rawDepth4} → ${taxonomyCode}`);
      } else {
        // 유일 수렴 실패 → 최소 대분류(depth1)라도 정식이면 유지("어떻게든 분류"), 아니면 전체 null
        const canon1 = canonicalDepth1(rawDepth1, taxonomyByCode);
        if (canon1) {
          depth1 = canon1;
          depth2 = depth3 = depth4 = null;
          console.log(`[dbOperations:saveLabels] Taxonomy 대분류만 확정: ${rawDepth1} → ${canon1}`);
        } else {
          console.warn(`[dbOperations:saveLabels] Taxonomy mapping 완전 실패: ${rawDepth1}/${rawDepth2}/${rawDepth3}/${rawDepth4}`);
          depth1 = depth2 = depth3 = depth4 = null;
        }
      }
    }

    const enrichedClassification = {
      depth1,
      depth2,
      depth3,
      depth4,
      code: taxonomyCode,
      CEFR: taxonomyCefr,
      난이도: taxonomyDifficulty,
    };

    labelsPayload.push({
      problem_id: problemId,
      user_answer: fmt.flatUser,
      user_mark: null,
      is_correct: isCorrect,
      correct_answer: fmt.flatCorrect,
      classification: enrichedClassification,
    });
  }

  if (labelsPayload.length === 0) {
    console.warn('[dbOperations:saveLabels] 저장할 라벨이 없습니다', { sessionId });
  } else {
    console.log(`[dbOperations:saveLabels] ${labelsPayload.length}개 라벨 저장 시작`, { sessionId });
    const { error: labelsError } = await supabase.from('labels').insert(labelsPayload);
    if (labelsError) {
      console.error('[dbOperations:saveLabels] labels insert 실패:', JSON.stringify(labelsError), {
        sessionId,
        validLabelsPayloadCount: labelsPayload.length,
      });
      throw new StageError('insert_labels', 'Labels insert failed', { validLabelsPayloadCount: labelsPayload.length });
    }
    console.log(`[dbOperations:saveLabels] ${labelsPayload.length}개 라벨 저장 완료`, { sessionId });
  }
}

// ─── 메타데이터 업데이트 (난이도 양방향 정규화) ─────────────
// 원본: index.ts:261-279

/**
 * 문제별 메타데이터 업데이트 (난이도, 어휘 난이도, 분석)
 * 난이도를 영어↔한국어 양방향으로 정규화한다.
 */
function normalizeDifficulty(difficulty, userLanguage) {
  if (userLanguage === 'en') {
    const valid = ['high', 'medium', 'low'];
    if (valid.includes(difficulty || '')) return difficulty;
    if (difficulty === '상') return 'high';
    if (difficulty === '중') return 'medium';
    if (difficulty === '하') return 'low';
    return 'medium';
  } else {
    const valid = ['상', '중', '하'];
    if (valid.includes(difficulty || '')) return difficulty;
    if (difficulty === 'high') return '상';
    if (difficulty === 'medium') return '중';
    if (difficulty === 'low') return '하';
    return '중';
  }
}

/**
 * 메타데이터 N개 UPDATE + sessions.status='completed' 를 단일 RPC로 atomic 처리.
 * 기존 Promise.all 병렬 UPDATE는 PgBouncer transaction pooling 환경에서 한 UPDATE의
 * 실패가 같은 backend connection의 다른 transaction을 25P02 (current transaction is aborted)
 * cascade 시키는 문제가 있었음. 단일 PL/pgSQL 트랜잭션 RPC로 원천 차단.
 */
export async function finalizeAnalysisSession(supabase, sessionId, analysisModel, savedProblems, validatedItems, userLanguage) {
  const problemUpdates = [];
  for (const problem of savedProblems) {
    const originalItem = validatedItems[problem.index_in_image];
    if (!originalItem) continue;

    const meta = originalItem.metadata || {};
    const cls = originalItem.classification || {};

    const typeParts = [cls.depth1, cls.depth2, cls.depth3, cls.depth4]
      .filter((v) => typeof v === 'string' && v.trim().length > 0);
    const problemType = typeParts.length > 0
      ? typeParts.join(' - ')
      : (userLanguage === 'ko' ? '분류 없음' : 'Unclassified');

    const difficulty = normalizeDifficulty(meta.difficulty, userLanguage);
    const wdNum = Number(meta.word_difficulty);
    const wordDifficulty = (!isNaN(wdNum) && wdNum >= 1 && wdNum <= 9) ? Math.round(wdNum) : 5;

    problemUpdates.push({
      id: problem.id,
      metadata: {
        difficulty,
        word_difficulty: wordDifficulty,
        problem_type: problemType,
        analysis: meta.analysis || '',
      },
    });
  }

  console.log(`[dbOperations:finalizeAnalysisSession] RPC 호출`, { sessionId, problemCount: problemUpdates.length });

  const { data, error } = await supabase.rpc('finalize_analysis_session', {
    p_session_id: sessionId,
    p_analysis_model: analysisModel,
    p_problem_updates: problemUpdates,
  });

  if (error) {
    console.error(`[dbOperations:finalizeAnalysisSession] RPC 실패`, { sessionId, error });
    throw error;
  }

  // idempotency 분기 처리 (RPC가 already_finalized/session_not_found 반환 가능)
  if (data?.reason === 'session_not_found') {
    console.error(`[dbOperations:finalizeAnalysisSession] 세션 없음`, { sessionId });
    throw new Error(`finalize: session ${sessionId} not found`);
  }
  if (data?.reason === 'already_finalized') {
    console.warn(`[dbOperations:finalizeAnalysisSession] 중복 호출 감지 (no-op)`, { sessionId, current_status: data.current_status });
    return data;
  }

  console.log(`[dbOperations:finalizeAnalysisSession] 완료`, { sessionId, result: data });
  return data;
}
