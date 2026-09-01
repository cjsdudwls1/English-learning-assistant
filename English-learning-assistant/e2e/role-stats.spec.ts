import { test, expect, type Page } from './fixtures';
import { accounts, login, password, waitForRenderSettled } from './helpers';

// 역할별 통계 화면의 내부 정합성.
//
// assignment-flow.spec.ts가 "내가 만든 데이터가 통계에 제대로 반영되는가"를 본다면,
// 여기서는 시드 데이터가 무엇이든 항상 성립해야 하는 항등식을 본다.
// 절대값을 기대하지 않으므로 시드가 바뀌어도 깨지지 않고, 집계 로직이 틀어지면 잡힌다.

// 라벨 <p> 바로 다음 <p>의 숫자 (director OverviewStat 구조)
async function statValue(page: Page, label: RegExp): Promise<number> {
  const text = await page
    .locator('p')
    .filter({ hasText: label })
    .first()
    .locator('xpath=following-sibling::p[1]')
    .innerText();
  return Number(text.match(/\d+/)?.[0]);
}

test.describe('역할별 통계 정합성', () => {
  test.skip(!password, 'E2E_PASSWORD 환경변수가 필요합니다 (QA 시드 계정 비밀번호)');
  test.setTimeout(120_000);

  test('student: 전체 = 정답 + 오답 + 미채점, 그리고 등록 + 과제·생성', async ({ page }) => {
    await login(page, accounts.student);
    await page.goto('/stats');
    await waitForRenderSettled(page, { quietMs: 1_500, maxMs: 25_000 });

    const body = await page.locator('body').innerText();

    const summary = body.match(
      /(?:전체|Total):\s*(\d+)\s*\/\s*(?:정답|Correct):\s*(\d+)\s*\/\s*(?:오답|Incorrect):\s*(\d+)\s*\/\s*(?:미채점|Ungraded):\s*(\d+)/,
    );
    expect(summary, '유형별 통계 요약 줄을 찾지 못했다').not.toBeNull();
    const [, total, correct, incorrect, ungraded] = summary!.map(Number);
    expect(correct + incorrect + ungraded, '전체 문항 수가 정답+오답+미채점과 다르다').toBe(total);

    // 보조 줄은 total > 0일 때만 렌더된다.
    if (total > 0) {
      const breakdown =
        body.match(/등록 문제 (\d+) \(채점완료 (\d+) \/ 미채점 (\d+)\) \+ 과제·생성 풀이 (\d+)/) ??
        body.match(/(\d+) registered \((\d+) graded \/ (\d+) ungraded\) \+ (\d+) assignment\/generated solves/);
      expect(breakdown, '통계 출처 분해 줄을 찾지 못했다').not.toBeNull();
      const [, registered, regGraded, regUngraded, gen] = breakdown!.map(Number);
      expect(registered + gen, '등록 문제 + 과제·생성 풀이가 전체와 다르다').toBe(total);
      expect(regGraded + regUngraded, '등록 문제의 채점완료 + 미채점이 등록 수와 다르다').toBe(registered);
    }
  });

  // 통계는 무거운 질의 6개를 병렬로 던진다. 예전엔 /stats에 들어올 때마다 전체 화면이
  // '불러오는 중...'으로 덮여서, 탭을 오갈 때마다 1~3초를 다시 기다려야 했다.
  // useStatsData가 직전 스냅샷을 모듈 캐시에 들고 있다가 즉시 그리도록 바꿨다(stale-while-revalidate).
  // 이 테스트는 그 캐시가 죽었는지를 본다 — 재방문 직후 로딩 문구가 보이면 회귀다.
  //
  // 반드시 **상단바 링크를 클릭**해서 이동한다. page.goto는 전체 리로드라 모듈 캐시가
  // 통째로 날아가고, 그러면 캐시가 멀쩡해도 항상 로딩이 떠서 테스트가 무의미해진다.
  test('student: /stats 재방문 시 로딩 화면이 다시 뜨지 않는다', async ({ page }) => {
    await login(page, accounts.student);
    const stats = page.locator('header.topbar a[href="/stats"]');
    const problems = page.locator('header.topbar a[href="/problems"]');

    await stats.click();
    await page.waitForURL('**/stats');
    await waitForRenderSettled(page, { quietMs: 1_500, maxMs: 25_000 });

    await problems.click();
    await page.waitForURL('**/problems');
    await waitForRenderSettled(page);

    await stats.click();
    await page.waitForURL('**/stats');

    // waitForRenderSettled를 쓰면 로딩이 끝날 때까지 기다려 버려 의미가 없다.
    // 복귀 직후의 프레임들을 그대로 훑는다.
    const seen: string[] = [];
    for (let i = 0; i < 12; i += 1) {
      seen.push(await page.evaluate(() => document.body.innerText));
      await page.waitForTimeout(100);
    }
    // 이 화면엔 '불러오는 중' 문구가 여러 개다(전체 화면 로딩, 컨설팅 이력, 택사노미 통계…).
    // 어느 것이 떴는지 모르면 캐시 회귀인지 무관한 부분 로딩인지 구분할 수 없으므로
    // 매칭된 줄을 그대로 남긴다.
    const hits = new Set<string>();
    for (const frame of seen) {
      for (const line of frame.split('\n')) {
        if (/불러오는 중|Loading/.test(line)) hits.add(line.trim());
      }
    }
    expect(
      [...hits],
      `재방문인데 로딩 문구가 다시 떴다 — 잡힌 문구: ${JSON.stringify([...hits])}`
    ).toEqual([]);
  });

  test('parent: 자녀 과제의 정답+오답+미채점이 완료 문항 수와 같다', async ({ page }) => {
    await login(page, accounts.parent);
    await page.goto('/parent/dashboard');
    await waitForRenderSettled(page, { quietMs: 1_500, maxMs: 25_000 });

    const rows = page.getByTestId('child-assignment-row');
    const count = await rows.count();
    test.skip(count === 0, '학부모 계정의 자녀에게 과제가 없어 검증할 대상이 없다');

    let checked = 0;
    for (let i = 0; i < count; i++) {
      const text = await rows.nth(i).innerText();
      const done = text.match(/(\d+)\s*\/\s*(\d+)\s*(?:완료|completed)/);
      // 채점 요약은 응답이 1건 이상일 때만 렌더된다 (ChildAssignmentsCard의 hasResponses)
      const graded = text.match(
        /(?:정답|Correct)\s*(\d+)\s*·\s*(?:오답|Wrong)\s*(\d+)\s*·\s*(?:미채점|Ungraded)\s*(\d+)/,
      );
      expect(done, `${i + 1}번째 과제에서 완료 표기를 찾지 못했다`).not.toBeNull();
      if (!graded) {
        expect(Number(done![1]), '응답이 있는데 채점 요약이 없다').toBe(0);
        continue;
      }
      const sum = Number(graded[1]) + Number(graded[2]) + Number(graded[3]);
      expect(sum, `${i + 1}번째 과제의 정답+오답+미채점이 완료 문항 수와 다르다`).toBe(Number(done![1]));
      checked++;
    }
    expect(checked, '채점 요약이 있는 과제가 하나도 없어 검증하지 못했다').toBeGreaterThan(0);
  });

  test('director: 학원 개요가 교사별 실적 표와 모순되지 않는다', async ({ page }) => {
    await login(page, accounts.director);
    await page.goto('/director/dashboard');
    await waitForRenderSettled(page, { quietMs: 1_500, maxMs: 25_000 });

    const totalResponses = await statValue(page, /^(전체 응답|Total Responses)$/);
    const ungradedResponses = await statValue(page, /^(미채점 응답|Ungraded Responses)$/);
    const accuracy = await statValue(page, /^(전체 정답률|Overall Accuracy)$/);
    expect(ungradedResponses, '미채점 응답이 전체 응답보다 많다').toBeLessThanOrEqual(totalResponses);
    expect(accuracy, '전체 정답률이 0~100 범위를 벗어났다').toBeGreaterThanOrEqual(0);
    expect(accuracy).toBeLessThanOrEqual(100);

    const perfRows = page
      .getByRole('heading', { name: /교사별 실적|Performance by Teacher/ })
      .locator('xpath=following::table[1]//tbody/tr');
    const rowCount = await perfRows.count();
    test.skip(rowCount === 0, '학원에 등록된 교사가 없어 표를 대조할 수 없다');

    // 열 순서: 이름 / 학급수 / 과제수 / 응답 / 정답률 / 미채점 (TeacherPerformanceCard)
    let responseSum = 0;
    let ungradedSum = 0;
    for (let i = 0; i < rowCount; i++) {
      const cells = await perfRows.nth(i).locator('td').allInnerTexts();
      expect(cells.length, '교사별 실적 표의 열 구성이 바뀌었다').toBe(6);
      const responses = Number(cells[3].match(/\d+/)?.[0]);
      const ungraded = Number(cells[5].match(/\d+/)?.[0]);
      expect(ungraded, `${cells[0]} 행의 미채점이 응답 수보다 많다`).toBeLessThanOrEqual(responses);

      // 채점된 응답이 하나도 없으면 정답률 칸은 '-'로 비운다 (TeacherPerformanceCard)
      const rateCell = cells[4].trim();
      if (rateCell === '-') {
        expect(ungraded, "정답률이 '-'인데 채점된 응답이 있다").toBe(responses);
      } else {
        const rate = Number(rateCell.match(/\d+/)?.[0]);
        expect(rate, `${cells[0]} 행의 정답률이 0~100 범위를 벗어났다`).toBeGreaterThanOrEqual(0);
        expect(rate).toBeLessThanOrEqual(100);
      }
      responseSum += responses;
      ungradedSum += ungraded;
    }

    // 개요는 학원 전체, 표는 교사 역할만이라 합계가 같다는 보장은 없다.
    // 하지만 표는 개요의 부분집합이므로 개요를 넘어설 수는 없다.
    expect(responseSum, '교사별 응답 합계가 학원 전체 응답보다 많다').toBeLessThanOrEqual(totalResponses);
    expect(ungradedSum, '교사별 미채점 합계가 학원 전체 미채점보다 많다').toBeLessThanOrEqual(ungradedResponses);
  });
});
