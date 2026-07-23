/**
 * 단일 호출 베이스라인 (Gemini 3.6 Flash only)
 *
 * 목적: 현재 4-Pass 파이프라인(Pass A 구조 + Pass 0 bbox + 크롭 + Pass B 필기 + Pass C 분류
 *      + Document AI Pre-OCR + 모델 폴백 시퀀스 + 교차뷰 등)이 오버스펙인지 측정.
 *
 * 비교 대상:
 *  - prod 파이프라인 결과는 run-eval.mjs 의 결과와 동일 채점기로 정렬.
 *  - 본 스크립트는 동일 골드 5장에 대해 Gemini 3.6 Flash 단일 호출만 사용.
 *    · pass 분리 X · Document AI X · bbox/크롭 X · 모델 폴백 X · 교차뷰 X
 *    · 전처리(preprocessImage, 긴변 1200px)와 채점기는 동일(공정 비교).
 *
 * 사용:
 *   node eval/harness/baseline-single-call.mjs --runs 1 --tag gemini-only
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GoogleGenAI } from '@google/genai';
import { loadEnvYaml } from './load-env.mjs';
import { VERTEX_PROJECT_ID, VERTEX_LOCATION } from '../../shared/config.js';
import { preprocessImage } from '../../shared/imagePreprocessor.js';
import { scoreMultiRun } from './score.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GT_PATH = path.resolve(__dirname, '../labels/ground-truth.json');
const TEST_IMAGE_ROOT = path.resolve(__dirname, '../../../../test_image');
const RESULTS_DIR = path.resolve(__dirname, '../results');

export const MODEL = 'gemini-3.6-flash';

// 통합 프롬프트 — 단일 호출로 problem_number + user_answer + correct_answer 추출.
// prod 의 buildHandwritingDetectionPrompt 와 의도/규칙 동일(원형 → ASCII, X/O 분별,
// confident-wrong 회피, 서술형 verbatim). Pass A 구조 단계가 없으므로 problem_number 도
// 같은 응답에서 직접 읽도록 지시.
const SINGLE_CALL_PROMPT = `
<role>You are an expert exam-paper analyzer reading a Korean high-school English exam page image.</role>

<task>
Scan the ENTIRE page (Korean exam pages often have TWO COLUMNS — left and right).
For EVERY printed problem number visible on the page, return one entry with:
  1. problem_number — the printed bold number that starts the question (e.g. "22", "28").
  2. user_answer    — what the student physically wrote/marked on paper (or null if no mark).
  3. correct_answer — your independent solution of the question.
Never skip a printed problem number. Count them carefully and verify nothing is missed.
</task>

<answer_format>
- Multiple choice (①②③④⑤ or numbered 1-5 choices):
  · Return the choice NUMBER as a plain ASCII digit "1"-"5".
  · NEVER output a circled glyph (①②③④⑤). Convert ①→"1" … ⑤→"5".
- Underline-type multiple choice (다음 글의 밑줄 친 부분 중 …):
  · correct_answer = the choice NUMBER ("1"-"5") of the underlined item, NOT the word.
- Short answer / essay (서술형):
  · user_answer = transcribe the handwritten text VERBATIM (preserve spelling errors).
    If you see a correction arrow (→), report ONLY the text after the arrow.
  · correct_answer = your solved correct text.
- If no handwritten mark for a question → user_answer: null.
</answer_format>

<critical_rules>
- user_answer comes from the PHYSICAL pencil/pen mark only — never copy correct_answer into it.
- correct_answer is your independent solution — never copy user_answer into it.
- Grading-mark disambiguation: a student may self-grade AFTER the exam. If on ONE problem you
  see BOTH an X mark on one number AND an O/circle on a DIFFERENT number, the X-marked number
  = user_answer (original choice); the O-marked number = correct (do NOT report O as user_answer).
  If marks are only on ONE number with no X, that number IS user_answer.
- user_answer precision: if a mark seems present but you cannot confidently tell which single
  choice it sits on (faint, ambiguous, spanning two numbers) → return null. A wrong answer is
  worse than null. Only commit "1"-"5" when you can clearly identify the marked choice.
- For sentence-insertion / ordering / grammar / vocabulary-underline questions the answer is
  the CHOICE NUMBER (①②③④⑤ → "1"-"5"), NOT a sentence excerpt from the passage.
- Report ALL problems visible on the page exactly once.
</critical_rules>

<output>
JSON only (no markdown). The values below are illustrative placeholders — solve each problem
to get the real value; do NOT default to any single number:
{
  "marks": [
    { "problem_number": "22", "user_answer": "3", "correct_answer": "5" },
    { "problem_number": "23", "user_answer": null, "correct_answer": "2" },
    { "problem_number": "6",  "user_answer": "cutting", "correct_answer": "cutting" }
  ]
}
</output>
`;

function parseArgs(argv) {
  const a = { runs: 1, tag: 'gemini-only', concurrency: 3 };
  for (let i = 2; i < argv.length; i++) {
    const t = argv[i];
    if (t === '--runs') a.runs = parseInt(argv[++i], 10);
    else if (t === '--tag') a.tag = argv[++i];
    else if (t === '--concurrency') a.concurrency = parseInt(argv[++i], 10);
  }
  return a;
}

function buildAIClient() {
  const serviceAccountJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  const aiOptions = { vertexai: true, project: VERTEX_PROJECT_ID, location: VERTEX_LOCATION };
  if (serviceAccountJson) {
    try {
      aiOptions.googleAuthOptions = { credentials: JSON.parse(serviceAccountJson) };
    } catch (e) {
      console.error('[baseline] GOOGLE_SERVICE_ACCOUNT_JSON 파싱 실패, ADC 폴백:', e.message);
    }
  }
  return new GoogleGenAI(aiOptions);
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

const EXT_TO_MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };

export async function runSingleCall({ ai, imagePath }) {
  const buf = fs.readFileSync(imagePath);
  const ext = path.extname(imagePath).toLowerCase();
  const mimeType = EXT_TO_MIME[ext] || 'image/jpeg';
  const pre = await preprocessImage(buf.toString('base64'), mimeType);

  const parts = [
    { text: SINGLE_CALL_PROMPT },
    { inlineData: { data: pre.imageBase64, mimeType: pre.mimeType } },
  ];

  const TIMEOUT_MS = 90_000;
  let timeoutHandle;
  const timeoutP = new Promise((_, reject) => {
    timeoutHandle = setTimeout(() => reject(new Error(`timeout ${TIMEOUT_MS}ms`)), TIMEOUT_MS);
  });
  let response;
  try {
    response = await Promise.race([
      ai.models.generateContent({
        model: MODEL,
        contents: [{ role: 'user', parts }],
        config: { temperature: 0.0, responseMimeType: 'application/json' },
        safetySettings: [
          { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
        ],
      }),
      timeoutP,
    ]);
  } finally {
    clearTimeout(timeoutHandle);
  }

  let text = '';
  if (response?.text) text = typeof response.text === 'function' ? response.text() : response.text;
  else if (response?.candidates?.[0]?.content?.parts?.[0]?.text) text = response.candidates[0].content.parts[0].text;
  else throw new Error('빈 응답');

  const cleaned = text.replace(/```json/g, '').replace(/```/g, '').trim();
  let parsed;
  try { parsed = JSON.parse(cleaned); }
  catch (e) {
    throw new Error(`JSON 파싱 실패: ${e?.message} | head=${cleaned.slice(0, 200)}`);
  }
  const marks = Array.isArray(parsed?.marks) ? parsed.marks : (Array.isArray(parsed) ? parsed : []);

  const CIRCLED = { '①': '1', '②': '2', '③': '3', '④': '4', '⑤': '5' };
  const norm = (v) => {
    if (v == null) return null;
    let s = String(v);
    for (const [g, d] of Object.entries(CIRCLED)) if (s.includes(g)) s = s.split(g).join(d);
    return s;
  };
  return marks.map(m => ({
    problem_number: String(m.problem_number ?? '').trim(),
    user_answer: norm(m.user_answer ?? null),
    correct_answer: norm(m.correct_answer ?? null),
  }));
}

async function main() {
  const args = parseArgs(process.argv);
  loadEnvYaml();
  const ai = buildAIClient();
  const gt = JSON.parse(fs.readFileSync(GT_PATH, 'utf8'));
  const images = gt.pages.map(p => p.image);

  fs.mkdirSync(RESULTS_DIR, { recursive: true });

  const jobs = [];
  for (let r = 0; r < args.runs; r++) for (const img of images) jobs.push({ img, r });

  const t0 = Date.now();
  let done = 0;
  const flat = await pool(jobs, args.concurrency, async ({ img, r }) => {
    const abs = path.join(TEST_IMAGE_ROOT, img);
    const jt0 = Date.now();
    try {
      const marks = await runSingleCall({ ai, imagePath: abs });
      done++;
      console.error(`[${done}/${jobs.length}] OK r${r} ${img} (${Date.now() - jt0}ms, ${marks.length} marks)`);
      return { img, r, ok: true, marks };
    } catch (e) {
      done++;
      console.error(`[${done}/${jobs.length}] FAIL r${r} ${img}: ${e?.message}`);
      return { img, r, ok: false, error: e?.message, marks: [] };
    }
  });

  const runs = Array.from({ length: args.runs }, () => ({}));
  for (const f of flat) runs[f.r][f.img] = f.marks;
  const scored = scoreMultiRun(gt, runs);

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outPath = path.join(RESULTS_DIR, `${args.tag}-${stamp}.json`);
  fs.writeFileSync(outPath, JSON.stringify({
    tag: args.tag, model: MODEL, runs: args.runs, concurrency: args.concurrency,
    images, elapsedMs: Date.now() - t0,
    rawRuns: runs,
    agg: scored.agg,
    stability: scored.stability,
  }, null, 2));

  console.log('\n===== EVAL SUMMARY:', args.tag, '=====');
  console.log(`model=${MODEL} images=${images.length} runs=${args.runs} elapsed=${((Date.now() - t0) / 1000).toFixed(1)}s`);
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

// 직접 실행 시에만 main() 구동. compare.mjs 등에서 import 할 때는 실행하지 않는다.
import { pathToFileURL } from 'node:url';
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) main().catch(e => { console.error('FATAL', e?.stack || e?.message); process.exit(1); });
