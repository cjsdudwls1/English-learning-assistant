/**
 * .env.yaml → process.env 로더 (로컬 eval 전용)
 * - 프로덕션은 gcloud가 .env.yaml을 환경변수로 주입한다. 로컬 하네스는 이 로더로 동일 환경을 재현.
 * - 단순 `KEY: value` 한 줄 단위 YAML만 파싱(이 프로젝트 .env.yaml 형식). 값의 따옴표를 제거한다.
 * - GOOGLE_SERVICE_ACCOUNT_JSON처럼 긴 단일 라인 JSON 값도 그대로 보존(내부 \n 이스케이프 유지).
 *
 * 보안: 이 값들(서비스계정 private key, service role key)은 절대 로그/출력하지 않는다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// eval/harness/ → analyze-image/.env.yaml
const DEFAULT_ENV_PATH = path.resolve(__dirname, '../../.env.yaml');

export function loadEnvYaml(envPath = DEFAULT_ENV_PATH) {
  if (!fs.existsSync(envPath)) {
    throw new Error(`[load-env] .env.yaml 없음: ${envPath}`);
  }
  const raw = fs.readFileSync(envPath, 'utf8');
  const lines = raw.split(/\r?\n/);
  const loaded = [];
  for (const line of lines) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*):[ \t]?(.*)$/);
    if (!m) continue;
    const key = m[1];
    let val = m[2];
    // 둘러싼 따옴표 제거 (single/double). single-quoted YAML의 '' 이스케이프 복원.
    if (val.length >= 2 && val[0] === "'" && val[val.length - 1] === "'") {
      val = val.slice(1, -1).replace(/''/g, "'");
    } else if (val.length >= 2 && val[0] === '"' && val[val.length - 1] === '"') {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = val;
      loaded.push(key);
    }
  }
  // 키 이름만 로그(값 절대 출력 금지)
  console.error(`[load-env] 로드된 키: ${loaded.join(', ')}`);
  return loaded;
}
