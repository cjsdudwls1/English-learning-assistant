#!/usr/bin/env bash
# analyze-image + analyze-worker 통합 배포 wrapper (Linux/macOS/WSL)
# - Phase 3 이후 publisher/worker 분리 아키텍처
# - 순차 배포 (publisher 먼저 → worker 나중)
# - 개별 배포: deploy-image.sh / deploy-worker.sh
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo '[deploy] 1/2 publisher (analyze-image) 배포'
bash "$SCRIPT_DIR/deploy-image.sh"

echo '[deploy] 2/2 worker (analyze-worker) 배포'
bash "$SCRIPT_DIR/deploy-worker.sh"

echo '[deploy] 전체 완료'
