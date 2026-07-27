/**
 * cardinality 계약 (프론트) — 백엔드 cloud-functions/analyze-image/test/answerShape.test.mjs의 쌍둥이.
 *
 * 두 쪽 판정이 어긋나면: 백엔드가 채점한 것을 프론트가 '수동 확인'으로 덮는 건 무해하지만,
 * 백엔드가 기권한 것을 프론트가 자동 채점해버리면 confident-wrong(자신있는 오답)이 화면에 나온다.
 * 그래서 매핑과 기권 조건을 양쪽에서 같은 모양으로 고정한다.
 */
import { describe, it, expect } from 'vitest';
import { toCardinality } from './answerShape';
import { getManualReviewReason } from './gradingSafety';

describe('toCardinality — 값의 모양 매핑', () => {
  it('아는 형식은 세 모양 중 하나로 떨어진다', () => {
    // one — 형식 개념 도입 전 레거시(미기재)도 여기로
    expect(toCardinality(undefined)).toBe('one');
    expect(toCardinality(null)).toBe('one');
    expect(toCardinality('')).toBe('one');
    expect(toCardinality('single')).toBe('one');
    // set — 저장 계약값('multi')과 모델·GT 라벨 어휘('multi_select')가 공존한다
    expect(toCardinality('multi')).toBe('set');
    expect(toCardinality('multi_select')).toBe('set');
    // list
    expect(toCardinality('multi_blank')).toBe('list');
  });

  it('모르는 형식은 판정하지 않는다(null)', () => {
    expect(toCardinality('unknown')).toBeNull();
    expect(toCardinality('ordering')).toBeNull(); // 아직 없는 유형이 와도 코드 수정 없이 여기로
    expect(toCardinality('matching')).toBeNull();
  });
});

describe('getManualReviewReason — 모양으로 기권 판정', () => {
  it('모르는 형식은 자동 채점하지 않고 수동 확인으로 보낸다', () => {
    // 값만 보면 "3 === 3"이라 정답으로 보이지만, 순서·매칭 유형이라면 그 비교 자체가 성립하지 않는다.
    expect(getManualReviewReason({
      answerFormat: 'ordering', hasChoices: true, correctAnswer: '3', userAnswer: '3',
    })).toBe('형식확인');
    expect(getManualReviewReason({
      answerFormat: 'unknown', hasChoices: true, correctAnswer: '3', userAnswer: '3',
    })).toBe('형식확인');
  });

  it("multi_select로 저장된 복수정답도 복수로 인식한다", () => {
    // 예전엔 answerFormat === 'multi'만 봐서 모델 어휘 'multi_select'가 저장된 문항을 놓쳤다.
    // 그 결과 정답 2개짜리를 사용자가 하나만 골라도 단일 비교로 오답 단정(confident-wrong)했다.
    const args = { hasChoices: true, correctAnswer: '2, 4', userAnswer: '2' };
    expect(getManualReviewReason({ ...args, answerFormat: 'multi' })).toBe('복수정답');
    expect(getManualReviewReason({ ...args, answerFormat: 'multi_select' })).toBe('복수정답');
  });

  it('집합이 온전히 추출됐으면 자동 채점을 신뢰한다(백엔드 게이트와 동일)', () => {
    expect(getManualReviewReason({
      answerFormat: 'multi_select', hasChoices: true,
      correctAnswer: '2, 4', userAnswer: '2, 4',
      correctAnswers: [2, 4], userAnswers: [2, 4],
    })).toBeNull();
  });

  it('다중빈칸 서술형은 항상 수동 확인', () => {
    expect(getManualReviewReason({
      answerFormat: 'multi_blank', hasChoices: false, correctAnswer: 'apple', userAnswer: 'apple',
    })).toBe('형식확인');
  });

  it('단일답은 그대로 자동 채점 대상(기존 동작 유지)', () => {
    expect(getManualReviewReason({
      answerFormat: 'single', hasChoices: true, correctAnswer: '3', userAnswer: '3',
    })).toBeNull();
    // 레거시(형식 미기재)도 동일
    expect(getManualReviewReason({
      hasChoices: true, correctAnswer: '3', userAnswer: '3',
    })).toBeNull();
  });
});
