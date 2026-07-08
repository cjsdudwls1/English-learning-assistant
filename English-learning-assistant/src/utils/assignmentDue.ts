/**
 * 과제 마감일 유틸.
 * due_date가 date-only('YYYY-MM-DD')로 저장되는 경우 new Date(str)는 UTC 자정으로 파싱되어
 * KST 등 동쪽 시간대에서 마감일 당일이 이미 지난 것으로 오판된다 → 로컬 23:59:59.999로 해석.
 */

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** 마감 시각(해당일의 로컬 하루 끝). 파싱 불가면 null */
export function dueDateEnd(dueDate: string | null | undefined): Date | null {
  if (!dueDate) return null;
  if (DATE_ONLY_RE.test(dueDate)) {
    const [y, m, d] = dueDate.split('-').map(Number);
    return new Date(y, m - 1, d, 23, 59, 59, 999);
  }
  const parsed = new Date(dueDate);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** 마감 초과 여부 — due_date 없거나 파싱 불가면 false(마감 없음 취급) */
export function isOverdue(dueDate: string | null | undefined): boolean {
  const end = dueDateEnd(dueDate);
  return end !== null && Date.now() > end.getTime();
}
