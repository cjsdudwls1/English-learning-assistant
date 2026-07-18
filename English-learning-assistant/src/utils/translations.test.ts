import { describe, it, expect } from 'vitest';
import { translations } from './translations';

// ko/en 구조 드리프트 방지 — 타입은 typeof ko지만 `as` 캐스트나 런타임 병합으로
// 깨질 수 있으므로 리프 키 경로의 완전 일치를 런타임에서도 고정한다.
function leafPaths(obj: Record<string, unknown>, prefix = ''): string[] {
  const paths: string[] = [];
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      paths.push(...leafPaths(value as Record<string, unknown>, path));
    } else {
      paths.push(path);
    }
  }
  return paths;
}

describe('translations ko/en 패리티', () => {
  it('ko와 en의 리프 키 경로가 완전히 일치한다', () => {
    const koPaths = leafPaths(translations.ko).sort();
    const enPaths = leafPaths(translations.en).sort();
    expect(enPaths).toEqual(koPaths);
  });

  it('모든 리프 값은 문자열/함수/배열이다 (undefined·null 누락 없음)', () => {
    for (const lang of ['ko', 'en'] as const) {
      const check = (obj: Record<string, unknown>, prefix: string) => {
        for (const [key, value] of Object.entries(obj)) {
          const path = `${prefix}.${key}`;
          if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
            check(value as Record<string, unknown>, path);
          } else {
            expect(['string', 'function'].includes(typeof value) || Array.isArray(value), `${path}의 값 타입이 비정상`).toBe(true);
          }
        }
      };
      check(translations[lang], lang);
    }
  });
});
