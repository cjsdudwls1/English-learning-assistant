import { test, expect, type Page } from '@playwright/test';
import { accounts, auditPages, login, password, waitForRenderSettled, type Role } from './helpers';

// 모바일 인체공학 점검 — "화면에 담기는 정보량"과 "읽고 누르기 편한가"를 실측한다.
//
// mobile-viewport.spec.ts와 역할이 다르다. 그쪽은 **밖으로 삐져나간 것**을 잡고,
// 이쪽은 **안에 들어는 왔지만 지나치게 큰 것**을 잡는다. 후자가 사용자가 실제로
// 호소한 문제다: 버튼이 너무 크고, 여백이 낭비되고, 한 화면에 정보가 적다.
//
// 정적 린트(src/mobileResponsive.test.ts)로는 여기 있는 것 중 어느 하나도 못 잡는다.
// 예: 달력 버튼이 py-3(≈40px)로 선언돼 있어도 그리드 행이 늘어나면 140px가 된다.
// 높이는 **계산된 결과**라 브라우저에서만 보인다. 그래서 이 파일이 따로 있다.

const VIEWPORTS = [
  { width: 390, height: 844 },
  { width: 360, height: 800 },
] as const;

const LIMITS = {
  /** 짧은 라벨 버튼이 이보다 높으면 화면을 낭비한다. 보통 버튼은 40~48px다. */
  tapHeightMax: 64,
  /** 라벨이 짧다고 볼 글자 수. 이보다 길면 높은 게 정상일 수 있다. */
  shortLabelChars: 12,
  /**
   * WCAG 2.2 최소 타깃(24px) — **회귀 방지선이지 설계 목표가 아니다.**
   * 이 코드베이스의 설계 기준은 그보다 크다: 단독 버튼 44px(`--btn-min-h`, iOS HIG),
   * 표·목록 안의 조밀한 컨트롤 40px(패딩+음수 마진으로 시각 크기는 그대로 두고 확보).
   * 여기를 40으로 올리지 않는 이유: 이 검사는 화면의 **모든** 클릭 요소를 훑기 때문에
   * 인라인 링크·배지처럼 정당하게 작은 요소까지 걸려 예외 목록이 검사보다 길어진다.
   * 44/40은 각 컴포넌트에서 지키고, 여기서는 "24px 밑으로 떨어졌다"는 명백한 회귀만 잡는다.
   */
  tapSizeMin: 24,
  /** 본문으로 볼 글자 수와, 그 본문에 허용하는 최대 글자 크기. */
  proseChars: 40,
  proseFontMax: 19,
  /** iOS는 16px 미만 입력창에 포커스하면 페이지를 자동 확대한다. 확대되면 레이아웃이 깨진다. */
  inputFontMin: 16,
  /** 상단바 위 여백과, 상단바~첫 콘텐츠 사이 여백의 상한. */
  topGapMax: 32,
  contentGapMax: 56,
  /** nav가 한 줄 링크 높이의 이 배를 넘으면 줄바꿈된 것으로 본다. */
  navWrapRatio: 1.6,
} as const;

async function collect(page: Page, path: string): Promise<string[]> {
  await page.goto(path);
  await waitForRenderSettled(page);
  try {
    return await measure(page);
  } catch (e) {
    // 인증 확정이 늦게 끝나면 그 시점에 라우트가 한 번 더 바뀐다. 측정 중에 그게 터지면
    // Playwright가 "Execution context was destroyed"로 죽는다 — 인체공학 위반이 아니라
    // **측정을 놓친 것**이다. 병렬 워커로 돌릴 때 같은 계정을 공유해 특히 잘 난다.
    // 위반으로 보고하면 거짓 실패고, 무시하면 그 화면을 아예 안 잰 게 된다. 그래서 다시 잰다.
    if (!String(e).includes('Execution context was destroyed')) throw e;
    await waitForRenderSettled(page);
    return await measure(page);
  }
}

function measure(page: Page): Promise<string[]> {
  return page.evaluate((L) => {
    const out: string[] = [];
    const vh = window.innerHeight;

    const visible = (el: Element) => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return false;
      const cs = getComputedStyle(el);
      return cs.visibility !== 'hidden' && cs.display !== 'none' && cs.opacity !== '0';
    };
    const name = (el: Element) => {
      const cls = typeof el.className === 'string'
        ? el.className.trim().split(/\s+/).slice(0, 4).join('.')
        : '';
      return `<${el.tagName.toLowerCase()}${cls ? `.${cls}` : ''}>`;
    };
    const text = (el: Element) => (el.textContent || '').replace(/\s+/g, ' ').trim();
    /** 자식이 아니라 **자기 자신**이 쓰는 글자만. 컨테이너가 중복 보고되는 걸 막는다. */
    const ownText = (el: Element) =>
      Array.from(el.childNodes)
        .filter((n) => n.nodeType === Node.TEXT_NODE)
        .map((n) => n.textContent || '')
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
    const hasFixedAncestor = (el: Element) => {
      let p: Element | null = el;
      while (p && p !== document.body) {
        const cs = getComputedStyle(p);
        if (cs.position === 'fixed' || p.getAttribute('role') === 'dialog') return true;
        p = p.parentElement;
      }
      return false;
    };

    // 1) 과대 탭 타깃 — 라벨은 짧은데 버튼만 큰 경우. 달력/기간 선택기가 여기서 걸린다.
    for (const el of Array.from(document.querySelectorAll('button, a, [role="button"]'))) {
      if (!visible(el)) continue;
      if (el.querySelector('img, canvas, video')) continue; // 썸네일 카드는 큰 게 정상
      const t = text(el);
      if (t.length > L.shortLabelChars) continue;
      const h = el.getBoundingClientRect().height;
      if (h > L.tapHeightMax) {
        out.push(`[과대탭] ${name(el)} "${t}" 높이 ${Math.round(h)}px (상한 ${L.tapHeightMax})`);
      }
    }

    // 2) 과소 탭 타깃 — 좁게 만든다고 눌리지 않을 만큼 줄인 경우(과잉 교정 방지).
    //    체크박스/라디오는 **연결된 label이 실제로 눌리는 영역**이다. 상자 자체를 24px로
    //    부풀리는 건 잘못된 수정이고(디자인이 뭉툭해진다), label에 여백을 주는 게 맞다.
    //    그래서 label이 있으면 label을 잰다.
    const tapRect = (el: Element) => {
      const t = el.getAttribute('type');
      if (el.tagName === 'INPUT' && (t === 'checkbox' || t === 'radio')) {
        const wrap = el.closest('label')
          || (el.id ? document.querySelector(`label[for="${CSS.escape(el.id)}"]`) : null);
        if (wrap) return wrap.getBoundingClientRect();
      }
      return el.getBoundingClientRect();
    };
    for (const el of Array.from(document.querySelectorAll(
      'button, [role="button"], select, input[type="checkbox"], input[type="radio"]'
    ))) {
      if (!visible(el)) continue;
      const r = tapRect(el);
      if (r.height < L.tapSizeMin || r.width < L.tapSizeMin) {
        out.push(`[과소탭] ${name(el)} "${text(el).slice(0, 20)}" `
          + `${Math.round(r.width)}x${Math.round(r.height)}px (최소 ${L.tapSizeMin})`);
      }
    }

    // 3) 본문 글자가 모바일에 과대 — 한 줄에 담기는 단어가 줄어 읽기가 불편해진다.
    for (const el of Array.from(document.querySelectorAll('body *'))) {
      if (!visible(el)) continue;
      const t = ownText(el);
      if (t.length < L.proseChars) continue;
      const fs = parseFloat(getComputedStyle(el).fontSize);
      if (fs > L.proseFontMax) {
        out.push(`[과대글자] ${name(el)} ${fs}px, ${t.length}자: "${t.slice(0, 40)}…"`);
      }
    }

    // 4) 입력창 16px 미만 — iOS 자동 확대 유발.
    for (const el of Array.from(document.querySelectorAll(
      'input:not([type="checkbox"]):not([type="radio"]):not([type="hidden"]), textarea, select'
    ))) {
      if (!visible(el)) continue;
      const fs = parseFloat(getComputedStyle(el).fontSize);
      if (fs < L.inputFontMin) {
        out.push(`[입력확대] ${name(el)} ${fs}px (iOS 자동확대 방지 최소 ${L.inputFontMin}px)`);
      }
    }

    // 5) 중첩 세로 스크롤 — 페이지 안의 작은 스크롤 감옥. 모바일에서 손가락이 갇힌다.
    //    모달(fixed/dialog) 내부 스크롤은 정상이므로 제외한다.
    for (const el of Array.from(document.querySelectorAll('body *'))) {
      if (!visible(el)) continue;
      const cs = getComputedStyle(el);
      if (cs.overflowY !== 'auto' && cs.overflowY !== 'scroll') continue;
      if (el.scrollHeight <= el.clientHeight + 8) continue; // 실제로 스크롤되지 않음
      if (el.clientHeight >= vh * 0.9) continue;            // 사실상 전체 화면
      if (hasFixedAncestor(el)) continue;
      out.push(`[스크롤감옥] ${name(el)} 보이는높이 ${el.clientHeight}px / 내용 ${el.scrollHeight}px`);
    }

    // 6) 상단 탭바가 접힘 — 세로 공간을 먹는다. 사용자가 스크린샷에서 지적한 지점.
    //    높이 비율만 보면 못 잡는다: flex 행에서는 한 링크의 글자가 두 줄이 되면 형제들도
    //    같이 늘어나 nav/링크 비율이 1로 유지된다. 그래서 (a) 링크가 놓인 줄 수와
    //    (b) 링크 **안쪽 글자**의 줄 수를 각각 실측한다.
    const nav = document.querySelector('header.topbar nav');
    if (nav && visible(nav)) {
      const links = Array.from(nav.children).filter(visible);
      if (links.length >= 2) {
        const rows = new Set(links.map((l) => Math.round(l.getBoundingClientRect().top / 4)));
        if (rows.size > 1) {
          out.push(`[탭바줄바꿈] 링크 ${links.length}개가 ${rows.size}줄로 배치됨 — 한 줄(가로 스크롤)로 만들 것`);
        }
        for (const l of links) {
          const node = Array.from(l.childNodes).find(
            (n) => n.nodeType === Node.TEXT_NODE && (n.textContent || '').trim()
          );
          if (!node) continue;
          const range = document.createRange();
          range.selectNodeContents(node);
          const lines = range.getClientRects().length;
          if (lines > 1) {
            out.push(`[탭바글자줄바꿈] "${(node.textContent || '').trim()}" 링크 글자가 ${lines}줄로 접힘`);
          }
        }
      }
    }

    // 7) 상단 죽은 여백 — 첫 화면에 정보가 적은 가장 큰 원인.
    const bar = document.querySelector('header.topbar');
    if (bar && visible(bar)) {
      const br = bar.getBoundingClientRect();
      if (br.top > L.topGapMax) {
        out.push(`[상단여백] 상단바가 ${Math.round(br.top)}px 아래에서 시작 (상한 ${L.topGapMax})`);
      }
      const after = Array.from(document.querySelectorAll('main *, .page-shell > div *'))
        .filter((el) => visible(el) && text(el).length > 0)
        .map((el) => el.getBoundingClientRect().top)
        .filter((top) => top >= br.bottom)
        .sort((a, b) => a - b)[0];
      if (after !== undefined && after - br.bottom > L.contentGapMax) {
        out.push(`[콘텐츠여백] 상단바~첫 콘텐츠 ${Math.round(after - br.bottom)}px (상한 ${L.contentGapMax})`);
      }
    }

    return out;
  }, LIMITS);
}

for (const viewport of VIEWPORTS) {
  test.describe(`모바일 인체공학 ${viewport.width}x${viewport.height}`, () => {
    test.use({ viewport: { ...viewport } });

    test('비로그인: 로그인 페이지', async ({ page }) => {
      const problems = await collect(page, '/');
      expect(problems, problems.join('\n')).toEqual([]);
    });

    for (const [role, pages] of Object.entries(auditPages) as Array<[Role, readonly string[]]>) {
      test.describe(role, () => {
        test.skip(!password, 'E2E_PASSWORD 환경변수가 필요합니다 (QA 시드 계정 비밀번호)');

        for (const path of pages) {
          test(`${role}: ${path}`, async ({ page }) => {
            await login(page, accounts[role]);
            const problems = await collect(page, path);
            expect(problems, problems.join('\n')).toEqual([]);
          });
        }
      });
    }

    // helpers의 auditPages에는 `:id` 라우트가 없다(데이터 의존이라 제외). 그런데 사용자가 가장
    // 먼저 지적한 화면이 바로 **문제 풀이**(`/assignments/:assignmentId`)다 — 정적 목록만 재면
    // 그 화면은 영원히 사각지대로 남는다. 그래서 목록에서 첫 과제 링크를 읽어 실제로 들어간다.
    //
    // auditPages에 넣지 않고 여기 둔 이유: 그 배열은 a11y·viewport 스펙도 함께 쓴다.
    // 이 스펙 하나 때문에 남의 스펙 대상까지 바꾸지 않는다.
    test.describe('student 동적 라우트', () => {
      test.skip(!password, 'E2E_PASSWORD 환경변수가 필요합니다 (QA 시드 계정 비밀번호)');

      test('student: /assignments/:id (문제 풀이)', async ({ page }) => {
        await login(page, accounts.student);
        await page.goto('/assignments');
        await waitForRenderSettled(page);

        // count()는 auto-wait을 하지 않는다. 위 waitForRenderSettled가 로딩 종료를 보장한 뒤에만
        // 세야 '과제 0건'이 오독이 아니다.
        const links = page.locator('a[href^="/assignments/"]');
        const found = await links.count();
        // 시드에 과제가 없는 건 이 스펙의 관심사가 아니다 — 실패가 아니라 skip으로 드러낸다.
        test.skip(found === 0, '학생 계정에 과제가 없어 풀이 화면을 열 수 없습니다');

        const href = await links.first().getAttribute('href');
        const problems = await collect(page, href!);
        expect(problems, problems.join('\n')).toEqual([]);
      });
    });
  });
}
