/**
 * 멀티런 평가 오케스트레이터
 * - gold 세트(ground-truth.json의 pages)에 대해 실제 파이프라인을 N회 실행.
 * - 작업 동시성(concurrency)을 제한해 프로덕션 부하 패턴을 모사(기본 3 = ANALYSIS_BATCH_SIZE).
 * - 각 런의 원시 출력 + 멀티런 채점요약을 results/<tag>-<ts>.json 으로 저장.
 *
 * 사용:
 *   node run-eval.mjs --runs 3 --concurrency 3 --tag baseline
 *   node run-eval.mjs --runs 1 --tag coverage --all     # test_image 전체(채점은 gold만)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnvYaml } from './load-env.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GT_PATH = path.resolve(__dirname, '../labels/ground-truth.json');
const TEST_IMAGE_ROOT = path.resolve(__dirname, '../../../../test_image');
const RESULTS_DIR = path.resolve(__dirname, '../results');

function parseArgs(argv) {
  const a = { runs: 3, concurrency: 3, tag: 'run', all: false };
  for (let i = 2; i < argv.length; i++) {
    const t = argv[i];
    if (t === '--runs') a.runs = parseInt(argv[++i], 10);
    else if (t === '--concurrency') a.concurrency = parseInt(argv[++i], 10);
    else if (t === '--tag') a.tag = argv[++i];
    else if (t === '--all') a.all = true;
  }
  return a;
}

/** 동시성 제한 풀 */
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

function listAllImages() {
  const out = [];
  for (const dir of fs.readdirSync(TEST_IMAGE_ROOT)) {
    const full = path.join(TEST_IMAGE_ROOT, dir);
    if (!fs.statSync(full).isDirectory()) continue;
    for (const f of fs.readdirSync(full)) {
      if (/\.(jpg|jpeg|png|webp)$/i.test(f)) out.push(`${dir}/${f}`);
    }
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv);
  loadEnvYaml();
  const { buildAIClient, runPipelineOnImage } = await import('./pipeline-runner.mjs');
  const { scoreMultiRun } = await import('./score.mjs');

  const gt = JSON.parse(fs.readFileSync(GT_PATH, 'utf8'));
  const goldImages = gt.pages.map(p => p.image);
  const images = args.all ? listAllImages() : goldImages;

  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  const ai = buildAIClient();

  // 로그 침묵(파이프라인 내부 console.log) — 오류는 console.error 보존
  const origLog = console.log;
  console.log = () => {};

  // (image, runIdx) 작업 평탄화
  const jobs = [];
  for (let r = 0; r < args.runs; r++) {
    for (const img of images) jobs.push({ img, r });
  }

  const t0 = Date.now();
  let done = 0;
  const flat = await pool(jobs, args.concurrency, async ({ img, r }) => {
    const abs = path.join(TEST_IMAGE_ROOT, img);
    const jt0 = Date.now();
    try {
      const marks = await runPipelineOnImage({ ai, imagePath: abs });
      done++;
      console.error(`[${done}/${jobs.length}] OK r${r} ${img} (${Date.now() - jt0}ms, ${marks.length} marks)`);
      return { img, r, ok: true, marks };
    } catch (e) {
      done++;
      console.error(`[${done}/${jobs.length}] FAIL r${r} ${img}: ${e?.message}`);
      return { img, r, ok: false, error: e?.message, marks: [] };
    }
  });
  console.log = origLog;

  // 런별로 { image: marks[] } 재구성
  const runs = Array.from({ length: args.runs }, () => ({}));
  for (const f of flat) runs[f.r][f.img] = f.marks;

  // gold 채점 (전체 이미지를 돌렸어도 채점은 gold 페이지만)
  const goldRuns = runs.map(run => {
    const g = {};
    for (const img of goldImages) g[img] = run[img] || [];
    return g;
  });
  const scored = scoreMultiRun(gt, goldRuns);

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outPath = path.join(RESULTS_DIR, `${args.tag}-${stamp}.json`);
  const payload = {
    tag: args.tag, runs: args.runs, concurrency: args.concurrency, all: args.all,
    images, elapsedMs: Date.now() - t0,
    rawRuns: runs,
    agg: scored.agg,
    stability: scored.stability,
  };
  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2));

  // 콘솔 요약
  console.log('\n===== EVAL SUMMARY:', args.tag, '=====');
  console.log(`images=${images.length} runs=${args.runs} concurrency=${args.concurrency} elapsed=${(payload.elapsedMs / 1000).toFixed(1)}s`);
  console.log('mc_user   ', JSON.stringify(scored.agg.mc_user));
  console.log('mc_correct', JSON.stringify(scored.agg.mc_correct));
  console.log('text_user ', JSON.stringify(scored.agg.text_user));
  console.log('text_corr ', JSON.stringify(scored.agg.text_correct));
  console.log(`flaky_class=${scored.agg.flaky_class} flaky_pred=${scored.agg.flaky_pred} ever_wrong=${scored.agg.ever_wrong} always_wrong=${scored.agg.always_wrong}`);
  console.log('\n--- confident-wrong / flaky 인스턴스 ---');
  for (const s of scored.stability) {
    if (s.classes.includes('wrong') || s.flakyClass) {
      console.log(`${s.problem_number}.${s.field} [${path.basename(s.image)}] gt=${JSON.stringify(s.gt)} preds=${JSON.stringify(s.predCounts)} classes=${JSON.stringify(s.classCounts)}`);
    }
  }
  console.log('\nsaved:', outPath);
}

main().catch(e => { console.error('FATAL', e?.stack || e?.message); process.exit(1); });
