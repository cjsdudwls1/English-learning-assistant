/**
 * PostgREST 임베디드 관계의 모양 방어.
 *
 * 2026-08-15 프로덕션 장애의 회귀 테스트다. labels 관계가 one-to-one으로 판정되면서
 * 임베드 응답이 배열에서 객체로 바뀌자, `rel?.[0]`으로 꺼내던 코드가 전부 undefined를
 * 받아 사용자 답안·정답·정오답이 화면에서 사라졌다. 쿼리도 RLS도 데이터도 정상이라
 * 에러 하나 없이 조용히 비었다 — 그래서 테스트로 못을 박는다.
 *
 * 핵심은 "지금 어느 모양이냐"가 아니라 "어느 쪽이 와도 같은 값을 읽어야 한다"이다.
 * DB 제약이 다시 바뀌어도 화면이 조용히 비지 않도록 양쪽을 모두 고정한다.
 */
import { describe, it, expect } from 'vitest';
import { unwrapEmbedded } from './postgrestEmbed';
import { calculateSessionStats } from './sessionStats';

describe('unwrapEmbedded — 임베디드 관계의 두 모양을 흡수', () => {
  it('one-to-many(배열)에서 첫 행을 꺼낸다', () => {
    expect(unwrapEmbedded([{ a: 1 }, { a: 2 }])).toEqual({ a: 1 });
  });

  it('one-to-one(객체)을 그대로 돌려준다 — 예전 `[0]` 접근이 무너지던 지점', () => {
    expect(unwrapEmbedded({ a: 1 })).toEqual({ a: 1 });
  });

  it('없음(null/undefined/빈 배열)은 undefined로 통일한다', () => {
    expect(unwrapEmbedded(null)).toBeUndefined();
    expect(unwrapEmbedded(undefined)).toBeUndefined();
    expect(unwrapEmbedded([])).toBeUndefined();
  });

  it('false·0 같은 falsy 값도 관계가 있으면 보존한다', () => {
    // `rel || {}` 식의 방어가 삼켜버리던 경우. is_correct=false가 미채점으로 둔갑하면 안 된다.
    expect(unwrapEmbedded([{ is_correct: false }])).toEqual({ is_correct: false });
    expect(unwrapEmbedded({ is_correct: false })).toEqual({ is_correct: false });
  });
});

describe('calculateSessionStats — 임베드 모양이 바뀌어도 집계가 같다', () => {
  // 같은 사실을 두 모양으로 표현한 입력. 결과가 갈리면 안 된다.
  const asArray = {
    problems: [
      { id: 'p1', labels: [{ user_mark: 'O' }] },
      { id: 'p2', labels: [{ user_mark: 'X' }] },
      { id: 'p3', labels: [] },
    ],
  };
  const asObject = {
    problems: [
      { id: 'p1', labels: { user_mark: 'O' } },
      { id: 'p2', labels: { user_mark: 'X' } },
      { id: 'p3', labels: null },
    ],
  };

  it('배열 모양(one-to-many)에서 정답·오답을 센다', () => {
    expect(calculateSessionStats(asArray)).toEqual({
      problem_count: 3,
      correct_count: 1,
      incorrect_count: 1,
    });
  });

  it('객체 모양(one-to-one)에서도 같은 값을 낸다', () => {
    // 회귀 전에는 객체의 .length가 undefined라 정답·오답이 모두 0으로 나왔다.
    expect(calculateSessionStats(asObject)).toEqual({
      problem_count: 3,
      correct_count: 1,
      incorrect_count: 1,
    });
  });

  it('두 모양의 집계 결과가 서로 같다', () => {
    expect(calculateSessionStats(asObject)).toEqual(calculateSessionStats(asArray));
  });
});
