/**
 * 에이전트 예산 ↔ 배포 설정 계약 테스트.
 *
 * 왜 배포 스크립트를 테스트가 읽는가:
 * 이 루프는 **요청 안에서** 끝난다. publisher(analyze-image)가 cpu-throttling=true라서
 * `res.json()` 뒤의 백그라운드 작업엔 CPU가 할당되지 않기 때문이다(index.js handleAgentRun 주석).
 * 즉 "예산 < 요청 타임아웃"은 성능 튜닝이 아니라 **동작 조건**이고, 둘은 서로 다른 파일에 있다.
 *
 * 실제로 이 짝이 어긋나서 사고가 났다: 루프를 얹을 때 이 함수를 600초짜리로 착각했는데
 * 실측은 timeout=60s + cpu-throttling=true였다. 코드만 보면 절대 안 보이는 종류의 오류라,
 * 어긋나는 순간 CI가 잡도록 여기서 고정한다.
 *
 * cpu-throttling을 푸는 쪽(--no-cpu-throttling)도 금지로 고정한다. 4분마다 도는 워밍업 핑이
 * 인스턴스를 상시 살려두므로 스로틀을 풀면 1vCPU가 24/7 과금된다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { DEFAULT_BUDGET_MS } from '../shared/agent/runtime.js';
import { parseAgentDisabled, isAgentEnabled } from '../shared/config.js';

const deployScript = readFileSync(
  fileURLToPath(new URL('../deploy-image.ps1', import.meta.url)),
  'utf-8',
);

const indexSource = readFileSync(
  fileURLToPath(new URL('../index.js', import.meta.url)),
  'utf-8',
);

/**
 * 주석을 걷어낸 "실제로 실행되는 부분"만 남긴다.
 *
 * 헤더 `<# ... #>` 블록에는 "--no-cpu-throttling을 쓰지 말 것" 같은 **금지 문구가 인자 형태로**
 * 적혀 있다. 그걸 인자로 세면 설명을 잘 써둘수록 테스트가 깨진다(실제로 한 번 깨졌다).
 */
function executableLines() {
  return deployScript
    .replace(/<#[\s\S]*?#>/g, '')       // 블록 주석
    .split(/\r?\n/)
    .map((l) => l.replace(/\s#.*$/, '')) // 줄 끝 주석 (`--format=none  # ...`)
    .filter((l) => l.trim().length > 0);
}

/** deploy-image.ps1의 실제 인자에서 --timeout을 읽는다. */
function deployedTimeoutMs() {
  const line = executableLines().find((l) => l.trimStart().startsWith('--timeout='));
  assert.ok(line, 'deploy-image.ps1에서 --timeout 인자를 찾지 못했다');

  const match = line.match(/--timeout=(\d+)s/);
  assert.ok(match, `--timeout 값을 초 단위로 파싱하지 못했다: ${line.trim()}`);
  return Number(match[1]) * 1000;
}

test('에이전트 예산이 배포된 요청 타임아웃보다 작다', () => {
  const timeoutMs = deployedTimeoutMs();

  assert.ok(
    DEFAULT_BUDGET_MS < timeoutMs,
    `예산(${DEFAULT_BUDGET_MS}ms)이 요청 타임아웃(${timeoutMs}ms) 이상이다. ` +
    '루프가 요청 안에서 끝나지 못하고 504로 잘린다.',
  );
});

test('강제 final을 부를 여유가 타임아웃 안에 남는다', () => {
  const timeoutMs = deployedTimeoutMs();

  // 예산 소진 시 runtime이 마지막으로 모델을 한 번 더 부른다(FINAL_RESERVE_MS). 그 호출이
  // 타임아웃에 걸려 잘리면 "관측은 다 모았는데 답이 없는" 최악의 결과가 된다.
  const MARGIN_MS = 30_000;
  assert.ok(
    DEFAULT_BUDGET_MS + MARGIN_MS <= timeoutMs,
    `예산(${DEFAULT_BUDGET_MS}ms) + 여유(${MARGIN_MS}ms)가 타임아웃(${timeoutMs}ms)을 넘는다.`,
  );
});

test('publisher의 cpu-throttling을 풀지 않는다', () => {
  assert.ok(
    !executableLines().some((l) => l.includes('--no-cpu-throttling')),
    'deploy-image.ps1에 --no-cpu-throttling이 들어갔다. 워밍업 핑 때문에 1vCPU가 24/7 과금된다.',
  );
});

test('min-instances=0이 유지된다', () => {
  // 과거 5로 바뀌어 수일간 과금된 이력이 있다(스크립트 헤더 주석).
  assert.ok(executableLines().some((l) => /--min-instances=0\b/.test(l)));
});

/* ── 에이전트 킬 스위치 (AGENT_DISABLED) ──────────────────────────────────
 * 프론트(useConsulting)에는 에이전트 플래그가 없다 — Vite env는 빌드 시점에 구워지므로
 * 프론트에 스위치를 두면 끄는 데 Netlify 재빌드가 필요하다. 그래서 스위치는 서버측이고,
 * "끈다"의 정의는 **503 + 기존 단발 Edge Function 폴백**이다.
 * 기본값을 실수로 뒤집으면(전부 OFF) 기능이 조용히 죽으므로 여기서 못을 박는다. */

test('AGENT_DISABLED 기본값은 비어 있고 = 전부 ON이다', () => {
  assert.equal(parseAgentDisabled(undefined).size, 0);
  assert.equal(parseAgentDisabled('').size, 0);
  assert.ok(isAgentEnabled('consultant', parseAgentDisabled(undefined)));
});

test('AGENT_DISABLED에 적힌 종류만 꺼진다', () => {
  const disabled = parseAgentDisabled('consultant');
  assert.equal(isAgentEnabled('consultant', disabled), false);
  assert.ok(isAgentEnabled('planner', disabled), '다른 에이전트까지 끄면 스위치가 아니라 차단기다');
});

test('쉼표 목록·공백·대소문자를 흡수한다', () => {
  // 운영 중 급하게 치는 값이라 ` Consultant , PLANNER ` 같은 게 들어온다.
  const disabled = parseAgentDisabled(' Consultant , PLANNER ');
  assert.equal(isAgentEnabled('consultant', disabled), false);
  assert.equal(isAgentEnabled('planner', disabled), false);
  assert.ok(isAgentEnabled('briefing', disabled));
});

test('킬 스위치는 createRun보다 먼저 본다', () => {
  // 순서가 뒤집히면 꺼둔 에이전트가 매 요청마다 빈 런 행을 남긴다(그리고 그 뒤 모델을 부른다).
  const guard = indexSource.indexOf('isAgentEnabled(agentType)');
  const create = indexSource.indexOf('createRun(');
  assert.ok(guard > 0, 'handleAgentRun에 킬 스위치 가드가 없다');
  assert.ok(create > 0);
  assert.ok(guard < create, '킬 스위치가 createRun 뒤에 있다 — 막아도 런 행이 생긴다');
});
