/**
 * 다중 페이지 결과 병합 — 중복 problem_number 제거 + 결손 보충
 *
 * index.js에서 추출(행위보존 + 페이지 키 도입). 단일 소스화로 eval 하네스도 동일 로직 공유.
 *
 * ## 병합 키 = (페이지 인덱스, problem_number)
 * 같은 **페이지 내** 중복만 병합한다. 서로 다른 페이지의 같은 번호는 '다른 문제'로 보고
 * 둘 다 보존한다.
 *
 * 왜 페이지를 키에 넣는가: 워크북·문제집은 단원/페이지마다 1번부터 다시 시작하므로,
 * 여러 장을 한 세션에 올리면 번호 충돌이 **기본 시나리오**다. 번호 단독 키로 병합하면
 *  (1) backfill이 다른 문제의 본문/학생답을 빈 필드에 채워 **짜깁기 오염** 발생,
 *  (2) substanceScore에서 진 항목이 order에서 빠져 **정당문항 소실** 발생.
 * 실측 세션 4d1509b0: RAMI "5형식 심화" 1번과 "부가의문문" 1번이 둘 다 1번 →
 *   5형식 1번 레코드에 부가의문문 1번의 ua("Weren't you…")·body가 혼입, 부가의문문 1~10 소실.
 *
 * ## 같은 (페이지,번호) 중복 처리 (페이지 내 범위헤더 재추출 등)
 * substanceScore(선택지>본문/지문>답>지시문)가 가장 높은 항목만 남기고, 버리는 쪽의
 * 비어있지 않은 답/지문 필드는 남는 항목의 결손에 보충한다(페이지 내에서 한 문항이
 * 행 분할로 두 번 잡힌 경우의 필드 유실 방지).
 *
 * 등장 순서(페이지 순서) 보존. saveProblems/saveLabels가 배열 인덱스로 매칭하므로
 * 두 호출 이전에 단 한 번만 적용해야 한다.
 *
 * @param {Array} items - 각 item에 `_page_index`(페이지 인덱스)가 태깅되어 있어야 한다.
 *                        없으면 'x'로 폴백(전부 같은 그룹) → 번호 단독 키와 동일하게 동작.
 * @param {string} sessionId
 * @returns {Array} 중복 제거된 items(등장 순서 보존)
 */
export function dedupeProblemItems(items, sessionId) {
  const substanceScore = (it) => {
    const choices = Array.isArray(it.choices) ? it.choices.length : 0;
    const hasAns = (it.correct_answer != null && String(it.correct_answer).trim() !== '')
      || (it.user_answer != null && String(it.user_answer).trim() !== '');
    const hasBody = !!(it.question_body && String(it.question_body).trim())
      || !!(it.passage && String(it.passage).trim())
      || !!(it.shared_passage_ref && String(it.shared_passage_ref).trim());
    const hasInstr = !!(it.instruction && String(it.instruction).trim());
    return choices * 10 + (hasAns ? 5 : 0) + (hasBody ? 2 : 0) + (hasInstr ? 1 : 0);
  };

  // 버리는 항목의 비어있지 않은 답/지문 필드를 남는 항목의 결손에 보충
  const backfill = (keep, drop) => {
    for (const f of ['user_answer', 'correct_answer', 'user_marked_correctness', 'passage', 'shared_passage_ref', 'question_body']) {
      const cur = keep[f];
      const curEmpty = cur == null || (typeof cur === 'string' && cur.trim() === '');
      if (curEmpty && drop[f] != null && String(drop[f]).trim() !== '') keep[f] = drop[f];
    }
  };

  const byKey = new Map(); // (페이지,번호) → 채택된 item
  const order = [];
  let droppedCount = 0;
  for (const it of items) {
    const num = String(it.problem_number ?? '').trim();
    if (!num) { order.push(it); continue; } // 번호 없는 항목은 그대로 보존
    // 페이지 인덱스를 키에 결합 → 다른 페이지의 같은 번호는 충돌하지 않음(각자 보존)
    const key = `${it._page_index ?? 'x'}␟${num}`;
    if (!byKey.has(key)) {
      byKey.set(key, it);
      order.push(it);
      continue;
    }
    const prev = byKey.get(key);
    droppedCount++;
    if (substanceScore(it) > substanceScore(prev)) {
      backfill(it, prev); // 새 항목 채택, 이전 항목 정보 보충 후 자리 교체
      const idx = order.indexOf(prev);
      if (idx >= 0) order[idx] = it;
      byKey.set(key, it);
    } else {
      backfill(prev, it); // 이전 항목 유지, 새 항목 정보 보충
    }
  }
  if (droppedCount > 0) {
    console.log(`[handler] 중복 (page,problem_number) 제거: ${items.length} → ${order.length} (${droppedCount}개 병합)`, { sessionId });
  }
  return order;
}
