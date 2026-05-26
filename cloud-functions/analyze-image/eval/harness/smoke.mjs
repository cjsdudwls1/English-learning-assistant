/** 단일 이미지 스모크 테스트: 러너가 marks를 정상 반환하는지 확인 */
import { loadEnvYaml } from './load-env.mjs';
loadEnvYaml();
const { buildAIClient, runPipelineOnImage } = await import('./pipeline-runner.mjs');

// 파이프라인 내부 로그 침묵(결과만 보기). 오류는 console.error로 보존.
const origLog = console.log;
console.log = () => {};

const imagePath = process.argv[2];
if (!imagePath) { origLog('usage: node smoke.mjs <imagePath>'); process.exit(1); }

const ai = buildAIClient();
const t0 = Date.now();
try {
  const marks = await runPipelineOnImage({ ai, imagePath });
  console.log = origLog;
  console.log(JSON.stringify({ imagePath, elapsedMs: Date.now() - t0, count: marks.length, marks }, null, 2));
} catch (e) {
  console.log = origLog;
  console.error('SMOKE FAIL:', e?.message, e?.stack);
  process.exit(1);
}
