/**
 * 아키텍처 비교 러너 (성능 + 비용 동시 계측)
 *
 * 비교군:
 *   A = current(crop)            현재 4-Pass. correct_answer를 문항별 fullCrop으로 추론(N호출).
 *   C = hybrid(fullpage-correct) correct 크롭 호출 제거 → full-image fallback이 풀페이지 1회로 채움.
 *                                user_answer 크롭 경로는 A와 동일.
 *   B = single-call             Gemini 단일 호출(구조분리/크롭/DocAI/폴백 전부 없음).
 *
 * 비용 계측: ai.models.generateContent 를 래핑해 호출 수 + prompt/candidate 토큰을 집계.
 *           Document AI 호출은 페이지당 1회(Pass A, DOCUMENT_AI_ENABLED 시)로 별도 산정.
 *
 * 성능 채점: score.mjs(precision-first)로 A/B/C 동일 gold 기준 정렬.
 *
 * 사용:
 *   node eval/harness/compare.mjs --runs 3 --concurrency 3 --tag cmp
 *   node eval/harness/compare.mjs --runs 3 --tag cmp-nodocai --no-docai
 *   node eval/harness/compare.mjs --runs 3 --tag cmp --archs A,C   # 일부만
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GoogleGenAI } from '@google/genai';
import { loadEnvYaml } from './load-env.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GT_PATH = path.resolve(__dirname, '../labels/ground-truth.json');
const TEST_IMAGE_ROOT = path.resolve(__dirname, '../../../../test_image');
const RESULTS_DIR = path.resolve(__dirname, '../results');

function parseArgs(argv) {
  const a = { runs: 3, concurrency: 3, tag: 'cmp', archs: ['A', 'C', 'B'], noDocai: false };
  for (let i = 2; i < argv.length; i++) {
    const t = argv[i];
    if (t === '--runs') a.runs = parseInt(argv[++i], 10);
    else if (t === '--concurrency') a.concurrency = parseInt(argv[++i], 10);
    else if (t === '--tag') a.tag = argv[++i];
    else if (t === '--archs') a.archs = argv[++i].split(',').map(s => s.trim()).filter(Boolean);
    else if (t === '--no-docai') a.noDocai = true;
  }
  return a;
}

function buildAIClient() {
  const serviceAccountJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  const aiOptions = { vertexai: true, project: process.env.VERTEX_PROJECT_ID || 'gen-lang-client-0516945872', location: process.env.VERTEX_LOCATION || 'global' };
  if (serviceAccountJson) {
    try { aiOptions.googleAuthOptions = { credentials: JSON.parse(serviceAccountJson) }; }
    catch (e) { console.error('[compare] SA JSON 파싱 실패, ADC 폴백:', e.message); }
  }
  return new GoogleGenAI(aiOptions);
}

/** ai.models.generateContent 를 래핑해 호출수/토큰 집계 (계측 분리를 위해 arch마다 새 ai). */
function instrumentAI(ai) {
  const c = { calls: 0, byModel: {}, promptTokens: 0, candTokens: 0, totalTokens: 0 };
  const models = ai.models;
  const orig = models.generateContent.bind(models);
  models.generateContent = async (params) => {
    const res = await orig(params);
    c.calls++;
    const m = params?.model || '?';
    c.byModel[m] = (c.byModel[m] || 0) + 1;
    const u = res?.usageMetadata || res?.response?.usageMetadata;
    if (u) {
      c.promptTokens += u.promptTokenCount || 0;
      c.candTokens += u.candidatesTokenCount || 0;
      c.totalTokens += u.totalTokenCount || 0;
    }
    return res;
  };
  return c;
}

async function pool(items, limit, worker) {
  const results = new Array(items.length);
  let idx = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = idx++;
      if (i >= items.length) break;
      results[i] = await worker(items[i], i);
    }
  });
  await Promise.all(runners);
  return results;
}

async function main() {
  const args = parseArgs(process.argv);
  loadEnvYaml();
  if (args.noDocai) {
    delete process.env.DOCUMENT_AI_PROCESSOR_ID;
    console.error('[compare] --no-docai: Document AI 비활성화');
  }
  const docaiOn = !!process.env.DOCUMENT_AI_PROCESSOR_ID;

  // config(DOCUMENT_AI_ENABLED)는 import 시점에 평가되므로, env 조작 뒤 동적 import.
  const { runPipelineOnImage } = await import('./pipeline-runner.mjs');
  const { runSingleCall } = await import('./baseline-single-call.mjs');
  const { scoreMultiRun } = await import('./score.mjs');

  const ARCHS = {
    A: { label: 'current(crop)',  usesDocai: true,  run: ({ ai, imagePath }) => runPipelineOnImage({ ai, imagePath, correctSource: 'crop' }) },
    C: { label: 'hybrid(fp-corr)', usesDocai: true,  run: ({ ai, imagePath }) => runPipelineOnImage({ ai, imagePath, correctSource: 'fullpage' }) },
    B: { label: 'single-call',    usesDocai: false, run: ({ ai, imagePath }) => runSingleCall({ ai, imagePath }) },
  };

  const gt = JSON.parse(fs.readFileSync(GT_PATH, 'utf8'));
  const images = gt.pages.map(p => p.image);
  fs.mkdirSync(RESULTS_DIR, { recursive: true });

  const origLog = console.log;
  const results = {};

  for (const key of args.archs) {
    const arch = ARCHS[key];
    if (!arch) { console.error(`[compare] 알 수 없는 arch: ${key}`); continue; }

    const ai = buildAIClient();
    const counter = instrumentAI(ai);

    const jobs = [];
    for (let r = 0; r < args.runs; r++) for (const img of images) jobs.push({ img, r });

    const t0 = Date.now();
    let done = 0;
    console.log = () => {}; // 파이프라인 내부 로그 침묵
    const flat = await pool(jobs, args.concurrency, async ({ img, r }) => {
      const abs = path.join(TEST_IMAGE_ROOT, img);
      const jt0 = Date.now();
      try {
        const marks = await arch.run({ ai, imagePath: abs });
        done++;
        console.error(`[${key} ${done}/${jobs.length}] OK r${r} ${path.basename(img)} (${Date.now() - jt0}ms, ${marks.length} marks)`);
        return { img, r, ok: true, marks };
      } catch (e) {
        done++;
        console.error(`[${key} ${done}/${jobs.length}] FAIL r${r} ${path.basename(img)}: ${e?.message}`);
        return { img, r, ok: false, error: e?.message, marks: [] };
      }
    });
    console.log = origLog;

    const runs = Array.from({ length: args.runs }, () => ({}));
    for (const f of flat) runs[f.r][f.img] = f.marks;
    const scored = scoreMultiRun(gt, runs);

    const pages = args.runs * images.length;
    const docaiCalls = (arch.usesDocai && docaiOn) ? pages : 0;
    results[key] = {
      label: arch.label,
      elapsedMs: Date.now() - t0,
      pages,
      cost: {
        gemini_calls: counter.calls,
        gemini_calls_per_page: +(counter.calls / pages).toFixed(2),
        prompt_tokens: counter.promptTokens,
        cand_tokens: counter.candTokens,
        total_tokens: counter.totalTokens,
        tokens_per_page: +(counter.totalTokens / pages).toFixed(0),
        byModel: counter.byModel,
        docai_calls: docaiCalls,
        docai_calls_per_page: +(docaiCalls / pages).toFixed(2),
      },
      agg: scored.agg,
      stability: scored.stability,
      rawRuns: runs,
    };
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outPath = path.join(RESULTS_DIR, `${args.tag}-${stamp}.json`);
  fs.writeFileSync(outPath, JSON.stringify({ tag: args.tag, runs: args.runs, concurrency: args.concurrency, docaiOn, images, results }, null, 2));

  // ── 콘솔 요약 ──
  const pad = (s, n) => String(s).padEnd(n);
  console.log(`\n===== ARCH COMPARE: ${args.tag} (runs=${args.runs}, docai=${docaiOn ? 'on' : 'off'}) =====`);
  console.log(pad('arch', 16), pad('gem/pg', 8), pad('tok/pg', 9), pad('docai/pg', 9), pad('mc_user P/R', 16), pad('mc_corr P/R', 16), pad('text P/R', 14), 'wrong_avg');
  for (const key of args.archs) {
    const r = results[key]; if (!r) continue;
    const a = r.agg;
    const fmtPR = (b) => `${b.precision_avg ?? '-'}/${b.recall_avg ?? '-'}`;
    console.log(
      pad(`${key} ${r.label}`, 16),
      pad(r.cost.gemini_calls_per_page, 8),
      pad(r.cost.tokens_per_page, 9),
      pad(r.cost.docai_calls_per_page, 9),
      pad(fmtPR(a.mc_user), 16),
      pad(fmtPR(a.mc_correct), 16),
      pad(fmtPR(a.text_user), 14),
      `mc_u=${a.mc_user.wrong_avg} mc_c=${a.mc_correct.wrong_avg} txt=${a.text_user.wrong_avg}`,
    );
  }
  console.log('\n--- arch별 confident-wrong / flaky ---');
  for (const key of args.archs) {
    const r = results[key]; if (!r) continue;
    const items = r.stability.filter(s => s.classes.includes('wrong') || s.flakyClass);
    console.log(`[${key} ${r.label}] ever_wrong=${r.agg.ever_wrong} always_wrong=${r.agg.always_wrong} flaky=${r.agg.flaky_class}`);
    for (const s of items) {
      console.log(`   ${s.problem_number}.${s.field} [${path.basename(s.image)}] gt=${JSON.stringify(s.gt)} preds=${JSON.stringify(s.predCounts)} cls=${JSON.stringify(s.classCounts)}`);
    }
  }
  console.log('\nsaved:', outPath);
}

main().catch(e => { console.error('FATAL', e?.stack || e?.message); process.exit(1); });
