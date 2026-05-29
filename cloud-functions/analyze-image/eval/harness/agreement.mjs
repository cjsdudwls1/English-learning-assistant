/**
 * 대규모 A vs C′ 답안 일치도(agreement) 측정 — 라벨 불요.
 *
 * 목적: gold 5장(N=3)만으로는 correctSource='fullpage'(C′)가 'crop'(A)과 같은 결론을 내는지
 *       표본이 작다. 라벨 없이 test_image 전체에 A/C′를 돌려 문항별 답안 일치율을 측정한다.
 *   · correct_answer 가 A=C′ 면 풀페이지 전환이 크롭과 동일 결론 → 안전(비용만 절감).
 *   · 불일치 문항만 추출 → 소수를 수동 판정해 어느 쪽이 옳은지 확인(신뢰도 확보).
 *   · user_answer 는 양쪽 크롭 경로 공유라 거의 일치해야 정상(회귀 가드).
 *
 * 런 불안정성(temp=0에서도 흔들림)이 섞이므로 N=1 일치율은 '아키텍처 차이 + 노이즈'의 합.
 * 불일치 목록은 그 자체로 수동 판정 대상(아키텍처 차이인지 노이즈인지 포함).
 *
 * 사용:
 *   node eval/harness/agreement.mjs --concurrency 3 --tag agree
 *   node eval/harness/agreement.mjs --only "이어지는,정갈함" --tag agree-sublist
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GoogleGenAI } from '@google/genai';
import { loadEnvYaml } from './load-env.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_IMAGE_ROOT = path.resolve(__dirname, '../../../../test_image');
const RESULTS_DIR = path.resolve(__dirname, '../results');

function parseArgs(argv) {
  const a = { concurrency: 3, tag: 'agree', only: null };
  for (let i = 2; i < argv.length; i++) {
    const t = argv[i];
    if (t === '--concurrency') a.concurrency = parseInt(argv[++i], 10);
    else if (t === '--tag') a.tag = argv[++i];
    else if (t === '--only') a.only = argv[++i];
  }
  return a;
}

function buildAIClient() {
  const sa = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  const o = { vertexai: true, project: process.env.VERTEX_PROJECT_ID || 'gen-lang-client-0516945872', location: process.env.VERTEX_LOCATION || 'global' };
  if (sa) { try { o.googleAuthOptions = { credentials: JSON.parse(sa) }; } catch (e) { console.error('[agree] SA 파싱 실패:', e.message); } }
  return new GoogleGenAI(o);
}

function instrumentAI(ai) {
  const c = { calls: 0, promptTokens: 0, candTokens: 0, totalTokens: 0 };
  const models = ai.models;
  const orig = models.generateContent.bind(models);
  models.generateContent = async (params) => {
    const res = await orig(params);
    c.calls++;
    const u = res?.usageMetadata || res?.response?.usageMetadata;
    if (u) { c.promptTokens += u.promptTokenCount || 0; c.candTokens += u.candidatesTokenCount || 0; c.totalTokens += u.totalTokenCount || 0; }
    return res;
  };
  return c;
}

async function pool(items, limit, worker) {
  const results = new Array(items.length);
  let idx = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) { const i = idx++; if (i >= items.length) break; results[i] = await worker(items[i], i); }
  });
  await Promise.all(runners);
  return results;
}

function listAllImages() {
  const out = [];
  for (const dir of fs.readdirSync(TEST_IMAGE_ROOT)) {
    const full = path.join(TEST_IMAGE_ROOT, dir);
    if (!fs.statSync(full).isDirectory()) continue;
    for (const f of fs.readdirSync(full)) if (/\.(jpg|jpeg|png|webp)$/i.test(f)) out.push(`${dir}/${f}`);
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv);
  loadEnvYaml();
  const { runPipelineOnImage } = await import('./pipeline-runner.mjs');
  const { normalizeMC, normalizeProblemNum } = await import('./score.mjs');

  let images = listAllImages();
  if (args.only) {
    const keys = args.only.split(',').map(s => s.trim()).filter(Boolean);
    images = images.filter(img => keys.some(k => img.includes(k)));
  }
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  console.error(`[agree] 대상 이미지 ${images.length}장`);

  const origLog = console.log;
  const ARCHS = { A: 'crop', C: 'fullpage' };
  const out = {}; // out[arch] = { image: marks[] }
  const cost = {};

  for (const [key, src] of Object.entries(ARCHS)) {
    const ai = buildAIClient();
    const counter = instrumentAI(ai);
    let done = 0;
    console.log = () => {};
    const flat = await pool(images, args.concurrency, async (img) => {
      const abs = path.join(TEST_IMAGE_ROOT, img);
      const jt0 = Date.now();
      try {
        const marks = await runPipelineOnImage({ ai, imagePath: abs, correctSource: src });
        done++;
        console.error(`[${key} ${done}/${images.length}] OK ${path.basename(img)} (${Date.now() - jt0}ms, ${marks.length})`);
        return { img, marks };
      } catch (e) {
        done++;
        console.error(`[${key} ${done}/${images.length}] FAIL ${path.basename(img)}: ${e?.message}`);
        return { img, marks: [], error: e?.message };
      }
    });
    console.log = origLog;
    out[key] = {};
    for (const f of flat) out[key][f.img] = f.marks;
    cost[key] = { src, calls: counter.calls, perPage: +(counter.calls / images.length).toFixed(2), totalTokens: counter.totalTokens, tokPerPage: +(counter.totalTokens / images.length).toFixed(0) };
  }

  // ── 일치도 비교 ──
  const norm = v => (v == null || String(v).trim() === '') ? null : normalizeMC(v);
  let corrTotal = 0, corrMatch = 0, corrBothNonNull = 0, corrBothNonNullMatch = 0;
  let userTotal = 0, userMatch = 0;
  const corrDisagree = [];
  const userDisagree = [];

  for (const img of images) {
    const aM = out.A[img] || [], cM = out.C[img] || [];
    const aByN = new Map(aM.map(m => [normalizeProblemNum(m.problem_number), m]));
    const cByN = new Map(cM.map(m => [normalizeProblemNum(m.problem_number), m]));
    const nums = new Set([...aByN.keys(), ...cByN.keys()].filter(Boolean));
    for (const n of nums) {
      const a = aByN.get(n), c = cByN.get(n);
      const aC = norm(a?.correct_answer), cC = norm(c?.correct_answer);
      const aU = norm(a?.user_answer), cU = norm(c?.user_answer);
      // correct 일치 (MC만: 둘 다 1~5 숫자거나 null인 경우만 단순비교; 서술형 텍스트는 제외)
      const isMcLike = x => x == null || /^[1-5]$/.test(x);
      if (isMcLike(aC) && isMcLike(cC)) {
        corrTotal++;
        if (aC === cC) corrMatch++;
        else corrDisagree.push({ img: path.basename(img), num: n, A: aC, C: cC });
        if (aC != null && cC != null) { corrBothNonNull++; if (aC === cC) corrBothNonNullMatch++; }
      }
      if (isMcLike(aU) && isMcLike(cU)) {
        userTotal++;
        if (aU === cU) userMatch++;
        else userDisagree.push({ img: path.basename(img), num: n, A: aU, C: cU });
      }
    }
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outPath = path.join(RESULTS_DIR, `${args.tag}-${stamp}.json`);
  fs.writeFileSync(outPath, JSON.stringify({
    tag: args.tag, images: images.length, cost,
    correct: { total: corrTotal, match: corrMatch, rate: +(corrMatch / corrTotal).toFixed(4), bothNonNull: corrBothNonNull, bothNonNullMatch: corrBothNonNullMatch, bothNonNullRate: corrBothNonNull ? +(corrBothNonNullMatch / corrBothNonNull).toFixed(4) : null },
    user: { total: userTotal, match: userMatch, rate: +(userMatch / userTotal).toFixed(4) },
    corrDisagree, userDisagree,
    rawOut: out,
  }, null, 2));

  console.log(`\n===== AGREEMENT A(crop) vs C(fullpage): ${args.tag} =====`);
  console.log(`images=${images.length}`);
  console.log(`cost A: ${cost.A.perPage} calls/pg, ${cost.A.tokPerPage} tok/pg | C: ${cost.C.perPage} calls/pg, ${cost.C.tokPerPage} tok/pg`);
  console.log(`  → 호출 ${(100 * (1 - cost.C.perPage / cost.A.perPage)).toFixed(1)}% 절감, 토큰 ${(100 * (1 - cost.C.tokPerPage / cost.A.tokPerPage)).toFixed(1)}% 절감`);
  console.log(`correct MC 일치: ${corrMatch}/${corrTotal} (${(100 * corrMatch / corrTotal).toFixed(1)}%) | 둘다 non-null만: ${corrBothNonNullMatch}/${corrBothNonNull} (${corrBothNonNull ? (100 * corrBothNonNullMatch / corrBothNonNull).toFixed(1) : '-'}%)`);
  console.log(`user MC 일치: ${userMatch}/${userTotal} (${(100 * userMatch / userTotal).toFixed(1)}%)`);
  console.log(`\n--- correct 불일치 ${corrDisagree.length}건 (수동 판정 대상) ---`);
  for (const d of corrDisagree) console.log(`  Q${d.num} [${d.img}] A=${d.A} C=${d.C}`);
  console.log(`\n--- user 불일치 ${userDisagree.length}건 ---`);
  for (const d of userDisagree) console.log(`  Q${d.num} [${d.img}] A=${d.A} C=${d.C}`);
  console.log('\nsaved:', outPath);
}

main().catch(e => { console.error('FATAL', e?.stack || e?.message); process.exit(1); });
