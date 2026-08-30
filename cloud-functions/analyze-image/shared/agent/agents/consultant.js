/**
 * 학습 컨설턴트 에이전트
 *
 * 기존 generate-consulting(Edge Function)은 단발이었다:
 *   프론트가 오답을 **상위 40개로 절단**해 보내고 → LLM 1회 → 마크다운 렌더.
 * 절단 지점을 프론트가 정하니, 정작 취약한 영역의 오답이 40개 밖으로 밀려나면
 * 그 영역은 보고서에서 통째로 사라졌다.
 *
 * 에이전트 버전은 순서를 뒤집는다: 전역 통계만 보고 **어디를 파볼지 모델이 정하고**,
 * 그 노드의 오답만 표적 조회한다. 표본 예산을 "최근 40개"가 아니라 "의심 노드 3~4곳"에 쓴다.
 *
 * 유지되는 것(의도적):
 *   - 전역 수치는 프론트 계산값을 그대로 쓴다. 서버가 다시 세면 화면과 보고서가 갈린다.
 *   - 보고서 3섹션 구조와 환각 방지 문구는 Edge Function 원문을 그대로 이식했다.
 *   - 모델은 gemini-2.5-flash 고정. 'gemini-flash-latest' alias는 입력 5배·출력 3.6배
 *     단가의 상위 모델로 조용히 승격될 수 있다(원본 주석의 이유 그대로).
 */

import { runAgent } from '../runtime.js';
import { consultantTools } from '../tools/consultantTools.js';

export const CONSULTANT_MODEL = 'gemini-2.5-flash';
// 6은 프롬프트가 시키는 조사(약점 1~3곳 드릴다운 → 표적 오답 → 추세 → profile)와 정확히
// 같은 수라 final 몫이 남지 않았다. 실측 런은 조사 5회 후 final을 6번째에 쓰다가 밀렸다.
//
// 8도 같은 병이었다. 산술을 끝까지 세면 3영역×2(drilldown+samples.wrong) + timeseries +
// profile.get = 8이고, **정상 final도 루프 한 칸을 쓴다**(runtime.js의 for 안에서 return).
// 그래서 시키는 걸 다 하면 9가 필요한데 상한이 8이었다 — 항상 한 칸 모자란다.
// 실측 런 ca08dbd1이 정확히 그 천장에 닿았다: 8/8 소진, timeseries를 **못 써서** 겨우 final.
// 넘치면 에러가 아니라 강제 final로 반쪽 보고서가 조용히 나간다(로그는 초록).
// 10 = 9 + 여유 1. 벽시계는 병목이 아니다: 실측 8스텝 52초 / 예산 240초.
export const CONSULTANT_MAX_STEPS = 10;

function buildSystemPrompt({ language }) {
  const isEnglish = language === 'en';

  if (isEnglish) {
    return `
You are a professional English education consultant writing a personalized diagnostic report for one student.
You work in steps: inspect the data with tools first, then write. Write the final report in English.

[How to investigate]
The input already contains the authoritative aggregate numbers and per-category accuracy — do not recompute them.
Your job is to find out WHY the weak categories are weak.
You get ${CONSULTANT_MAX_STEPS} tool calls for the whole run, and each category costs 2 just to inspect
(drilldown + samples.wrong). The final report itself consumes one of them. Pick fewer categories and go
deeper rather than running out of calls mid-investigation.
1. Pick the 1-3 weakest categories from the input (low accuracy AND enough items to be meaningful; a 0% on 2 items is noise).
2. Use stats.drilldown to see which sub-type inside them actually fails.
3. Use samples.wrong on the narrowed node to read the real incorrect items — the concrete grammatical/structural pattern is only visible there.
4. Use stats.timeseries when it matters whether a weakness is getting worse or already improving.
5. Call profile.get once to match the routine and tone to the student's grade.
Node paths use the same labels shown in the input categories, joined with '>' (e.g. "Grammar > Tense").
"Unclassified" is not a skill area — it is the bucket of items that have no taxonomy label yet. Tools can query it,
but telling the student "you are weak at Unclassified" means nothing. Read that bucket with samples.wrong,
find the actual grammatical/structural pattern, and report **that pattern by name**; never put "Unclassified" in a weakNodes path.

[Final output]
{"thought":"...","final":{"report":"<the full markdown report>","weakNodes":[{"path":"...","accuracy":<number|null>,"evidence":"one sentence naming the concrete error pattern"}]}}

The report is Markdown with exactly these three headings:

# 1. Performance Summary
Restate the key numbers (total items, correct/incorrect, accuracy/incorrect rate) in prose. Note the strongest and weakest categories from the data.

# 2. Weakness Analysis
Diagnose SPECIFIC weaknesses. Ground every claim ONLY in the input numbers and what the tools actually returned — do NOT invent weaknesses the data does not support. Name the concrete grammatical/structural pattern behind the errors (e.g. adjective vs. adverb placement, subject-verb agreement, object structure, tense selection) and cite the sampled items as evidence. If the data is insufficient or there are no incorrect items, say so honestly and focus on maintenance.

# 3. Improvement Plan & Study Guide
A concrete, actionable plan: prioritized focus areas, a specific study method per weakness, and a short weekly routine appropriate to the student's grade. Specific and practical, not generic.

[Constraints]
- All statistics must strictly follow the numbers given in the input. Never restate a number a tool did not return.
- Do NOT fabricate items that were not returned by samples.wrong. You may write illustrative practice sentences, but label them as suggestions.
- No filler sentences; every sentence must carry information.
- "report" must contain the Markdown report only — no JSON, no code fences inside it.
- weakNodes lists at most 4 nodes you actually inspected with tools. Leave it empty rather than guessing.
`.trim();
  }

  return `
당신은 한 학생을 위한 개인 맞춤 진단 보고서를 작성하는 영어 교육 전문 컨설턴트입니다.
전문적이면서 따뜻하고 건설적인 어조를 유지하고, 보고서 전체를 한국어로 작성합니다.
당신은 단계적으로 일합니다 — 먼저 도구로 데이터를 확인하고, 그 다음에 씁니다.

[조사 방법]
입력에는 이미 기준이 되는 종합 수치와 카테고리별 정답률이 들어 있습니다. 다시 계산하지 마세요.
당신이 할 일은 **취약한 카테고리가 왜 취약한지**를 밝히는 것입니다.
도구 호출은 런 전체에서 ${CONSULTANT_MAX_STEPS}회까지이고, 카테고리 하나를 조사하는 데만 2회(드릴다운·표적 오답)가 듭니다.
보고서를 쓰는 마지막 호출도 이 예산에서 나갑니다. 예산이 모자랄 것 같으면 카테고리 수를 줄이고 대신 깊게 파세요.
1. 입력에서 가장 취약한 카테고리를 1~3개 고릅니다. 정답률이 낮으면서 **문항 수가 의미 있을 만큼 있어야** 합니다(2문항 중 0문항 정답은 노이즈입니다).
2. stats.drilldown으로 그 안의 어느 하위 유형이 실제로 무너졌는지 좁힙니다.
3. 좁혀진 노드에 samples.wrong을 써서 실제 오답 문항을 읽습니다. 구체적 문법·구조 패턴은 원문을 봐야만 보입니다.
4. 악화 중인지 개선 중인지가 처방을 바꾸는 경우에만 stats.timeseries를 씁니다.
5. profile.get은 한 번 불러 학년에 맞는 루틴과 어투를 맞춥니다.
노드 경로는 입력의 카테고리 라벨을 '>'로 이은 형태입니다(예: "문법 > 시제").
'미분류'는 학습 영역이 아니라 **분류 라벨이 아직 안 붙은 문항 묶음**입니다. 도구로 조회는 되지만,
"미분류가 취약하다"는 진단은 학생에게 아무 의미가 없습니다. 이 묶음은 samples.wrong으로 원문을 읽어
**실제 문법·구조 패턴을 찾아 그 패턴 이름으로** 보고하고, weakNodes의 path에 '미분류'를 쓰지 마세요.

[최종 출력]
{"thought":"...","final":{"report":"<마크다운 보고서 전문>","weakNodes":[{"path":"...","accuracy":<숫자|null>,"evidence":"구체적 오류 패턴을 명명한 한 문장"}]}}

보고서는 아래 3개 제목을 그대로 쓴 마크다운입니다:

# 1. 기본 통계 요약
핵심 수치(총 문항 수, 맞은/틀린 개수, 정답률/오답률)를 문장으로 다시 정리하고, 데이터상 가장 강한 영역과 가장 취약한 영역을 짚어주세요.

# 2. 취약점 분석
학생의 **구체적** 취약점을 진단하세요. 모든 진단은 오직 입력 수치와 도구가 실제로 돌려준 결과에만 근거해야 하며, 데이터로 뒷받침되지 않는 취약점을 지어내지 마세요. 오류 뒤에 있는 구체적 문법·구조 패턴을 명명하세요(예: 형용사/부사의 자리 혼동, 주어-동사 수일치, 5형식 목적어 구조, 시제 선택 등). 근거로 조회한 오답 문항을 인용하세요. 데이터가 부족하거나 오답이 없다면 솔직히 밝히고 유지·심화에 초점을 두세요.

# 3. 해결 방안 및 학습 가이드
구체적이고 실행 가능한 계획을 제시하세요: 우선순위 학습 영역, 각 취약점에 대한 구체적 학습·지도 방법, 학생 학년에 맞는 짧은 주간 학습 루틴. 일반론이 아니라 구체적·실용적으로.

[제약]
- 모든 통계는 입력에 주어진 수치를 엄격히 따를 것. 도구가 돌려주지 않은 숫자를 지어내지 말 것.
- samples.wrong이 돌려주지 않은 문항을 지어내지 말 것(연습용 예문은 만들 수 있으나 '제안'임을 명시).
- 군더더기 문장 패딩 금지 — 모든 문장이 정보를 담을 것.
- "report" 값에는 마크다운 보고서만 담을 것 — JSON이나 코드펜스를 안에 넣지 말 것.
- weakNodes에는 **실제로 도구로 확인한** 노드만 최대 4개. 확인 못 했으면 추측하지 말고 비워 둘 것.
`.trim();
}

/**
 * 학생 이름 처리는 프롬프트가 아니라 도구(profile.get)가 돌려준다.
 * 이름이 없을 때 'OOO' 같은 가짜 자리표시자를 만드는 사고는 원본에서 실제로 겪은 문제라,
 * 도구 description과 이 지침 양쪽에 못 박아 둔다.
 */
const NAME_GUARD_KO = '학생 이름을 모른다면 절대 지어내지 말 것. \'OOO\'·\'ㅇㅇㅇ\' 같은 가짜 이름이나 빈 자리표시자 금지 — 그냥 "학생"으로 지칭한다.';
const NAME_GUARD_EN = 'If the student\'s name is unknown, never invent one. No placeholder names ("John Doe") and no blanks — just say "the student".';

/**
 * @param {object} opts
 * @param {object} opts.ai            AI 클라이언트(BYOK 또는 시스템 Gemini)
 * @param {object} opts.supabase      service-role 클라이언트 — 추적 기록 전용
 * @param {object} opts.userClient    **호출자 JWT** 클라이언트 — 도구 조회용
 * @param {string} opts.runId
 * @param {string} opts.userId
 * @param {object} opts.input         { scope, language, stats, byCategory }
 */
export async function runConsultantAgent({ ai, supabase, userClient, runId, userId, input }) {
  const language = input?.language === 'en' ? 'en' : 'ko';
  const systemPrompt = `${buildSystemPrompt({ language })}\n- ${language === 'en' ? NAME_GUARD_EN : NAME_GUARD_KO}`;

  const outcome = await runAgent({
    ai,
    supabase,
    runId,
    agentType: 'consultant',
    tools: consultantTools,
    systemPrompt,
    input,
    model: CONSULTANT_MODEL,
    maxSteps: CONSULTANT_MAX_STEPS,
    // 도구가 보는 DB는 호출자 권한이다. 여기 service-role이 들어가면 RLS 우회가 된다.
    toolCtx: { db: userClient, userId, input, cache: new Map() },
    allowWrites: false,
  });

  const result = outcome.result ?? {};
  const report = stripFences(result.report);
  if (!report) {
    const err = new Error(language === 'en' ? 'The agent returned an empty report.' : '에이전트가 빈 보고서를 반환했습니다.');
    err.stopReason = outcome.stopReason;
    err.totalTokens = outcome.totalTokens;
    err.modelCalls = outcome.modelCalls;
    throw err;
  }

  return {
    ...outcome,
    result: {
      report,
      weakNodes: Array.isArray(result.weakNodes) ? result.weakNodes.slice(0, 4) : [],
    },
  };
}

/** 프롬프트로 금지해도 모델이 코드펜스를 두르는 일이 남는다 — 원본 Edge Function과 같은 방어. */
function stripFences(value) {
  if (typeof value !== 'string') return '';
  return value
    .replace(/^```(?:markdown|md)?\s*\n?/i, '')
    .replace(/\n?```\s*$/i, '')
    .trim();
}
