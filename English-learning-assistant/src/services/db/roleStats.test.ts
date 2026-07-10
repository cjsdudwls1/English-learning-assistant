import { describe, it, expect } from 'vitest';
import { aggregateByMonth, aggregateByDay, type StatsRow } from './roleStats';

// 채점 계약: is_correct null(미채점·보류)은 오답으로 위조하지 않고 집계에서 제외,
// time null(labels 경로)은 평균 시간 분모에서 제외.

function row(date: string, is_correct: boolean | null, time: number | null = null): StatsRow {
  return { date, is_correct, time };
}

describe('aggregateByMonth', () => {
  it('미채점(is_correct null)은 total에 포함하지 않는다', () => {
    const result = aggregateByMonth([
      row('2026-03-10T03:00:00Z', true),
      row('2026-03-11T03:00:00Z', null),
      row('2026-03-12T03:00:00Z', false),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].month).toBe(3);
    expect(result[0].total_count).toBe(2);
    expect(result[0].correct_count).toBe(1);
    expect(result[0].incorrect_count).toBe(1);
  });

  it('미채점 행만 있는 달은 버킷 자체가 생기지 않는다', () => {
    const result = aggregateByMonth([row('2026-05-01T03:00:00Z', null)]);
    expect(result).toHaveLength(0);
  });

  it('correct + incorrect === total 불변식을 유지한다', () => {
    const rows: StatsRow[] = [
      row('2026-06-01T03:00:00Z', true),
      row('2026-06-02T03:00:00Z', true),
      row('2026-06-03T03:00:00Z', false),
      row('2026-06-04T03:00:00Z', null),
    ];
    const [june] = aggregateByMonth(rows);
    expect(june.correct_count + june.incorrect_count).toBe(june.total_count);
  });

  it('평균 시간은 time이 있는 행만 분모로 삼는다 (labels의 time null이 평균을 희석하지 않음)', () => {
    const [m] = aggregateByMonth([
      row('2026-07-01T03:00:00Z', true, 30),
      row('2026-07-02T03:00:00Z', false, null), // labels 경로: 시간 정보 없음
      row('2026-07-03T03:00:00Z', true, 14),
    ]);
    expect(m.total_count).toBe(3);
    expect(m.timed_count).toBe(2);
    expect(m.avg_time_seconds).toBe(22); // (30+14)/2, null 포함 (30+14)/3=15가 아님
  });

  it('시간 정보가 전혀 없으면 avg_time_seconds는 0', () => {
    const [m] = aggregateByMonth([row('2026-07-01T03:00:00Z', true, null)]);
    expect(m.avg_time_seconds).toBe(0);
    expect(m.timed_count).toBe(0);
  });

  it('월 오름차순으로 정렬해 반환한다', () => {
    const result = aggregateByMonth([
      row('2026-06-01T03:00:00Z', true),
      row('2026-03-01T03:00:00Z', false),
      row('2026-07-01T03:00:00Z', true),
    ]);
    expect(result.map((m) => m.month)).toEqual([3, 6, 7]);
  });
});

describe('aggregateByDay', () => {
  it('로컬 달력 날짜로 버킷팅한다 (UTC slice면 동부 시간대에서 저녁 풀이가 전날/다음날로 밀림)', () => {
    // 로컬 2026-07-10 00:30 — UTC 문자열로 넘겨도 로컬 날짜 키는 2026-07-10이어야 한다
    const local = new Date(2026, 6, 10, 0, 30);
    const [d] = aggregateByDay([row(local.toISOString(), true)]);
    expect(d.date).toBe('2026-07-10');
  });

  it('미채점 제외·시간 분모 규칙이 일별에도 동일 적용된다', () => {
    const base = new Date(2026, 6, 10, 12, 0).toISOString();
    const [d] = aggregateByDay([
      row(base, true, 10),
      row(base, null, 99), // 미채점은 시간이 있어도 통째로 제외
      row(base, false, null),
    ]);
    expect(d.total_count).toBe(2);
    expect(d.timed_count).toBe(1);
    expect(d.avg_time_seconds).toBe(10);
  });

  it('날짜 오름차순으로 정렬해 반환한다', () => {
    const d1 = new Date(2026, 6, 11, 12, 0).toISOString();
    const d2 = new Date(2026, 6, 9, 12, 0).toISOString();
    const result = aggregateByDay([row(d1, true), row(d2, false)]);
    expect(result.map((r) => r.date)).toEqual(['2026-07-09', '2026-07-11']);
  });
});
