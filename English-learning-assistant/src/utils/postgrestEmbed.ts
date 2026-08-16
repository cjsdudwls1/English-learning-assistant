/**
 * PostgREST 임베디드 관계(`select('id, rel(...)')`)의 결과를 단일 객체로 편다.
 *
 * PostgREST는 관계의 cardinality에 따라 응답 모양을 바꾼다 — one-to-many면 배열,
 * one-to-one이면 객체다. 그런데 이 판정은 **DB 제약에서 자동으로 유도**되므로,
 * 컬럼에 UNIQUE를 걸거나 푸는 것만으로 API 응답 모양이 소리 없이 뒤집힌다.
 *
 * 실제로 그렇게 됐다: labels.problem_id가 one-to-one으로 판정되면서 problems→labels
 * 임베드가 배열에서 객체로 바뀌었고, `rel?.[0]`으로 꺼내던 코드가 전부 undefined를
 * 받았다. 쿼리도 RLS도 데이터도 멀쩡한데 화면의 사용자 답안·정답·정오답만 통째로
 * 사라졌다(2026-08-15 프로덕션 장애). 조인 실패는 에러를 내지만 이 경우는 조용하다.
 *
 * 그래서 양쪽 모양을 모두 받는다. 제약이 다시 바뀌어도 화면이 조용히 비지 않는다.
 * services/stats.ts가 problems 임베드에 인라인으로 쓰던 방어와 같은 방식이다.
 */
export function unwrapEmbedded<T>(rel: T | T[] | null | undefined): T | undefined {
  if (rel == null) return undefined;
  return Array.isArray(rel) ? rel[0] : rel;
}
