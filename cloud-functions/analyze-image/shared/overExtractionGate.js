/**
 * Over-extraction(유령 문항) 게이트 — 인접페이지 조각/잘린 빈 껍데기 문항 제거
 * processPage.js에서 분리(행위보존). 조기 게이트(Pass B 전)와 사후 게이트(병합 후) 2단.
 */

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
    const isWordChoice = ctx?.isWordChoice === true; // 괄호고르기: choices=0라 유령 오판 위험 → 보호 신호
    const hasPassage = !!(it.shared_passage_ref || (it.passage && String(it.passage).trim() !== '') || it.visual_context);
    const hasBody = hasSubstantialBody(it);
    const isGhost = !hasChoices && !hasBbox && !isSubjective && !hasObjectiveKw && !hasPassage && !hasBody && !isWordChoice;
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
