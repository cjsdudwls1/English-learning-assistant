import { test, expect, type Page } from '@playwright/test';
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
    await expect(classLink, '교사 계정에 학급이 없어 과제 흐름을 검증할 수 없다').toBeVisible({ timeout: 30_000 });
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

    // 정리. 앞 test가 실패하면 이 test는 건너뛰어져 과제가 남지만,
    // 제목에 실행 타임스탬프가 있어 다음 실행과 충돌하지는 않는다.
    page.once('dialog', (d) => d.accept());
    await page.getByRole('button', { name: T.deleteAssignment }).click();
    await page.waitForURL('**/teacher/dashboard', { timeout: 30_000 });
    await waitForRenderSettled(page);
    await expect(page.locator('a').filter({ hasText: TITLE }), '삭제한 과제가 목록에 남아 있다').toHaveCount(0);
  });
});
