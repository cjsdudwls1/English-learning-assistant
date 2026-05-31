// 기존 결과 json(rawRuns)에 라벨을 추가/확장해 재채점 (재실행 없이)
// 사용: node rescore.mjs <results.json> [extraLabel1.json ...]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scoreMultiRun } from './score.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const covPath = process.argv[2];
const extraLabels = process.argv.slice(3);

const cov = JSON.parse(fs.readFileSync(covPath, 'utf8'));
const gt = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../labels/ground-truth.json'), 'utf8'));
let pages = [...gt.pages];
for (const lp of extraLabels) {
  const e = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../labels/' + lp), 'utf8'));
  pages = pages.concat(e.pages);
}
const mergedGt = { pages };
const scored = scoreMultiRun(mergedGt, cov.rawRuns);

console.log(`# rescore ${path.basename(covPath)}  labels=ground-truth+[${extraLabels.join(',')}]`);
console.log('mc_user   ', JSON.stringify(scored.agg.mc_user));
console.log('mc_correct', JSON.stringify(scored.agg.mc_correct));
console.log('text_user ', JSON.stringify(scored.agg.text_user));
console.log('text_corr ', JSON.stringify(scored.agg.text_correct));
console.log(`flaky_class=${scored.agg.flaky_class} ever_wrong=${scored.agg.ever_wrong} always_wrong=${scored.agg.always_wrong}`);
console.log('\n-- wrong/flaky 인스턴스 (user + correct) --');
let any = false;
for (const s of scored.stability) {
  if (s.classes.includes('wrong') || s.flakyClass) {
    any = true;
    console.log(`${s.problem_number}.${s.field} [${path.basename(s.image)}] gt=${JSON.stringify(s.gt)} preds=${JSON.stringify(s.predCounts)} classes=${JSON.stringify(s.classCounts)}`);
  }
}
if (!any) console.log('(없음)');
