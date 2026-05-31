/**
 * is_correct 채점 시뮬레이션 (prod 동치)
 * - results/<tag>-<ts>.json 의 추출 marks를 prod와 동일한 computeIsCorrect()로 채점.
 * - ground-truth.json 의 expected_is_correct(실제 정오답)와 대조해 채점 정확도 측정.
 * - score.mjs(추출품질)와 직교: 여기선 "추출된 ua/ca로 채점한 결과가 실제 정오답과 맞는가"를 본다.
 *
 * 분류(precision-first 관점):
 *   - 정채점         : maj_sim === expected
 *   - false-negative : expected=true 인데 sim=false  (정답을 오답처리; baseline 12개)
 *   - false-positive : expected=false 인데 sim=true   (오답을 정답처리 = confident-wrong, 가장 해로움)
 *   - abstain-grade  : sim=null (ua/ca 한쪽 추출실패로 채점 보류; recall 손실, 비처벌)
 *   - missing        : 문항 자체가 추출 누락
 *
 * 사용:
 *   node simulate-grading.mjs                       # results 최신 파일 자동
 *   node simulate-grading.mjs --tag formfix         # 해당 tag 최신
 *   node simulate-grading.mjs --file results/x.json --only 정갈함
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeIsCorrect } from '../../shared/dbOperations.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GT_PATH = path.resolve(__dirname, '../labels/ground-truth.json');
const RESULTS_DIR = path.resolve(__dirname, '../results');

function parseArgs(argv) {
  const a = { only: null };
  for (let i = 2; i < argv.length; i++) {
    const t = argv[i];
    if (t === '--file') a.file = argv[++i];
    else if (t === '--only') a.only = argv[++i];
    else if (t === '--tag') a.tag = argv[++i];
  }
  return a;
}

function latestResult(tag) {
  const files = fs.readdirSync(RESULTS_DIR).filter(f => f.endsWith('.json') && (!tag || f.startsWith(tag)));
  if (!files.length) throw new Error(`results 없음 (tag=${tag || '*'})`);
  files.sort();
  return path.join(RESULTS_DIR, files[files.length - 1]);
}

const pn = (v) => (String(v ?? '').match(/\d+/) || [''])[0];
function tally(arr) { const m = {}; for (const x of arr) m[x] = (m[x] || 0) + 1; return m; }
function majority(arr) {
  const c = tally(arr.map(String));
  let best = null, bestN = -1;
  for (const [k, n] of Object.entries(c)) if (n > bestN) { best = k; bestN = n; }
  return best; // 'true' | 'false' | 'null' | 'MISSING'
}

const args = parseArgs(process.argv);
const file = args.file ? path.resolve(args.file) : latestResult(args.tag);
const payload = JSON.parse(fs.readFileSync(file, 'utf8'));
const gt = JSON.parse(fs.readFileSync(GT_PATH, 'utf8'));
const runs = payload.rawRuns || [];
const N = runs.length;

// expected_is_correct 라벨이 있는 문항만(없으면 시뮬 대상 아님)
const goldQ = [];
for (const p of gt.pages) {
  if (args.only && !p.image.includes(args.only)) continue;
  for (const q of p.questions) {
    if (typeof q.expected_is_correct === 'boolean') {
      goldQ.push({ image: p.image, problem_number: String(q.problem_number), expected: q.expected_is_correct });
    }
  }
}
if (!goldQ.length) throw new Error('expected_is_correct 라벨 문항이 없음 (ground-truth.json 확인)');

// 문항별 런별 시뮬 채점
const recs = goldQ.map(g => ({ ...g, sims: [], detail: [] }));
for (const run of runs) {
  for (const rec of recs) {
    const marks = run[rec.image] || [];
    const m = marks.find(x => pn(x.problem_number) === pn(rec.problem_number));
    let sim;
    if (!m) sim = 'MISSING';
    else sim = computeIsCorrect({
      user_marked_correctness: m.user_marked_correctness ?? null,
      user_answer: m.user_answer,
      correct_answer: m.correct_answer,
      choices: m.choices ?? [],
    });
    rec.sims.push(sim);
    rec.detail.push(m ? { ua: m.user_answer, ca: m.correct_answer, mark: m.user_marked_correctness ?? null } : null);
  }
}

// 집계
let correctGrade = 0, falseNeg = 0, falsePos = 0, abstainGrade = 0, missing = 0, flaky = 0;
const issues = [];
for (const rec of recs) {
  const uniq = new Set(rec.sims.map(String));
  rec.flaky = uniq.size > 1;
  if (rec.flaky) flaky++;
  const maj = majority(rec.sims);
  rec.maj = maj;
  const expStr = String(rec.expected);
  if (maj === 'MISSING') { missing++; rec.cls = 'missing'; }
  else if (maj === 'null') { abstainGrade++; rec.cls = 'abstain-grade'; }
  else if (maj === expStr) { correctGrade++; rec.cls = 'ok'; }
  else if (rec.expected === true && maj === 'false') { falseNeg++; rec.cls = 'FALSE-NEGATIVE'; }
  else if (rec.expected === false && maj === 'true') { falsePos++; rec.cls = 'FALSE-POSITIVE'; }
  if (rec.cls !== 'ok') issues.push(rec);
}

const total = recs.length;
console.log('\n===== GRADING SIMULATION (is_correct 정확도, prod computeIsCorrect 동치) =====');
console.log('file:', path.basename(file));
console.log(`runs=${N}  문항=${total}${args.only ? `  (filter: ${args.only})` : ''}`);
console.log(`\n정채점(maj_sim==expected): ${correctGrade}/${total}  (${(100 * correctGrade / total).toFixed(1)}%)`);
console.log(`  false-negative(정답→오답)         : ${falseNeg}  ${falseNeg ? '⚠' : '✓'}`);
console.log(`  false-positive(오답→정답,confident): ${falsePos}  ${falsePos ? '✗ 최악' : '✓'}`);
console.log(`  abstain-grade(sim=null, 비교보류)  : ${abstainGrade}`);
console.log(`  missing(추출 누락)                 : ${missing}`);
console.log(`flaky(런간 sim 변동)               : ${flaky}`);

if (issues.length) {
  console.log('\n--- 오채점/보류/누락 상세 ---');
  for (const r of issues) {
    const d = r.detail.find(Boolean);
    const uaca = d ? `ua=${JSON.stringify(d.ua)} ca=${JSON.stringify(d.ca)}${d.mark ? ` mark=${d.mark}` : ''}` : '(추출없음)';
    console.log(`[${r.cls}] ${path.basename(r.image)} Q${r.problem_number} expected=${r.expected} maj_sim=${r.maj} sims=${JSON.stringify(r.sims)}`);
    console.log(`         ${uaca}`);
  }
}
console.log(`\n(baseline 수정 전 prod: 정채점 28/40, false-negative 12)`);
