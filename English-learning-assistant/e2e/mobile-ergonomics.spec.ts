import { test, expect, type Page } from '@playwright/test';
import { accounts, auditRoutes, login, password, resolveAuditPath, waitForRenderSettled, type AuditRoute, type Role } from './helpers';

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
  /** 클리핑 판정 여유. 서브픽셀·보더 반올림으로 1~2px는 늘 뜬다. */
  clipTolerance: 2,
  /** 압착 판정에 쓸 최소 글자 수. 이보다 짧으면 두 줄이어도 의미가 없다. */
  crampMinChars: 5,
  /**
   * 이 폭보다 좁은 칼럼에서 글자가 접히면 압착 후보로 본다.
   * 360px 화면에서 2단 그리드 칼럼이 약 160px, 3단이 약 104px다.
   */
  crampWidthMin: 120,
  /**
   * 후보 중 **실패로 세울** 줄 수. 실측으로 정했다.
   * 처음엔 "좁은 칼럼에서 2줄이면 실패"로 뒀더니 멀쩡한 화면이 무더기로 걸렸다:
   *   '데이터 없음'(39px, 2줄) · '누적 정답률 13% (채점 8건)'(85px, 2줄) ·
   *   '🔄 전체 문제 재분류'(115px, 2줄) — 전부 정상적인 배지·버튼 줄바꿈이다.
   * 좁은 칼럼에서 2줄은 흔하고, 4줄부터는 칼럼이 실제로 무너진 것이다.
   * 제목(h1~h6)만은 예외로 2줄에서 잡는다 — 원래 사고가 h3 'AI 분석 완/료'였다.
   */
  crampLinesMin: 4,
} as const;

async function collect(page: Page, path: string): Promise<string[]> {
  await page.goto(path);
  await waitForRenderSettled(page);
  const { problems, notes } = await measureWithRetry(page);
  for (const n of notes) console.log(`[ergonomics][note] ${path}: ${n}`);
  return problems;
}

async function measureWithRetry(page: Page): Promise<Measurement> {
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

interface Measurement {
  /** 실패로 세우는 위반. */
  problems: string[];
  /** 실패는 아니지만 임계 조정에 쓰려고 남기는 관측. */
  notes: string[];
}

function measure(page: Page): Promise<Measurement> {
  return page.evaluate((L) => {
    const out: string[] = [];
    const notes: string[] = [];
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

    // 8) 클리핑 — overflow-hidden 컨테이너 안에서 내용이 잘려 나감.
    //    mobile-viewport.spec.ts가 못 잡는 사각지대다. 그쪽은 "조상이 클리핑하면 의도된 것"으로
    //    면제하는데, 잘린 내용은 페이지를 가로 스크롤시키지 않으므로 검사가 통째로 무력화된다.
    //    실제로 카드(rounded-2xl overflow-hidden) 안의 긴 '-----'가 이 구멍으로 빠져나갔다.
    //    hidden/clip만 본다 — auto/scroll은 사용자가 스크롤해서 닿을 수 있으니 손실이 아니다.
    //    truncate(text-overflow:ellipsis)는 **의도된** 생략이므로 제외한다.
    for (const el of Array.from(document.querySelectorAll('body *'))) {
      if (!visible(el)) continue;
      const cs = getComputedStyle(el);
      if (cs.overflowX !== 'hidden' && cs.overflowX !== 'clip') continue;
      if (cs.textOverflow === 'ellipsis') continue;
      if (el.clientWidth === 0) continue; // 레이아웃 박스가 없는 요소(inline 등)
      // input/textarea/select는 값이 상자보다 길면 언제나 scrollWidth가 넘친다.
      // 캐럿을 움직이면 브라우저가 알아서 스크롤해 주므로 손실이 아니다 —
      // 실제로 /edit의 정답 입력칸(내용 146px / 폭 140px)이 여기서 거짓 실패를 냈다.
      if (el.matches('input, textarea, select')) continue;
      const lost = el.scrollWidth - el.clientWidth;
      if (lost > L.clipTolerance) {
        // "안에 있는 무언가가 넓다"만으론 고칠 수가 없다. 실제로 오른쪽 경계를 넘은
        // 가장 얕은 자손을 함께 지목한다 — 그게 폭을 정한 범인이다.
        const edge = el.getBoundingClientRect().left + el.clientWidth;
        let culprit = '';
        for (const d of Array.from(el.querySelectorAll('*'))) {
          const dr = d.getBoundingClientRect();
          if (dr.width === 0 || dr.height === 0) continue;
          if (dr.right <= edge + L.clipTolerance) continue;
          const pr = d.parentElement?.getBoundingClientRect();
          if (pr && pr.right > edge + L.clipTolerance) continue; // 부모가 이미 범인
          culprit = ` ← ${name(d)} right=${Math.round(dr.right)} (경계 ${Math.round(edge)})`;
          break;
        }
        out.push(`[클리핑] ${name(el)} 가로 ${lost}px가 잘려 보이지 않음 `
          + `(내용 ${el.scrollWidth}px / 보이는 폭 ${el.clientWidth}px)${culprit}: "${text(el).slice(0, 40)}…"`);
      }
    }

    // 9) 글자 압착 — 칼럼이 너무 좁아 짧은 글자가 여러 줄로 쪼개짐.
    //    "AI 분석 완 / 료"처럼 제목이 두 동강 나는 증상. 밖으로 나가지도, 잘리지도 않으므로
    //    1~8번 어느 검사에도 안 걸린다. 사용자가 폰에서 두 번째로 지적한 문제다.
    //    Range.getClientRects()로 **실제 줄 수와 줄 폭**을 잰다(line-height 추정 불필요).
    //    폭 기준을 함께 쓰는 이유: 긴 문단이 좁은 화면에서 여러 줄이 되는 건 정상이다.
    //    좁은 칼럼(<clampWidthMin) 안에서 두 줄 이상 접힌 것만 이상으로 본다.
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const raw = (node.textContent || '').replace(/\s+/g, ' ').trim();
      if (raw.length < L.crampMinChars) continue;
      const parent = node.parentElement;
      if (!parent || !visible(parent)) continue;
      if (parent.closest('script, style, svg')) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      const rects = Array.from(range.getClientRects()).filter((r) => r.width > 0 && r.height > 0);
      if (rects.length < 2) continue;
      const widest = Math.max(...rects.map((r) => r.width));
      if (widest >= L.crampWidthMin) continue;

      const isHeading = /^h[1-6]$/.test(parent.tagName.toLowerCase())
        || parent.getAttribute('role') === 'heading';
      const line = `${name(parent)} "${raw.slice(0, 30)}" 폭 ${Math.round(widest)}px · ${rects.length}줄`
        + ` (글자 ${Math.round(parseFloat(getComputedStyle(parent).fontSize))}px)`;
      if (isHeading || rects.length >= L.crampLinesMin) {
        out.push(`[글자압착] ${line}`);
      } else {
        // 좁은 칼럼의 2~3줄은 배지·버튼에서 흔하다. 실패로 세우지 않고 기록만 남긴다 —
        // 임계를 다시 조일 때 쓸 실측 자료다.
        notes.push(`[좁은칼럼] ${line}`);
      }
    }

    return { problems: out, notes };
  }, LIMITS);
}

for (const viewport of VIEWPORTS) {
  test.describe(`모바일 인체공학 ${viewport.width}x${viewport.height}`, () => {
    test.use({ viewport: { ...viewport } });

    test('비로그인: 로그인 페이지', async ({ page }) => {
      const problems = await collect(page, '/');
      expect(problems, problems.join('\n')).toEqual([]);
    });

    // 정적·파라미터 라우트를 가리지 않고 helpers.auditRoutes 전수를 돈다.
    // (예전에는 `/assignments/:id`만 이 파일에 따로 박아 뒀었다. 이제는 목록이 한 곳이라
    //  라우트를 추가하면 a11y·viewport·screen-health 검사가 함께 붙는다.)
    for (const [role, routes] of Object.entries(auditRoutes) as Array<[Role, readonly AuditRoute[]]>) {
      test.describe(role, () => {
        test.skip(!password, 'E2E_PASSWORD 환경변수가 필요합니다 (QA 시드 계정 비밀번호)');

        for (const route of routes) {
          test(`${role}: ${route.label}`, async ({ page }) => {
            await login(page, accounts[role]);
            const path = await resolveAuditPath(page, route);
            test.skip(!path, `시드에 데이터가 없어 ${route.label}을(를) 열 수 없습니다`);
            const problems = await collect(page, path!);
            expect(problems, problems.join('\n')).toEqual([]);
          });
        }
      });
    }
  });
}
