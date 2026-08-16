// 기존 결과 json(rawRuns)에 라벨을 추가/확장해 재채점 (재실행 없이)
// 사용: node rescore.mjs <results.json> [extraLabel1.json ...]
//       node rescore.mjs <results.json> --gt draft-answerkey-2026-07-28.json   # 기준 라벨 교체
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scoreMultiRun } from './score.mjs';
import { takeGtPath } from './gt-path.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// --gt 를 먼저 떼어내야 위치 인자(results 경로·추가 라벨)와 섞이지 않는다.
const { gtPath, rest } = takeGtPath(process.argv.slice(2));
const covPath = rest[0];
const extraLabels = rest.slice(1);

const cov = JSON.parse(fs.readFileSync(covPath, 'utf8'));
const gt = JSON.parse(fs.readFileSync(gtPath, 'utf8'));
let pages = [...gt.pages];
for (const lp of extraLabels) {
  const e = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../labels/' + lp), 'utf8'));
  pages = pages.concat(e.pages);
}
const mergedGt = { pages };
const scored = scoreMultiRun(mergedGt, cov.rawRuns);

console.log(`# rescore ${path.basename(covPath)}  labels=${path.basename(gtPath, '.json')}+[${extraLabels.join(',')}]`);
console.log('mc_user   ', JSON.stringify(scored.agg.mc_user));
console.log('mc_correct', JSON.stringify(scored.agg.mc_correct));
console.log('multi_user', JSON.stringify(scored.agg.multi_user));
console.log('multi_corr', JSON.stringify(scored.agg.multi_correct));
console.log('blank_user', JSON.stringify(scored.agg.blank_user), ' cell', JSON.stringify(scored.agg.blank_cell_user));
console.log('blank_corr', JSON.stringify(scored.agg.blank_correct), ' cell', JSON.stringify(scored.agg.blank_cell_correct));
console.log('text_user ', JSON.stringify(scored.agg.text_user));
console.log('text_corr ', JSON.stringify(scored.agg.text_correct));
console.log(`flaky_class=${scored.agg.flaky_class} ever_wrong=${scored.agg.ever_wrong} always_wrong=${scored.agg.always_wrong}`);
if (scored.agg.multi_gt_invalid) console.log(`[경고] multi_gt_invalid=${scored.agg.multi_gt_invalid} — 복수정답 라벨에 user_answers/correct_answers 배열이 없어 채점 보류됨`);
if (scored.agg.blank_gt_invalid) console.log(`[경고] blank_gt_invalid=${scored.agg.blank_gt_invalid} — 다중빈칸 라벨에 user_answers/correct_answers 배열이 없어 채점 보류됨`);
console.log('\n-- wrong/flaky 인스턴스 (user + correct) --');
let any = false;
for (const s of scored.stability) {
  if (s.classes.includes('wrong') || s.flakyClass) {
    any = true;
    console.log(`${s.problem_number}.${s.field} [${path.basename(s.image)}] gt=${JSON.stringify(s.gt)} preds=${JSON.stringify(s.predCounts)} classes=${JSON.stringify(s.classCounts)}`);
  }
}
if (!any) console.log('(없음)');
