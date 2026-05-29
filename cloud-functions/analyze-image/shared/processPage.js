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
  executePassC, detectSubjectiveUserAnswers, detectCorrectFromCrops,
} from './passes.js';
import { USER_ANSWER_MODEL_SEQUENCE } from './config.js';

/**
 * Pass B marks를 검증하고 pageItems에 병합한다.
 * - 객관식(선택지 1~5)의 경우 범위 밖이면 폐기
 * - 주관식/서술형/O/X는 자유 텍스트 허용
 * - user_answer, correct_answer, user_marked_correctness 모두 병합
 */
export function mergeHandwritingMarks(pageItems, marks, sessionId) {
  if (marks.length === 0) return;

  // 진단 로그: 필터링 전 전체 marks 출력
  console.log(`[Pass B] Raw marks BEFORE filtering:`, {
    sessionId,
    marks: marks.map(m =>
      `Q${m.problem_number}: user_answer=${m.user_answer}, correct_answer=${m.correct_answer ?? 'N/A'}`
    ),
  });

  for (const mark of marks) {
    // 선택지 범위 초과 검증: 객관식인 경우만 유효한 선택지 번호(1~5) 체크
    if (mark.user_answer) {
      const ansNum = parseInt(mark.user_answer, 10);
      // 순수 숫자인데 범위 밖인 경우만 폐기 (주관식/서술형 자유 텍스트는 허용)
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

    let isSubjective;
    if (hasObjectiveKw && !hasSubjectiveKw) {
      isSubjective = false; // 명시적 객관식 (choices 추출 실패해도 객관식)
    } else if (hasSubjectiveKw && !hasObjectiveKw) {
      isSubjective = true; // 명시적 주관식
    } else if (hasObjectiveKw && hasSubjectiveKw) {
      // 양쪽 키워드 모두 있으면 choices 유무로 결정
      isSubjective = !hasChoices;
    } else {
      // 키워드 없음 → 객관식 기본.
      // choices=0이어도 주관식 키워드가 없으면 주관식으로 단정하지 않는다.
      // 영어 시험(28~45)은 대부분 객관식이며, 묶음 문제([38~39] 등)의 후속 문항은
      // instruction이 비고 위치마커(①~⑤)가 choices로 안 잡혀 choices=0이 되곤 한다.
      // 이를 주관식으로 오판하면 correct_answer가 번호 대신 지문 문장으로 추출되는 결함 발생
      // (실측: Q39 correct가 지문 문장 전체로 추출됨).
      isSubjective = false;
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

  if (pass0Result.bboxes.length > 0) {
    // bbox가 있으면: 서버 사이드 크롭 → Pass B 크롭 기반 분석
    try {
      const cropResult = await cropRegions(imageData.imageBase64, imageData.mimeType, pass0Result.bboxes);
      const answerAreaCrops = cropResult.answerAreaCrops;
      const fullCrops = cropResult.fullCrops;
      console.log(`[handler] 크롭: ${answerAreaCrops.length} answer + ${fullCrops.length} full`, { sessionId });

      passBResult = await executePassB({ ai, sessionId, answerAreaCrops, fullCrops, questionContextMap, correctSource });
      console.log(`[handler] Pass B (크롭): ${passBResult.marks.length}개 marks (기대: ${pageItems.length}개)`, { sessionId });

      // marks에서 통째로 누락된 문항(크롭 fetch 실패 등)
      const missingProblems = pageItems
        .filter(it => !passBResult.marks.some(m => String(m.problem_number) === String(it.problem_number)))
        .map(it => String(it.problem_number));
      // correct_answer가 비어있는 mark 존재 여부
      const hasMissingCorrect = passBResult.marks.some(m => m.correct_answer == null || String(m.correct_answer).trim() === '');

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
  mergeHandwritingMarks(pageItems, passBResult.marks, sessionId);

  // Subjective questions: full-image based user_answer detection (overrides crop-based results)
  const subjectiveProblems = [];
  for (const [pNum, ctx] of questionContextMap) {
    if (ctx.isSubjective) {
      subjectiveProblems.push({ problem_number: pNum, instruction: ctx.instruction, questionBody: ctx.questionBody });
    }
  }
  if (subjectiveProblems.length > 0) {
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
