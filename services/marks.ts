export type NormalizedMark = 'O' | 'X';

// 다양한 형태의 마킹 값을 일관된 'O' 또는 'X'로 정규화
export function normalizeMark(raw: unknown): NormalizedMark {
  if (raw === undefined || raw === null) return 'X';
  const value = String(raw).trim().toLowerCase();

  // 정답 케이스
  const truthy = new Set([
    'o', '✓', 'v', 'correct', 'true', '정답', '맞음', 'ok', '⭕', 'circle', 'check', 'checkmark'
  ]);
  if (truthy.has(value)) return 'O';

  // 오답/기타는 전부 X 처리 (요구사항: 모든 문항을 O/X로 강제)
  return 'X';
}

export function isCorrectFromMark(raw: unknown): boolean {
  return normalizeMark(raw) === 'O';
}


