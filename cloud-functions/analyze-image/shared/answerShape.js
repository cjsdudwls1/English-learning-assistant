/**
 * 정답값의 "모양"(cardinality) — 채점기가 실제로 구분해야 하는 유일한 분류.
 *
 * answer_format은 그동안 두 일을 겸했다.
 *   (A) 지면 재현용 문제 유형 이름 — 교재가 새 유형을 내놓을 때마다 늘어난다(무한).
 *   (B) 채점 판정용 분기 — 값을 어떻게 비교할지(유한).
 * 그래서 새 유형이 하나 생길 때마다 채점 코드에 분기가 따라 붙었다. 여기서 (B)만 떼어낸다.
 * 채점에 필요한 값의 모양은 셋뿐이다.
 *
 *   one  — 값 하나. 단일 비교.             (단일답 객관식, 단답 서술)
 *   set  — 순서 무관 집합. 완전일치.        (복수정답 multi_select)
 *   list — 순서 있는 리스트. 인덱스별 비교.  (다중빈칸 multi_blank)
 *
 * 새 문제 유형은 이 셋 중 하나로 떨어지거나, 떨어지지 않으면 null(판정 불가)이다.
 * null이면 채점기는 기권한다 — precision-first 원칙상 자신있는 오답이 기권보다 해롭다.
 * 즉 answer_format에 처음 보는 값이 와도 채점 코드는 고칠 필요가 없다.
 *
 * answer_format 자체는 남는다. 다만 표시·재현 전용(A)으로 역할이 줄어든다.
 */
import { isMultiSelectFmt } from './answerSanitizers.js';

/** @typedef {'one'|'set'|'list'} Cardinality */

/**
 * answer_format → cardinality.
 *
 * content.cardinality로 저장도 하지만(SQL 집계용), 코드는 저장값을 읽지 않고 매번 이 함수로
 * 다시 구한다. 저장 시점의 매핑이 굳는 걸 막기 위해서다 — 규칙이 바뀌어도 옛 행의 채점이
 * 어긋나지 않는다. 순수함수라 재계산 비용은 없다.
 *
 * @param {unknown} fmt answer_format 값 (미설정·빈 문자열 허용)
 * @returns {Cardinality|null} 판정 불가면 null → 호출부는 기권해야 한다
 */
export function toCardinality(fmt) {
  // 미설정 = 형식 개념이 도입되기 전의 레거시 데이터. 그 시절 저장된 건 전부 단일답이다.
  if (fmt == null) return 'one';
  const f = String(fmt).trim();
  if (f === '' || f === 'single') return 'one';
  if (isMultiSelectFmt(f)) return 'set'; // 'multi'(저장 계약) | 'multi_select'(모델·GT 어휘)
  if (f === 'multi_blank') return 'list';
  return null; // 'unknown' 및 아직 모르는 값 — 판정하지 않는다
}
