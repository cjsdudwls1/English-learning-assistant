import { test, expect, type Page } from './fixtures';
import { T, accounts, login, password, readYearSolvingTotals, waitForRenderSettled } from './helpers';

// 교사가 과제를 만들고 → 학생이 풀고 → 자동채점·통계에 반영되고 → 교사 화면에서 같은 결과가 보이는지,
// 실제 DB를 거쳐 한 줄기로 검증한다.
//
// 시드 데이터의 절대값(문제 273개, 정답률 20% 등)은 언제든 바뀌므로 기대값으로 쓰지 않는다.
// 대신 "이번 실행에서 만든 과제" 안에서만 성립해야 하는 불변식을 본다:
//   - 완료 화면 '정답: X / N'의 N == 내가 고른 문제 수
//   - X == 리뷰 목록의 '맞음' 배지 수
//   - '맞음' + '틀림' + '미채점' == N
//   - /stats 연간 통계 증가분 == 제출 수, 정답 증가분 == X
//   - 교사 응답표의 정답/오답 개수 == 학생 화면의 그것
//
// 마지막 test에서 과제를 지운다. assignment_responses는 FK ON DELETE CASCADE라
// (supabase/migrations/20260328000000_add_roles_classes_assignments.sql) 응답도 함께 지워져
// 반복 실행해도 통계가 누적되지 않는다.
test.describe.configure({ mode: 'serial' });

const RUN_ID = String(Date.now());
const TITLE = `[E2E] 과제 흐름 ${RUN_ID}`;
// short_answer에 넣을 확실한 오답 — 오답 경로가 최소 1건은 생기도록 고정한다.
const WRONG_TEXT = `__e2e_wrong_${RUN_ID}__`;

// serial 모드라 test 간 상태를 모듈 변수로 넘긴다.
let classId = '';
let assignmentId = '';
let problemCount = 0;
let hasShortAnswer = false;
let studentCorrect = 0;
let studentWrong = 0;
let baseline = { total: 0, correct: 0, incorrect: 0 };

// ProblemSelector 항목: <label><input type=checkbox><div><p>{stem}</p><span>{type} · {date}</span></div></label>
const problemsOfType = (page: Page, type: string) =>
  page.locator(`label:has(input[type="checkbox"]):has(span:text-matches("^${type} · "))`);

// 현재 문항에 답을 채워 넣고 유형을 돌려준다.
async function answerCurrentProblem(page: Page): Promise<string> {
  const short = page.getByPlaceholder(T.shortAnswerInput);
  if (await short.count()) {
    await short.fill(WRONG_TEXT);
    return 'short_answer';
  }
  const essay = page.getByPlaceholder(T.essayInput);
  if (await essay.count()) {
    await essay.fill(WRONG_TEXT);
    return 'essay';
  }
  const ox = page.getByRole('button', { name: /^O$/ });
  if (await ox.count()) {
    await ox.click();
    return 'ox';
  }
  // multiple_choice: 버튼 텍스트가 '{번호}. {선택지}'
  await page.getByRole('button', { name: /^1\.\s/ }).click();
  return 'multiple_choice';
}

test.describe('과제 라이프사이클 (교사 생성 → 학생 제출 → 통계 반영)', () => {
  test.skip(!password, 'E2E_PASSWORD 환경변수가 필요합니다 (QA 시드 계정 비밀번호)');
  // 로그인 + 다단계 폼 + DB 왕복이라 기본 60s로는 부족하다.
  test.setTimeout(180_000);

  test('teacher: 학생을 학급에 편성하고 과제를 생성한다', async ({ page }) => {
    await login(page, accounts.teacher);

    await page.goto('/teacher/dashboard');
    await waitForRenderSettled(page);
    const classLink = page.locator('a[href^="/teacher/classes/"]').first();
    // 여기서 실패하면 원인이 셋으로 갈린다 — 아직 로딩 중 / 로드가 실패해 에러 문구 / 정말 학급 0개.
    // TeacherDashboardPage는 실패를 삼키지 않고 에러를 렌더하므로 화면 텍스트로 구분되는데,
    // CI는 성공한 run의 artifact를 남기지 않아(재시도로 통과하면 flaky여도 조회 불가) 사후 확인이 안 된다.
    // 실제로 2026-07-27 CI에서 이 대기가 flaky로 한 번 걸렸고 화면을 확인할 방법이 없었다.
    try {
      await expect(classLink).toBeVisible({ timeout: 30_000 });
    } catch {
      const shown = (await page.locator('body').innerText()).replace(/\s+/g, ' ').trim().slice(0, 300);
      throw new Error(`교사 계정에 학급이 없어 과제 흐름을 검증할 수 없다 — 화면: ${shown}`);
    }
    classId = (await classLink.getAttribute('href'))!.split('/').pop()!;

    // 편성은 멱등하게 — 이미 멤버면 앱이 에러 문구를 띄우지만 무시한다.
    // 실제 편성 여부는 아래 과제 생성 화면의 학생 체크박스 존재로 확인한다.
    await page.goto(`/teacher/classes/${classId}`);
    await waitForRenderSettled(page);
    await page.getByPlaceholder(T.addByEmail).fill(accounts.student);
    await page.getByRole('button', { name: T.add }).click();
    await waitForRenderSettled(page);

    await page.goto('/teacher/assignments/create');
    await waitForRenderSettled(page);
    await page.getByPlaceholder(T.assignmentTitle).fill(TITLE);

    // 세기 전에 목록 로드 완료를 확정한다. ProblemSelector는 로딩 중 목록 대신
    // '문제를 불러오는 중...'만 렌더하는데, count()는 auto-wait을 하지 않아 그 순간을
    // '문제 0개'로 읽는다 — CI에서 실제로 3회 연속 이렇게 실패했다(helpers.ts 주석 참고).
    await expect(
      page.getByRole('heading', { name: T.problemsSelectedRatio }),
      '문제 목록이 로드되지 않았다',
    ).toBeVisible({ timeout: 60_000 });

    // 자동채점되는 유형만 고른다. essay·ox는 채점 결과가 null이거나 시드에 따라 흔들려
    // '맞음 + 틀림 == 전체' 불변식을 흐린다.
    const mc = problemsOfType(page, 'multiple_choice');
    const sa = problemsOfType(page, 'short_answer');
    const mcCount = Math.min(2, await mc.count());
    const saCount = Math.min(1, await sa.count());
    problemCount = mcCount + saCount;
    hasShortAnswer = saCount > 0;
    expect(problemCount, '교사 계정에 자동채점 가능한 생성 문제가 없다').toBeGreaterThan(0);

    for (let i = 0; i < mcCount; i++) await mc.nth(i).locator('input[type="checkbox"]').check();
    for (let i = 0; i < saCount; i++) await sa.nth(i).locator('input[type="checkbox"]').check();

    await page.selectOption('#target-class-select', classId);
    const studentRow = page
      .locator('label:has(input[type="checkbox"])')
      .filter({ hasText: accounts.student });
    await expect(studentRow, 'E2E 학생이 학급에 편성되지 않았다').toHaveCount(1, { timeout: 20_000 });
    await studentRow.locator('input[type="checkbox"]').check();

    await page.getByRole('button', { name: T.createSubmit }).click();
    await page.waitForURL('**/teacher/dashboard', { timeout: 30_000 });
    await waitForRenderSettled(page);

    // 목록은 created_at desc라 방금 만든 과제가 맨 위에 온다.
    const created = page
      .locator('a[href^="/teacher/assignments/"]:not([href$="/create"])')
      .filter({ hasText: TITLE });
    await expect(created, '생성한 과제가 교사 대시보드에 보이지 않는다').toHaveCount(1, { timeout: 30_000 });
    assignmentId = (await created.getAttribute('href'))!.split('/').pop()!;
  });

  test('student: 과제를 풀면 자동채점 결과와 풀이 통계가 일치한다', async ({ page }) => {
    expect(assignmentId, '앞 단계에서 과제가 생성되지 않았다').not.toBe('');
    await login(page, accounts.student);

    // 제출 전 연간 풀이 통계 — 증가분만 비교하므로 절대값은 무관하다.
    await page.goto('/stats');
    await waitForRenderSettled(page, { quietMs: 1_500, maxMs: 25_000 });
    baseline = await readYearSolvingTotals(page);

    await page.goto('/assignments');
    await waitForRenderSettled(page);
    const card = page.locator('a[href^="/assignments/"]').filter({ hasText: TITLE });
    await expect(card, '학생에게 과제가 배정되지 않았다').toHaveCount(1, { timeout: 30_000 });
    await expect(card, '풀기 전인데 진행률이 0이 아니다').toContainText(`0/${problemCount}`);
    await card.click();
    await waitForRenderSettled(page);

    for (let i = 0; i < problemCount; i++) {
      const submit = page.getByRole('button', { name: T.submitAnswer });
      await expect(submit, `${i + 1}번째 문항의 제출 버튼이 없다`).toBeVisible({ timeout: 30_000 });
      await answerCurrentProblem(page);
      await expect(submit, '답을 골랐는데도 제출 버튼이 비활성이다').toBeEnabled();
      await submit.click();
      // 제출되면 다음 문항으로 넘어간다(마지막이면 완료 화면이라 헤더가 그대로 유지된다).
      await expect(page.getByText(`${Math.min(i + 2, problemCount)} / ${problemCount}`)).toBeVisible({
        timeout: 30_000,
      });
    }

    await expect(page.getByText(T.allSolved), '전부 풀었는데 완료 화면이 아니다').toBeVisible({ timeout: 30_000 });

    const summaryText = await page.getByText(T.correctSummary).first().innerText();
    const [, correctStr, totalStr] = summaryText.match(T.correctSummary)!;
    studentCorrect = Number(correctStr);
    expect(Number(totalStr), '완료 화면의 전체 문항 수가 배정 수와 다르다').toBe(problemCount);

    await expect(page.getByRole('heading', { name: T.reviewHeading })).toBeVisible();
    const correctBadges = await page.getByText(T.markCorrect).count();
    const wrongBadges = await page.getByText(T.markWrong).count();
    const ungradedBadges = await page.getByText(T.notGraded).count();
    studentWrong = wrongBadges;

    expect(correctBadges, "요약의 정답 수와 리뷰의 '맞음' 배지 수가 다르다").toBe(studentCorrect);
    expect(correctBadges + wrongBadges + ungradedBadges, '배지 합계가 문항 수와 다르다').toBe(problemCount);
    expect(ungradedBadges, 'mc·short_answer만 냈으므로 미채점이 없어야 한다').toBe(0);
    if (hasShortAnswer) {
      expect(wrongBadges, '확실한 오답을 냈는데 틀린 문항이 없다').toBeGreaterThanOrEqual(1);
    }

    await page.goto('/assignments');
    await waitForRenderSettled(page);
    await expect(
      page.locator('a[href^="/assignments/"]').filter({ hasText: TITLE }),
      '다 풀었는데 목록에 완료 표시가 없다',
    ).toContainText(T.completed);

    // 과제 응답은 roleStats.fetchAllStatsRows가 assignment_responses에서 함께 집계한다.
    await page.goto('/stats');
    await waitForRenderSettled(page, { quietMs: 1_500, maxMs: 25_000 });
    const after = await readYearSolvingTotals(page);
    // 증가분 검증은 "이 계정에 다른 풀이가 동시에 들어오지 않는다"는 전제 위에 선다.
    // 전제가 깨지면 집계 결함과 구분이 안 되므로 실측값을 메시지에 남긴다 —
    // 2026-07-27 로컬 실행이 +6으로 실패했을 때, DB에는 응답이 3건뿐이고 집계 로직도
    // 소스별 1회 합산이라(roleStats.fetchAllStatsRows/aggregateByMonth) 코드 결함이 아니라
    // 같은 계정을 쓰는 다른 실행이 끼어든 것이었는데, 값이 없어 사후 조회로만 판별할 수 있었다.
    const seen = `baseline=${baseline.total}(${baseline.correct}/${baseline.incorrect}) after=${after.total}(${after.correct}/${after.incorrect})`;
    expect(after.total - baseline.total, `풀이 통계 총 문제 수가 제출 수만큼 늘지 않았다 — ${seen}`).toBe(problemCount);
    expect(after.correct - baseline.correct, `풀이 통계 정답 수가 채점 결과와 다르다 — ${seen}`).toBe(studentCorrect);
    expect(after.incorrect - baseline.incorrect, `풀이 통계 오답 수가 채점 결과와 다르다 — ${seen}`).toBe(studentWrong);
  });

  test('teacher: 응답표가 학생 채점 결과와 일치하고, 과제를 삭제할 수 있다', async ({ page }) => {
    expect(assignmentId, '앞 단계에서 과제가 생성되지 않았다').not.toBe('');
    await login(page, accounts.teacher);

    await page.goto(`/teacher/assignments/${assignmentId}`);
    await waitForRenderSettled(page);
    await expect(
      page.getByText(
        new RegExp(
          `문제 ${problemCount}개 · 응답 ${problemCount}건|${problemCount} problems · ${problemCount} responses`,
        ),
      ),
      '교사 화면의 문제·응답 수가 학생 제출과 다르다',
    ).toBeVisible({ timeout: 30_000 });

    await expect(page.getByTestId('assignment-response-row')).toHaveCount(problemCount);
    const verdicts = (await page.getByTestId('response-verdict').allInnerTexts()).map((v) => v.trim());
    const teacherCorrect = verdicts.filter((v) => /^(정답|Correct)$/.test(v)).length;
    const teacherWrong = verdicts.filter((v) => /^(오답|Incorrect)$/.test(v)).length;
    expect(teacherCorrect, '교사가 보는 정답 수가 학생 화면과 다르다').toBe(studentCorrect);
    expect(teacherWrong, '교사가 보는 오답 수가 학생 화면과 다르다').toBe(studentWrong);

    // 삭제 자체가 검증 대상이다(교사가 과제를 지울 수 있는가). 실패한 실행의 뒷정리는
    // 이 test가 아니라 아래 afterAll이 책임진다 — serial 모드는 앞 test가 깨지면 여기까지
    // 오지 못한다.
    page.once('dialog', (d) => d.accept());
    await page.getByRole('button', { name: T.deleteAssignment }).click();
    await page.waitForURL('**/teacher/dashboard', { timeout: 30_000 });
    await waitForRenderSettled(page);
    await expect(page.locator('a').filter({ hasText: TITLE }), '삭제한 과제가 목록에 남아 있다').toHaveCount(0);
  });

  // 뒷정리는 test가 아니라 afterAll에서 한다.
  //
  // serial 모드는 앞 test가 실패하면 뒤 test를 **건너뛴다.** 삭제를 마지막 test 안에만 두면
  // 실패한 실행마다 과제와 응답이 DB에 그대로 남는다. "제목에 타임스탬프가 있어 다음 실행과
  // 충돌하지 않는다"는 것은 맞지만, 충돌하지 않는 것과 오염되지 않는 것은 다른 문제였다:
  // 2026-08-26 실측으로 실패분 13개 실행이 남긴 응답 36건(전부 오답)이 학생 통계에 그대로
  // 누적돼 있었고, 학습 컨설턴트가 본 이 계정의 '미분류' 오답 39건은 **전부** 이 잔여물이었다.
  //
  // 이번 실행 것만 지우지 않고 남아 있는 `[E2E]` 과제를 전부 지운다(과거 실패분 자가치유).
  // 응답·과제문제·대상은 FK ON DELETE CASCADE로 따라 지워진다
  // (supabase/migrations/20260328000000_add_roles_classes_assignments.sql).
  test.afterAll(async ({ browser }) => {
    if (!password) return;
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await login(page, accounts.teacher);
      await page.goto('/teacher/dashboard');
      await waitForRenderSettled(page);

      // 대시보드 목록은 최근 것만 보여줄 수 있다 — 한 번에 다 못 지워도 남은 건 다음 실행이 마저 지운다.
      // `:not([href$="/create"])`는 '과제 만들기' 링크를 뺀다 — 첫 test가 쓰는 선택자와 같다.
      const leftovers = () =>
        page
          .locator('a[href^="/teacher/assignments/"]:not([href$="/create"])')
          .filter({ hasText: '[E2E]' });

      for (let i = 0; i < 20; i += 1) {
        if ((await leftovers().count()) === 0) break;
        await leftovers().first().click();
        await waitForRenderSettled(page);
        page.once('dialog', (d) => d.accept());
        await page.getByRole('button', { name: T.deleteAssignment }).click();
        await page.waitForURL('**/teacher/dashboard', { timeout: 30_000 });
        await waitForRenderSettled(page);
      }
    } catch (e) {
      // 정리 실패로 테스트 결과를 뒤집지 않는다. 대신 잔여물이 남았다는 사실을 남긴다.
      console.warn('[e2e] [E2E] 과제 정리 실패 — DB에 잔여물이 남았을 수 있다:', e);
    } finally {
      await context.close();
    }
  });
});
