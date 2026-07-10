import { describe, it, expect } from 'vitest';
import { addToStatsMap, type StatsNode } from './stats';

// 채점 계약: graded 판정은 typeof is_correct === 'boolean' 단일 기준.
// user_mark는 채점 근거가 아니다 — 분석 파이프라인은 user_mark 없이 is_correct를 채점한다.

function makeRow(isCorrect: boolean | null, userMark: string | null, sessionId = 's1') {
  return {
    classification: {},
    is_correct: isCorrect,
    user_mark: userMark,
    problems: { session_id: sessionId },
  };
}

describe('addToStatsMap — graded 판정 계약', () => {
  it('AI 채점 라벨(user_mark null + is_correct boolean)을 집계에 포함한다', () => {
    const map = new Map<string, StatsNode>();
    addToStatsMap(map, makeRow(true, null), '문법', '문법');
    addToStatsMap(map, makeRow(false, null), '문법', '문법');
    const node = map.get('문법')!;
    expect(node.total_count).toBe(2);
    expect(node.correct_count).toBe(1);
    expect(node.incorrect_count).toBe(1);
  });

  it('사용자 수동 채점 라벨(user_mark 있음)도 동일하게 포함한다', () => {
    const map = new Map<string, StatsNode>();
    addToStatsMap(map, makeRow(true, 'O'), '독해', '독해');
    expect(map.get('독해')!.total_count).toBe(1);
  });

  it('미채점(is_correct null)은 user_mark 유무와 무관하게 카운트하지 않는다', () => {
    const map = new Map<string, StatsNode>();
    addToStatsMap(map, makeRow(null, null), '어휘', '어휘');
    addToStatsMap(map, makeRow(null, '?'), '어휘', '어휘');
    const node = map.get('어휘')!;
    expect(node.total_count).toBe(0);
    expect(node.correct_count).toBe(0);
    expect(node.incorrect_count).toBe(0);
  });

  it('correct + incorrect === total 불변식을 유지한다', () => {
    const map = new Map<string, StatsNode>();
    addToStatsMap(map, makeRow(true, null), '문법', '문법');
    addToStatsMap(map, makeRow(false, 'X'), '문법', '문법');
    addToStatsMap(map, makeRow(null, null), '문법', '문법');
    const node = map.get('문법')!;
    expect(node.correct_count + node.incorrect_count).toBe(node.total_count);
  });

  it('같은 세션의 행이 여러 개여도 sessionIds는 중복 없이 쌓인다', () => {
    const map = new Map<string, StatsNode>();
    addToStatsMap(map, makeRow(true, null, 's1'), '문법', '문법');
    addToStatsMap(map, makeRow(false, null, 's1'), '문법', '문법');
    addToStatsMap(map, makeRow(true, null, 's2'), '문법', '문법');
    expect(map.get('문법')!.sessionIds).toEqual(['s1', 's2']);
  });
});
