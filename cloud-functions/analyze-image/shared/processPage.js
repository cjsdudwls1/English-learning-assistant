/**
 * 단일 페이지 4-Pass 분석 오케스트레이션 모듈
 * - index.js에서 추출 (행위보존). 프로덕션(index.js)과 로컬 eval 하네스가
 *   동일 코드를 공유하도록 단일 소스화한다.
 * - processPage: Pass A(구조) + Pass 0(좌표) → 크롭 → Pass B(필기) → 주관식 → Pass C(분류)
 * - mergeHandwritingMarks: Pass B marks 검증 + pageItems 병합
 *
 * 원본: pageAnalyzer.ts#analyzeOnePage / mergeHandwritingMarks
 */

import { cropRegions } from './imageCropper.js';
import {
  executePassA, executePass0, executePassB, executePassBFullImage,
  executePassC, detectSubjectiveUserAnswers, detectCorrectFromCrops, detectFromCrops,
  sanitizeMcAnswer, normalizeChoiceValue,
} from './passes.js';
import { USER_ANSWER_MODEL_SEQUENCE } from './config.js';
import { buildCroppedUserAnswerPrompt } from './prompts.js';

// answer_area 결정화 패딩(0~1000 스케일).
const REFINE_XPAD_LEFT = 30;   // 좌측: 문제번호 열/원문자 좌측 삐침 여유
const REFINE_XPAD_RIGHT = 90;  // 우측: 선택지 텍스트·마크 우측 삐침 여유
const REFINE_YPAD = 15;        // 상하: 마크가 원문자 위/아래로 삐치는 여유

/**
 * answer_area_bbox 결정화(Document AI 원문자 기반).
 * - Pass 0(LLM)이 answer_area_bbox를 런마다 다르게 잡는 비결정성 때문에, 선택지 열 '사이'를
 *   지나는 구조적 곡선을 마크로 오인하던 문제를 제거한다(실측 Q25: 곡선을 ② 위로 감싸는
 *   런에서만 user_answer=②로 confident-wrong. 원문자 기반 고정 bbox면 곡선 포함해도 3/3 '4').
 * - 각 문항 full_bbox 내부의 원문자(①②③④⑤) 심볼 bounding으로 answer_area의 세로 범위(y)와
 *   좌측 경계를 결정적으로 재산출한다. y는 선택지 행에 밀착시켜 곡선의 세로 조각을 최소화한다.
 *   x1은 Pass 0가 잡은 문제번호 열 확장을 보존하기 위해 원본과 원문자 좌측 중 더 왼쪽을 취하고,
 *   x2는 선택지 텍스트/마크 여유를 위해 원본과 원문자 우측+여유 중 큰 쪽을 취한다.
 *   모든 경계는 full_bbox 내부로 클램프(Pass 0 constraint A 유지).
 * - 원문자가 2개 미만 검출된 문항(서술형·원문자 미검출·Document AI off)은 원본 bbox를 그대로
 *   둔다 → 정상 경로 무회귀(정밀도 우선: 근거 없는 재계산으로 정상 케이스를 흔들지 않는다).
 * @returns 새 bboxes 배열(answer_area_bbox만 교체, full_bbox·problem_number 불변)
 */
function refineAnswerAreasWithSymbols(bboxes, symbols, questionContextMap, sessionId) {
  if (!Array.isArray(symbols) || symbols.length === 0) return bboxes;
  return bboxes.map((b) => {
    const full = b.full_bbox;
    const ans = b.answer_area_bbox;
    if (!full || !ans) return b;
    const ctx = questionContextMap?.get(String(b.problem_number));
    if (ctx?.isSubjective) return b; // 서술형은 선택지 원문자가 없음 → 손대지 않음

    // 이 문항 full_bbox 내부의 원문자만 수집(중심 기준) → 인접 문항 원문자 혼입 방지
    const inside = symbols.filter((s) => {
      const cx = (s.x1 + s.x2) / 2, cy = (s.y1 + s.y2) / 2;
      return cx >= full.x1 && cx <= full.x2 && cy >= full.y1 && cy <= full.y2;
    });
    if (inside.length < 2) return b; // 근거 부족 → 원본 유지(무회귀)

    const minX = Math.min(...inside.map((s) => s.x1));
    const minY = Math.min(...inside.map((s) => s.y1));
    const maxX = Math.max(...inside.map((s) => s.x2));
    const maxY = Math.max(...inside.map((s) => s.y2));
    const refined = {
      x1: Math.max(full.x1, Math.min(ans.x1, minX - REFINE_XPAD_LEFT)),
      y1: Math.max(full.y1, minY - REFINE_YPAD),
      x2: Math.min(full.x2, Math.max(ans.x2, maxX + REFINE_XPAD_RIGHT)),
      y2: Math.min(full.y2, maxY + REFINE_YPAD),
    };
    console.log(`[refine] Q${b.problem_number} answer_area 결정화(${inside.length}원문자): y[${Math.round(ans.y1)}~${Math.round(ans.y2)}]→[${Math.round(refined.y1)}~${Math.round(refined.y2)}]`, { sessionId });
    return { ...b, answer_area_bbox: refined };
  });
}

/**
 * Pass B marks를 검증하고 pageItems에 병합한다.
 * - 객관식(선택지 1~5)의 경우 범위 밖이면 폐기
 * - 주관식/서술형/O/X는 자유 텍스트 허용
 * - user_answer, correct_answer, user_marked_correctness 모두 병합
 */
export function mergeHandwritingMarks(pageItems, marks, sessionId, questionContextMap) {
  if (marks.length === 0) return;

  // 진단 로그: 필터링 전 전체 marks 출력
  console.log(`[Pass B] Raw marks BEFORE filtering:`, {
    sessionId,
    marks: marks.map(m =>
      `Q${m.problem_number}: user_answer=${m.user_answer}, correct_answer=${m.correct_answer ?? 'N/A'}`
    ),
  });

  // 객관식 답 형식 백스톱(단일 관문): 모든 Pass B 경로(크롭/전체이미지 fallback/서술 override)가
  // 이 병합을 반드시 통과한다. 크롭 경로는 detectFromCrops에서 sanitizeMcAnswer를 거치지만,
  // 전체이미지 fallback(executePassBFullImage)은 normalizeChoiceValue만 적용해 객관식 답이
  // 텍스트("him")·범위밖("7")·문장으로 새어들 수 있다(실측 12번류 재발 경로). 여기서 최종 정규화해
  // 객관식 correct_answer/user_answer의 오염을 차단한다(confident-wrong 방지, 정밀도 우선).
  // - 서술형(isSubjective) 또는 선택지 부재 → sanitizeMcAnswer가 원값을 그대로 통과시켜
  //   자유텍스트 답을 보존한다. 특히 isSubjective=false로 잘못 분류된 서술형(실측 20250420
  //   Q7 정답"Are"·Q9 문장형)도 선택지 부재 게이트로 파괴되지 않는다(보호 로직은 sanitizeMcAnswer
  //   단일 지점이 담당 → 크롭 주경로 detectFromCrops와 이 백스톱이 동일하게 보호받는다).
  // - questionContextMap 미전달(구버전 하위호환) 시엔 과거 동작(범위밖 숫자만 폐기)으로 폴백.
  for (const mark of marks) {
    const ctx = questionContextMap?.get(String(mark.problem_number));
    if (ctx) {
      const isSubjective = ctx.isSubjective === true;
      const choices = ctx.choices;
      mark.user_answer = sanitizeMcAnswer(normalizeChoiceValue(mark.user_answer ?? null), isSubjective, choices);
      mark.correct_answer = sanitizeMcAnswer(normalizeChoiceValue(mark.correct_answer ?? null), isSubjective, choices);
    } else if (mark.user_answer) {
      // 하위호환: 컨텍스트 없음 → 순수 숫자 범위검증만(주관식/서술형 자유 텍스트는 허용)
      const ansNum = parseInt(mark.user_answer, 10);
      if (!isNaN(ansNum) && String(ansNum) === String(mark.user_answer).trim() && (ansNum < 1 || ansNum > 5)) {
        console.log(`[Pass B] Q${mark.problem_number}: answer "${mark.user_answer}" is a number out of choice range (1-5) → discarded`);
        mark.user_answer = null;
        mark.ambiguous = true;
      }
    }
  }

  // problem_number → mark 데이터 매핑 (user_answer + correct_answer + user_marked_correctness)
  const markMap = new Map();
  for (const mark of marks) {
    markMap.set(String(mark.problem_number), {
      user_answer: mark.user_answer,
      correct_answer: mark.correct_answer || null,
      user_marked_correctness: mark.user_marked_correctness || null,
    });
  }

  for (const item of pageItems) {
    const pNum = String(item.problem_number || '');
    const match = markMap.get(pNum);
    if (match) {
      item.user_answer = match.user_answer;
      item.correct_answer = match.correct_answer;
      item.user_marked_correctness = match.user_marked_correctness;
    }
  }

  console.log(`[handler] Pass B 병합 완료: ${marks.length}개 marks`, {
    sessionId,
    mergeDetails: marks.map(m =>
      `Q${m.problem_number}: user=${m.user_answer ?? 'null'}, correct=${m.correct_answer ?? 'null'}`
    ),
  });
}

/**
 * 문항 본문 충실도 판정 — 완전한 문제 본문을 가진 정당 문항을 게이트에서 보호하는 신호.
 * 잘린 조각/그룹헤더 유령은 본문이 비거나 파편(영어 소수 단어 + 짧은 한글)이라 false가 된다.
 * 기준: 영어 단어(2글자+) 4개 이상 OR 한글 10자 이상.
 * (실측: 정당 _04 Q66 "He found the book interesting."=영어 5단어 → true,
 *  유령 Q11 "a home. (will 긍정문)"=영어 2·한글 3 → false, 유령 Q12 ""=공백 → false.)
 */
export function hasSubstantialBody(it) {
  const qbody = String(it?.question_body ?? '').trim();
  if (!qbody) return false;
  const enWords = (qbody.match(/[A-Za-z]{2,}/g) || []).length;
  const koChars = (qbody.match(/[가-힣]/g) || []).length;
  return enWords >= 4 || koChars >= 10;
}

/**
 * Over-extraction 조기 게이트 — Pass B/전체이미지 fallback 전에 '정체불명' 유령 문항을 in-place 제거.
 *
 * 사후 게이트(applyOverExtractionGate)만으로 부족한 이유: 전체이미지 fallback이 잘린 조각에
 * correct_answer를 환각으로 채우면(실측 e40e0532 재현: 인접조각 Q11/Q12 → correct 1/2 생성) 답이
 * 생긴 것처럼 보여 빈-껍데기 판정을 우회한다. 답이 오염되기 전에 선제 차단해야 한다.
 *
 * 유령 판정(모두 만족): 객관식 단서 전무(choices 0 + Pass0 bbox 없음 + 객관식 키워드 없음)
 * + 서술형 아님(isSubjective=false) + 지문/시각자료/공유지문 없음.
 * → 정당 문항은 이 단서 중 최소 하나를 보유하므로 보호된다(객관식=choices/bbox/키워드,
 *   서술형=isSubjective, 지문연계=passage/shared_passage_ref). is_fragment(Pass A 플래그)는
 *   보조 로그로만 남긴다(이 결정적 신호 조합이 프롬프트 플래그보다 신뢰성 높음 — 실측상 미작동 케이스 존재).
 *
 * @param {Array} pageItems - Pass A 추출 문항(in-place 수정)
 * @param {Set<string>} bboxNumbers - Pass 0가 bbox를 만든 problem_number 집합
 * @param {Map} questionContextMap - 문항별 컨텍스트(isSubjective/hasObjectiveKw 등). 드롭 시 동기 삭제.
 * @param {string} sessionId
 * @returns {number} 드롭된 문항 수
 */
export function applyEarlyOverExtractionGate(pageItems, bboxNumbers, questionContextMap, sessionId) {
  const before = pageItems.length;
  for (let i = pageItems.length - 1; i >= 0; i--) {
    const it = pageItems[i];
    const pn = String(it.problem_number ?? '');
    const choices = Array.isArray(it.choices) ? it.choices : [];
    const hasChoices = choices.length > 0;
    const hasBbox = bboxNumbers.has(pn);
    const ctx = questionContextMap.get(pn);
    const isSubjective = ctx?.isSubjective === true;
    const hasObjectiveKw = ctx?.hasObjectiveKw === true;
    const hasPassage = !!(it.shared_passage_ref || (it.passage && String(it.passage).trim() !== '') || it.visual_context);
    const hasBody = hasSubstantialBody(it);
    const isGhost = !hasChoices && !hasBbox && !isSubjective && !hasObjectiveKw && !hasPassage && !hasBody;
    if (isGhost) {
      console.warn(`[handler] over-extraction 조기 게이트: Q${pn} 드롭 (choices=0, bbox=무, subjective=false, objKw=false, passage=무, body=무, is_fragment=${it.is_fragment === true})`, { sessionId });
      pageItems.splice(i, 1);
      if (ctx) questionContextMap.delete(pn);
    }
  }
  const dropped = before - pageItems.length;
  if (dropped > 0) {
    console.log(`[handler] over-extraction 조기 게이트: ${before}→${pageItems.length}개 (${dropped}개 유령 드롭)`, { sessionId });
  }
  return dropped;
}

/**
 * Over-extraction(유령 문항) 사후 게이트 — pageItems에서 인접페이지 조각/잘린 빈 껍데기를 in-place 제거한다.
 *
 * 배경: 사용자가 휴대폰으로 찍는 시험지 사진은 가장자리에 인접 페이지의 얇은 슬라이스가 함께
 * 찍히거나, 한 문항이 페이지 경계에서 잘리는 경우가 잦다. Pass A 프롬프트의 강한 recall 편향
 * (모든 번호를 빠짐없이 추출)이 이 조각의 번호까지 문항으로 추출 → 존재하지 않는 유령 문항 노출.
 * 이는 '존재하지 않는 문제를 자신있게 제시'하는 일종의 confident-wrong이므로 정밀도 우선상 제거한다.
 *
 * 드롭 조건(둘 중 하나 — 각자 독립적으로 강한 신호. 정당 문항을 죽이지 않도록 보수적으로 설계):
 *  (1) explicitFragment: Pass A가 is_fragment=true로 명시 + 객관식 아님(choices 0) + 답 미검출.
 *      └ 답(user/correct)이 하나라도 잡힌 문항은 LLM이 fragment로 오표시해도 보호(살림).
 *  (2) emptyShell: choices 0 + user/correct 모두 미검출 + 지문/시각자료/공유지문 없음.
 *      └ 채점에 기여할 정보가 전무한 빈 껍데기 → 표시 가치 0. is_fragment 신호가 없어도 드롭.
 *
 * 정당 문항 보호(절대 드롭 안 됨): 객관식(choices≥1), 답이 하나라도 잡힌 서술형, 지문/시각자료/
 * 공유지문을 보유한 문항. (실측 e40e0532: 정당 서술형 Q6~9는 ua/ca 보유로 유지, 객관식 Q1~5는
 * choices=5로 유지, 유령 Q11/Q12만 emptyShell로 드롭 → 9문항 정확.)
 *
 * @param {Array} pageItems - Pass B 병합까지 끝난 문항 배열(in-place 수정)
 * @param {string} sessionId
 * @returns {number} 드롭된 문항 수
 */
export function applyOverExtractionGate(pageItems, sessionId) {
  const before = pageItems.length;
  for (let i = pageItems.length - 1; i >= 0; i--) {
    const it = pageItems[i];
    const choices = Array.isArray(it.choices) ? it.choices : [];
    const hasChoices = choices.length > 0;
    const ua = it.user_answer, ca = it.correct_answer;
    const hasAnswer = (ua != null && String(ua).trim() !== '') || (ca != null && String(ca).trim() !== '');
    const hasPassage = !!(it.shared_passage_ref || (it.passage && String(it.passage).trim() !== '') || it.visual_context);
    const hasBody = hasSubstantialBody(it);
    // 본문이 충실하면(완전한 문제) 답 인식에 실패했어도 정당 문항 → 보호(드롭 금지).
    const explicitFragment = it.is_fragment === true && !hasChoices && !hasAnswer && !hasBody;
    const emptyShell = !hasChoices && !hasAnswer && !hasPassage && !hasBody;
    if (explicitFragment || emptyShell) {
      console.warn(`[handler] over-extraction 게이트: Q${it.problem_number} 드롭 (reason=${explicitFragment ? 'fragment' : 'empty-shell'}, is_fragment=${it.is_fragment === true}, choices=${choices.length}, body=무, ua=${ua ?? 'null'}, ca=${ca ?? 'null'})`, { sessionId });
      pageItems.splice(i, 1);
    }
  }
  const dropped = before - pageItems.length;
  if (dropped > 0) {
    console.log(`[handler] over-extraction 게이트: ${before}→${pageItems.length}개 (${dropped}개 유령 문항 드롭)`, { sessionId });
  }
  return dropped;
}

/**
 * 단일 페이지에 대한 4-Pass 분석 파이프라인 실행
 * Pass A(구조) + Pass 0(좌표) → 크롭 → Pass B(필기) → Pass C(분류)
 *
 * @param {object} opts
 * @param {boolean} [opts.runClassification=true] - false면 Pass C(분류) 생략.
 *   로컬 eval은 user_answer/correct_answer만 채점하므로 분류 비용을 절약한다.
 *   프로덕션 호출부는 이 옵션을 지정하지 않아 기본 true → 행위 불변.
 *
 * 원본: pageAnalyzer.ts#analyzeOnePage
 */
export async function processPage({ ai, sessionId, imageData, pageNum, totalPages, taxonomyData, userLanguage, runClassification = true, correctSource = 'crop' }) {
  // Pass A + Pass 0 병렬 실행
  const [passAResult, pass0Result] = await Promise.all([
    executePassA({ ai, sessionId, imageBase64: imageData.imageBase64, mimeType: imageData.mimeType, pageNum, totalPages, taxonomyData }),
    executePass0({ ai, sessionId, imageBase64: imageData.imageBase64, mimeType: imageData.mimeType }),
  ]);

  const pageItems = passAResult.parsed?.items || passAResult.parsed?.problems || passAResult.parsed?.pages?.[0]?.problems || [];
  console.log(`[handler] Pass A: ${pageItems.length}개 문제 (${passAResult.model}), Pass 0: ${pass0Result.bboxes.length}개 bbox`, { sessionId });

  // Pass A 결과에서 문제 유형 판별 (객관식 vs 주관식)
  // 우선순위: 명시적 키워드 > choices 유무
  // - 객관식 키워드가 있으면 무조건 객관식 (choices 추출 실패해도)
  // - 주관식 키워드가 있으면 무조건 주관식
  // - 키워드 없으면 choices 유무로 판단
  const OBJECTIVE_KEYWORDS = [
    '고르시오', '고른 것은', '고를 것은', '다음 중', '다음 글의 밑줄', '밑줄 친',
    '적절한 것은', '적절하지 않은 것은', '적절하지 않은', '옳은 것은', '옳지 않은',
    '알맞은 것은', '알맞지 않은', '가장 적절', '가장 알맞은', '바른 것은', '틀린 것은',
    '5지선다', '4지선다', '①', '②', '③', '④', '⑤',
  ];
  const SUBJECTIVE_KEYWORDS = [
    '서술형', '고쳐 쓰', '바꿔 쓰', '영작', '쓰시오', '쓰세요',
    '빈칸을 채우', '빈 칸을 채우', '문장을 완성', '단어를 쓰', '단어를 적', '답을 적',
    '서술하시오', '논술', '단답형',
    // 성분 표시형(주어/동사/목적어/목적격보어 라벨링), 배열/완성/찾아쓰기형 — choices가 없는
    // 주관식인데 객관식 키워드가 없어 미분류되던 유형(실측 _04 Q66~68 "성분을 표시하시오").
    '표시하', '배열하', '나열하', '완성하', '연결하', '찾아 쓰', '찾아서 쓰', '고치시오', '바르게 고',
  ];
  const questionContextMap = new Map();
  for (const item of pageItems) {
    const hasChoices = Array.isArray(item.choices) && item.choices.length > 0;
    const instructionText = item.instruction || '';
    const questionBodyText = item.question_body || '';
    const combinedText = `${instructionText}\n${questionBodyText}`;

    const hasObjectiveKw = OBJECTIVE_KEYWORDS.some(kw => combinedText.includes(kw));
    const hasSubjectiveKw = SUBJECTIVE_KEYWORDS.some(kw => combinedText.includes(kw));

    // 유형 판별 우선순위: 주관식 키워드 유무 → 그다음 choices 유무.
    // 핵심 규칙: 선택지(①~⑤)가 명확히 추출됐으면(hasChoices) 객관식이다.
    // '영작/쓰시오' 같은 주관식 키워드가 instruction에 있어도, 선택지에서 답을 고르는
    // 유형("다음 우리말을 영작할 때 세 번째로 오는 단어는? ①a ②we ③him …")은 객관식.
    // 이를 주관식으로 오판하면 user_answer가 손글씨 낙서로, correct_answer가 선택지
    // 텍스트("him")로 추출돼 정답을 오답 처리하는 결함이 생긴다(실측 12번).
    let isSubjective;
    if (!hasSubjectiveKw) {
      // 주관식 키워드 없음 → 객관식 기본.
      // choices=0이어도 주관식으로 단정하지 않는다(영어 시험 28~45 대부분 객관식,
      // 묶음문제 후속 문항은 위치마커 ①~⑤가 choices로 안 잡혀 choices=0이 되곤 함.
      // 주관식 오판 시 correct_answer가 번호 대신 지문 문장으로 추출됨 — 실측 Q39).
      isSubjective = false;
    } else {
      // 주관식 키워드 존재 → 선택지가 명확히 추출됐으면 객관식, 없으면 주관식.
      // (객관식 키워드 동시 존재 여부와 무관하게 choices가 최종 판단 기준)
      isSubjective = !hasChoices;
    }

    console.log(`[handler] Q${item.problem_number} 유형 판별: isSubjective=${isSubjective}, hasChoices=${hasChoices}, hasObjKw=${hasObjectiveKw}, hasSubjKw=${hasSubjectiveKw}`, { sessionId });

    questionContextMap.set(String(item.problem_number), {
      isSubjective,
      hasObjectiveKw,
      instruction: instructionText,
      questionBody: questionBodyText,
      hasChoices,
      choices: item.choices || [],
    });
  }

  // ── Over-extraction 조기 게이트 (Pass B / 전체이미지 fallback 전에 유령 제거) ──
  // 왜 '조기'인가: 전체이미지 fallback이 잘린 조각(인접페이지)에 correct_answer를 '환각'으로
  // 채우면(실측: 인접조각 Q11/Q12에 correct 1/2 생성) 답이 생긴 것처럼 보여 사후 게이트(빈
  // 껍데기 판정)를 빠져나간다. 그래서 답이 오염되기 전에, 객관식 단서(choices·bbox·객관식
  // 키워드)도 서술형 단서(isSubjective)도 지문/시각자료도 전무한 '정체불명' 항목을 선제 드롭한다.
  // 유령이 pageItems에서 빠지면 fallback의 통째누락 보충 대상에서도 제외되고, fallback이
  // 자발적으로 만든 유령 mark도 병합 시 무시된다(mergeHandwritingMarks는 pageItems만 순회).
  const bboxNumbers = new Set(pass0Result.bboxes.map(b => String(b.problem_number)));
  applyEarlyOverExtractionGate(pageItems, bboxNumbers, questionContextMap, sessionId);

  // Pass B: 크롭 기반 필기 인식 또는 전체 이미지 fallback
  let passBResult;
  let fullCropsForSubjective = null; // 서술형 ua fullCrop-우선 변종용(try 블록 밖 서술형 경로에서 접근)

  if (pass0Result.bboxes.length > 0) {
    // bbox가 있으면: 서버 사이드 크롭 → Pass B 크롭 기반 분석
    try {
      // answer_area_bbox를 Document AI 원문자로 결정화(Pass 0 비결정성 제거, 곡선 오인 방지).
      // full_bbox는 불변 → fullCrops(correct_answer 경로) 무영향. user_answer 경로만 개선.
      const refinedBboxes = refineAnswerAreasWithSymbols(pass0Result.bboxes, passAResult.ocrSymbols, questionContextMap, sessionId);
      const cropResult = await cropRegions(imageData.imageBase64, imageData.mimeType, refinedBboxes);
      const answerAreaCrops = cropResult.answerAreaCrops;
      const fullCrops = cropResult.fullCrops;
      fullCropsForSubjective = fullCrops;
      console.log(`[handler] 크롭: ${answerAreaCrops.length} answer + ${fullCrops.length} full`, { sessionId });

      passBResult = await executePassB({ ai, sessionId, answerAreaCrops, fullCrops, questionContextMap, correctSource });
      console.log(`[handler] Pass B (크롭): ${passBResult.marks.length}개 marks (기대: ${pageItems.length}개)`, { sessionId });

      // marks에서 통째로 누락된 문항(크롭 fetch 실패 등)
      const missingProblems = pageItems
        .filter(it => !passBResult.marks.some(m => String(m.problem_number) === String(it.problem_number)))
        .map(it => String(it.problem_number));
      // correct_answer가 비어있는 mark 존재 여부 — 비-서술형(객관식류)만 대상.
      // 서술형 correct는 자유텍스트라 크롭 추론(주경로)에서 null이 자주 남는데, 그 결손까지
      // fallback을 트리거하면 거의 매 페이지 전체이미지 호출이 상시 발생한다(비용). 서술형 correct의
      // fallback 보충을 포기해도 손실은 abstain(null)일 뿐 confident-wrong이 아니라 안전하다(정밀도 우선).
      // 객관식 결손·통째 누락이 있으면 fallback은 여전히 발동하고 그때 서술형 correct도 함께 보충된다.
      const hasMissingCorrect = passBResult.marks.some(m => {
        const ctx = questionContextMap.get(String(m.problem_number));
        if (ctx?.isSubjective) return false;
        return m.correct_answer == null || String(m.correct_answer).trim() === '';
      });

      // 전체 이미지 fallback은 (1) 통째 누락 문항 복구, (2) correct_answer 결손 보충 용도.
      // user_answer는 일부러 덮어쓰지 않는다: 고해상도 크롭(answerArea + fullCrop 재독해)이
      // 읽지 못한 마크를 저해상도·전체페이지 인식이 추측하면 오답을 주입한다
      // (실측: Q45 정답 ③인데 full-page가 ⑤로 오인식). 못 읽은 마크는 null로 두는 편이
      // 자신있는 오답보다 안전하다.
      if (missingProblems.length > 0 || hasMissingCorrect) {
        console.log(`[handler] Pass B 보충 필요 (통째 누락 [${missingProblems.join(',')}], correct결손=${hasMissingCorrect}), 전체 이미지 fallback`, { sessionId });
        const fallbackResult = await executePassBFullImage({
          ai, sessionId,
          imageBase64: imageData.imageBase64,
          mimeType: imageData.mimeType,
          totalPages,
          focusNumbers: missingProblems,
          modelSequence: USER_ANSWER_MODEL_SEQUENCE, // 전체이미지 필기 지각도 3.5-flash 우선(2.5-flash 인접번호 오인 회피)
        });
        console.log(`[handler] Pass B fallback 보충: ${fallbackResult.marks.length}개 marks`, { sessionId });

        for (const fbMark of fallbackResult.marks) {
          const existing = passBResult.marks.find(m => String(m.problem_number) === String(fbMark.problem_number));
          if (!existing) {
            // 통째 누락 문항: full-page가 유일한 출처이므로 그대로 채택
            passBResult.marks.push(fbMark);
          } else if ((existing.correct_answer == null || String(existing.correct_answer).trim() === '') && fbMark.correct_answer) {
            // 기존 mark는 correct_answer 결손만 보충, user_answer는 보존(덮어쓰지 않음)
            existing.correct_answer = fbMark.correct_answer;
          }
        }
        console.log(`[handler] Pass B 최종 병합: ${passBResult.marks.length}개 marks`, { sessionId });
      }

      // correctSource='fullpage' 잔여 보충: 풀페이지(fallback)가 채우지 못한 correct만 문항별
      // 크롭으로 1회 보충한다. 어법지 등 문항이 많은 페이지에서 풀페이지 1회 추론이 일부 문항
      // correct를 누락(실측: Q5)하는 recall 손실을 메우면서, 호출 증가는 잔여분(보통 0~소수)뿐이다.
      if (correctSource === 'fullpage') {
        const stillMissing = new Set(
          passBResult.marks
            .filter(m => m.correct_answer == null || String(m.correct_answer).trim() === '')
            .map(m => String(m.problem_number))
        );
        const fixCrops = fullCrops.filter(fc => stillMissing.has(String(fc.problem_number)));
        if (fixCrops.length > 0) {
          console.log(`[handler] correct 잔여 보충 ${fixCrops.length}개 크롭: [${fixCrops.map(c => c.problem_number).join(',')}]`, { sessionId });
          const fix = await detectCorrectFromCrops({ ai, sessionId, fullCrops: fixCrops, questionContextMap });
          for (const fm of fix.marks) {
            const ex = passBResult.marks.find(m => String(m.problem_number) === String(fm.problem_number));
            if (ex && (ex.correct_answer == null || String(ex.correct_answer).trim() === '') && fm.correct_answer) {
              ex.correct_answer = fm.correct_answer;
            }
          }
        }
      }
    } catch (cropError) {
      // 크롭 실패 시: 전체 이미지 기반 fallback (이전 pageAnalyzer.ts:288-297 복원)
      console.error(`[handler] 크롭/Pass B 실패, 전체 이미지 fallback:`, cropError?.message, { sessionId });
      passBResult = await executePassBFullImage({
        ai, sessionId,
        imageBase64: imageData.imageBase64,
        mimeType: imageData.mimeType,
        totalPages,
        modelSequence: USER_ANSWER_MODEL_SEQUENCE,
      });
      console.log(`[handler] Pass B (full-image fallback): ${passBResult.marks.length}개 marks`, { sessionId });
    }
  } else {
    // bbox 0개: 전체 이미지 기반 분석 (이전 pageAnalyzer.ts:298-308 복원)
    console.log(`[handler] Pass 0: bbox 0개, 전체 이미지 fallback으로 전환`, { sessionId });
    passBResult = await executePassBFullImage({
      ai, sessionId,
      imageBase64: imageData.imageBase64,
      mimeType: imageData.mimeType,
      totalPages,
      modelSequence: USER_ANSWER_MODEL_SEQUENCE,
    });
    console.log(`[handler] Pass B (full-image fallback): ${passBResult.marks.length}개 marks`, { sessionId });
  }

  // Pass B 결과 병합: 원본 mergeHandwritingMarks 방식으로 검증 + 병합
  // 먼저 pageItems의 user_answer/correct_answer/user_marked_correctness를 null로 초기화
  for (const item of pageItems) {
    item.user_answer = null;
    item.user_marked_correctness = null;
    item.correct_answer = null;
  }
  mergeHandwritingMarks(pageItems, passBResult.marks, sessionId, questionContextMap);

  // Subjective questions: full-image based user_answer detection (overrides crop-based results)
  const subjectiveProblems = [];
  for (const [pNum, ctx] of questionContextMap) {
    if (ctx.isSubjective) {
      subjectiveProblems.push({ problem_number: pNum, instruction: ctx.instruction, questionBody: ctx.questionBody });
    }
  }
  // 서술형 ua override 스위치(eval A/B용, 기본 on=행위보존).
  // off: crop(answerArea) 기반 ua를 유지하고 전체이미지 재추출로 덮어쓰지 않는다.
  //   → 부가의문문 등 '빈칸형' 서술형에서 전체이미지가 인쇄 대화문을 혼입(과추출)하는 것을 회피 검증.
  const SUBJECTIVE_UA_OVERRIDE = process.env.SUBJECTIVE_UA_OVERRIDE !== 'off';
  // fullCrop-우선 변종(eval A/B용): 서술형 ua를 문항별 fullCrop(문제전체+2배확대)에서 재추출.
  //   answer_area_bbox가 다줄 손글씨 답의 상단을 놓치는 경우(실측 Q30 "Doesn't he like cats?"→"cats")를
  //   메우되, fullCrop은 인쇄 본문도 포함하므로 혼입(과추출) 위험을 eval로 검증한다.
  //   우선순위: fullCrop > 전체이미지(SUBJECTIVE_UA_OVERRIDE) > crop(answerArea 유지).
  const SUBJ_UA_FROM_FULLCROP = process.env.SUBJ_UA_FROM_FULLCROP === 'on';
  if (subjectiveProblems.length > 0 && SUBJ_UA_FROM_FULLCROP && fullCropsForSubjective) {
    const subjNums = new Set(subjectiveProblems.map(p => String(p.problem_number)));
    const subjFullCrops = fullCropsForSubjective.filter(fc => subjNums.has(String(fc.problem_number)));
    console.log(`[handler] 주관식 ${subjectiveProblems.length}개 → fullCrop 기반 user_answer 재추출(${subjFullCrops.length}개 크롭)`, { sessionId });
    const subjResult = await detectFromCrops({
      ai, sessionId, crops: subjFullCrops,
      buildPromptFn: (pn, ctx) => buildCroppedUserAnswerPrompt(pn, ctx, true),
      questionContextMap,
      temperature: 0.0,
      modelSequence: USER_ANSWER_MODEL_SEQUENCE,
    });
    for (const mark of subjResult.marks) {
      const item = pageItems.find(it => String(it.problem_number) === String(mark.problem_number));
      if (item && mark.user_answer != null) {
        item.user_answer = mark.user_answer;
      }
    }
  } else if (subjectiveProblems.length > 0 && SUBJECTIVE_UA_OVERRIDE) {
    console.log(`[handler] 주관식 ${subjectiveProblems.length}개 문제 → 전체 이미지 기반 user_answer 감지`, { sessionId });
    const subjectiveResult = await detectSubjectiveUserAnswers({
      ai, sessionId,
      imageBase64: imageData.imageBase64, mimeType: imageData.mimeType,
      subjectiveProblems,
    });
    for (const mark of subjectiveResult.marks) {
      const item = pageItems.find(it => String(it.problem_number) === String(mark.problem_number));
      if (item && mark.user_answer != null) {
        item.user_answer = mark.user_answer;
      }
    }
  }

  // ── Over-extraction(유령 문항) 게이트 ──
  // 인접 페이지 슬라이스/페이지 경계에서 잘린 조각이 problem_number만 보고 추출되는 것을 차단.
  // (드롭 조건·정당문항 보호 로직은 applyOverExtractionGate 정의 참조. 실측 e40e0532:
  //  인접 '고난도 [11-12]' 조각이 Q11/Q12 유령으로 추출 → choices0·ua/ca null·지문없음으로 드롭.)
  applyOverExtractionGate(pageItems, sessionId);

  // Pass C: 분류 (visual_context가 있으면 이미지도 전달)
  // runClassification=false(로컬 eval)면 분류 생략 — user_answer/correct_answer 채점에 불필요.
  if (runClassification) {
    const passCResult = await executePassC({
      ai, sessionId, taxonomyData, pageItems, userLanguage,
      imageBase64: imageData.imageBase64, mimeType: imageData.mimeType,
    });
    console.log(`[handler] Pass C: ${passCResult.classifications.length}개 분류`, { sessionId });
    for (const cls of passCResult.classifications) {
      const matchedItem = pageItems.find(item => String(item.problem_number) === String(cls.problem_number));
      if (matchedItem) {
        matchedItem.classification = cls.classification;
        matchedItem.metadata = cls.metadata;
        // correct_answer는 Pass B에서 설정된 값을 보존
      }
    }
  }

  return { pageItems, usedModel: passAResult.model };
}
