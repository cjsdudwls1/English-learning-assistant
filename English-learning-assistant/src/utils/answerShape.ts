/**
 * 정답값의 "모양"(cardinality) — 백엔드 cloud-functions/analyze-image/shared/answerShape.js와 1:1 정합.
 *
 * answer_format은 두 일을 겸해 왔다. (A) 지면 재현용 문제 유형 이름(교재가 새 유형을 내놓을 때마다
 * 늘어난다)과 (B) 채점 판정용 분기(유한하다). 그래서 새 유형 하나에 채점 분기가 하나씩 붙었다.
 * 여기서 (B)만 떼어낸다. 채점에 필요한 값의 모양은 셋뿐이다.
 *
 *   one  — 값 하나. 단일 비교.             (단일답 객관식, 단답 서술)
 *   set  — 순서 무관 집합. 완전일치.        (복수정답 multi_select)
 *   list — 순서 있는 리스트. 인덱스별 비교.  (다중빈칸 multi_blank)
 *
 * 셋 중 어디에도 안 떨어지면 null(판정 불가) → 호출부는 기권한다.
 * precision-first: 자신있는 오답이 기권보다 해롭다.
 */

export type Cardinality = 'one' | 'set' | 'list';

/**
 * answer_format 값. 채점은 이 이름이 아니라 toCardinality 결과로 분기하므로,
 * 아직 모르는 유형 이름이 저장돼 있어도 타입이 막지 않는다(표시·재현 전용).
 */
export type AnswerFormat = 'single' | 'multi' | 'multi_blank' | 'unknown' | (string & {});

/**
 * answer_format → cardinality.
 *
 * content.cardinality로 저장도 되지만(SQL 집계용) 읽지 않고 매번 도출한다 — 저장 시점의 매핑이
 * 굳는 걸 막기 위해서다. 'multi'는 저장 계약값, 'multi_select'는 모델·GT 라벨 어휘로 둘 다 쓰인다
 * (백엔드 answerSanitizers.js#isMultiSelectFmt와 같은 이유·같은 판정).
 */
export function toCardinality(fmt?: string | null): Cardinality | null {
  // 미설정 = 형식 개념 도입 전의 레거시 데이터. 그 시절 저장된 건 전부 단일답이다.
  if (fmt == null) return 'one';
  const f = String(fmt).trim();
  if (f === '' || f === 'single') return 'one';
  if (f === 'multi' || f === 'multi_select') return 'set';
  if (f === 'multi_blank') return 'list';
  return null; // 'unknown' 및 아직 모르는 값 — 판정하지 않는다
}
