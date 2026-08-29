/**
 * 모바일 우선(mobile-first) 회귀 가드 — 소스의 Tailwind 클래스 문자열을 정적으로 검사한다.
 *
 * 왜 정적 검사인가: 이 저장소엔 React 컴포넌트 렌더 테스트 인프라가 없고(@testing-library 미설치),
 * Playwright 실측은 로그인 자격증명이 있어야 대부분의 화면에 닿는다. 그래서 CI에서 **자격증명 없이
 * 항상 도는** 1차 방어선을 여기에 둔다. 실측(e2e/mobile-ergonomics.spec.ts)이 2차 방어선이다.
 *
 * 규칙은 전부 "**접두사 없는** 유틸리티"만 잡는다. Tailwind에서 접두사 없는 값은 모든 폭에 적용되므로
 * 곧 모바일 값이다. `text-xl sm:text-4xl`은 정상, `text-4xl`은 위반이다.
 *
 * 2026-08-29 모바일 최적화 작업 시점 기준선: 위반 51건(과대여백 38·중첩스크롤 9·과대글자 3·과대높이 1).
 * 그 작업으로 정리한 뒤 0을 유지하는 것이 이 테스트의 목적이다.
 *
 * `탭타깃-해제누락`은 그 작업 **직후**에 추가했다. 정리 과정에서 터치 바닥값(min-h 40·44px)을
 * 88군데 넣었는데, 초안에서는 상당수가 `sm:` 해제 없이 들어가 마우스 환경의 표·목록 행까지
 * 부풀렸다 — 사용자가 처음 지적한 "버튼이 지나치게 크다"를 반대 방향으로 재현한 셈이다.
 * 기존 `과대-고정높이` 규칙은 120px 초과만 보므로 44px를 통과시켜 이걸 못 잡았다.
 *
 * 새 위반이 잡혔는데 **의도된 예외**라면, 지우지 말고 ALLOWLIST에 이유와 함께 등록하라.
 * 예외를 남기는 편이 규칙을 느슨하게 푸는 것보다 낫다 — 다음 사람이 이유를 읽을 수 있다.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = path.dirname(fileURLToPath(import.meta.url));

/** 의도된 예외. `파일:규칙` 키에 이유를 적는다. 이유 없는 항목은 추가하지 말 것. */
const ALLOWLIST: Record<string, string> = {
  // 예) 'components/Foo.tsx:과대-여백': '전체화면 모달이라 모바일에서도 넓은 패딩이 맞다',

  // 아래 둘은 `fixed inset-0` 오버레이 **안쪽** 패널이다. max-h를 풀면 패널이 화면 밖으로
  // 자라 오버레이 자체가 깨진다. 모달 내부 스크롤은 모바일에서도 정상 패턴이므로 예외다.
  // (규칙이 잡으려는 건 **페이지 흐름 안**에 박힌 스크롤 감옥이다.)
  'components/StatsExampleModal.tsx:중첩세로스크롤': '모달 패널 max-h-[85vh] — 오버레이 안쪽 스크롤은 정상',
  'components/TaxonomyDetailPopup.tsx:중첩세로스크롤': '모달 패널 max-h-[90vh] — 오버레이 안쪽 스크롤은 정상',
};

function collectTsx(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === 'node_modules' || name === '__snapshots__') continue;
      collectTsx(full, out);
      continue;
    }
    if (name.endsWith('.tsx') && !/\.(test|spec)\.tsx$/.test(name)) out.push(full);
  }
  return out;
}

/** 접두사(sm:/md:/lg:/dark:/hover: …) 없이 쓰인 유틸리티만 매치한다. */
const bare = (body: string) => new RegExp(`(?<![\\w:-])(?:${body})(?![\\w-])`, 'g');

interface Rule {
  id: string;
  hint: string;
  re?: RegExp;
  keep?: (m: RegExpExecArray) => boolean;
  custom?: (src: string) => number[];
  /** custom 규칙이 보고서에 찍을 위반 요약. custom을 쓰면 반드시 같이 준다. */
  label?: string;
}

const RULES: Rule[] = [
  {
    id: '과대-본문글자',
    hint: 'text-3xl 이상이 모바일에 그대로 적용된다 → `text-xl sm:text-3xl`',
    re: bare('text-(?:3xl|4xl|5xl|6xl|7xl|8xl|9xl)'),
  },
  {
    id: '과대-여백',
    hint: 'p-8 이상 패딩/간격이 모바일에 그대로 적용된다 → `p-3 sm:p-8`',
    re: bare('(?:p|px|py|pt|pb|gap|space-y|space-x)-(?:8|10|12|14|16|20|24)'),
  },
  {
    id: '과대-고정높이',
    hint: '120px 넘는 고정 높이가 모바일에 그대로 적용된다 → sm: 뒤로 미루거나 값을 줄인다',
    re: /(?<![\w:-])(?:h|min-h)-\[(\d{3,})px\]/g,
    keep: (m) => Number(m[1]) > 120,
  },
  {
    id: '탭타깃-해제누락',
    hint: '모바일 탭타깃(min-h/min-w 40·44px)에 `sm:` 해제가 없다. 마우스 환경까지 바닥값이 걸려 '
      + '표·목록 행이 통째로 부풀고, 한 화면에 담기는 정보가 줄어든다 '
      + '→ `min-h-[40px] sm:min-h-0`. 행 높이를 못 키우는 조밀 컨트롤이면 바닥값 대신 '
      + '히트영역만 넓혀라(`p-2.5 -m-2.5` 또는 `relative before:absolute before:-inset-2`).',
    label: 'min-h/min-w 바닥값 + sm: 해제 없음',
    custom: (src) => {
      // 이 규칙이 지키는 불변식: 저장소 안 40·44px 바닥값 **85개 전부**가 `sm:` 해제와 짝지어져 있다.
      // 짝 없는 바닥값이 하나라도 생기면 그게 회귀다. (기존 `과대-고정높이` 규칙은 120px 초과만
      // 잡아서 44px가 그냥 통과한다 — 사용자가 실제로 겪은 "버튼이 지나치게 크다"를 못 막았다.)
      const hits: number[] = [];
      const re = /className=\{?[`"']([\s\S]{0,900}?)[`"']\}?/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(src))) {
        const cls = m[1];
        for (const axis of ['h', 'w'] as const) {
          const floor = new RegExp(`(?<![\\w:-])min-${axis}-\\[(?:40|44)px\\]`);
          if (!floor.test(cls)) continue;
          if (new RegExp(`sm:min-${axis}-`).test(cls)) continue;
          // 음수 마진·의사요소 확장은 **시각 크기를 안 키우는** 대안이므로 해제가 필요 없다.
          if (/(?:^|\s)-m[xytblr]?-|before:-inset|before:absolute/.test(cls)) continue;
          hits.push(m.index);
          break;
        }
      }
      return hits;
    },
  },
  {
    id: '중첩세로스크롤',
    hint: '페이지 안 세로 스크롤 감옥(max-h + overflow-y-auto)이 모바일에 그대로 적용된다 '
      + '→ `max-h-none sm:max-h-96`. 모달 내부 스크롤은 예외이니 ALLOWLIST에 등록하라',
    label: 'max-h + overflow-y-auto',
    custom: (src) => {
      const hits: number[] = [];
      const re = /className=\{?["'`]([^"'`]{0,600})["'`]/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(src))) {
        const cls = m[1];
        const hasScroll = /(?<![\w:-])overflow-(?:y-)?(?:auto|scroll)(?![\w-])/.test(cls);
        const hasBareMaxH = /(?<![\w:-])max-h-(?!none)[\w[\]./-]+/.test(cls);
        if (hasScroll && hasBareMaxH) hits.push(m.index);
      }
      return hits;
    },
  },
];

const lineOf = (src: string, idx: number) => src.slice(0, idx).split('\n').length;

describe('모바일 우선 클래스 규칙', () => {
  const files = collectTsx(SRC);

  it('검사 대상 .tsx를 실제로 찾는다', () => {
    // 경로 리팩터링으로 대상이 0개가 되면 이 테스트가 조용히 무력해진다. 그 상태를 실패로 만든다.
    expect(files.length).toBeGreaterThan(50);
  });

  it('접두사 없는 과대 스타일이 없다', () => {
    const violations: string[] = [];

    for (const full of files) {
      const rel = path.relative(SRC, full).replace(/\\/g, '/');
      const src = readFileSync(full, 'utf8');

      for (const rule of RULES) {
        const hits: Array<{ line: number; text: string }> = [];

        if (rule.custom) {
          const label = rule.label ?? rule.id;
          for (const idx of rule.custom(src)) hits.push({ line: lineOf(src, idx), text: label });
        } else if (rule.re) {
          rule.re.lastIndex = 0;
          let m: RegExpExecArray | null;
          while ((m = rule.re.exec(src))) {
            if (rule.keep && !rule.keep(m)) continue;
            hits.push({ line: lineOf(src, m.index), text: m[0] });
          }
        }

        if (!hits.length) continue;
        if (ALLOWLIST[`${rel}:${rule.id}`]) continue;
        for (const h of hits) {
          violations.push(`${rel}:${h.line}  [${rule.id}] ${h.text}\n      → ${rule.hint}`);
        }
      }
    }

    expect(violations, `\n${violations.join('\n')}\n`).toEqual([]);
  });
});
