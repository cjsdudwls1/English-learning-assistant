/**
 * answer_area_bbox 결정화 — Document AI 원문자(①~⑤) 심볼 기반
 * processPage.js에서 분리(행위보존). processPage가 크롭 직전에 호출한다.
 */

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
export function refineAnswerAreasWithSymbols(bboxes, symbols, questionContextMap, sessionId) {
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
