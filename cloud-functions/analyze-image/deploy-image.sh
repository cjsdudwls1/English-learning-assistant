#!/usr/bin/env bash
# analyze-image GCF 배포 스크립트 (publisher / light - Linux/macOS/WSL)
# - 역할: HTTP 요청 수신 → 검증 → Pub/Sub publish (가벼움)
# - 무거운 분석 파이프라인은 analyze-worker에서 처리 (deploy-worker.sh)
# Resource:
#   --memory=512MiB    publish + auth + JSON 처리만 수행
#   --cpu=1            경량 작업
#   --timeout=60s      Pub/Sub publish는 수백 ms 수준
#   --max-instances=20 30 동시 + 여유
#   --concurrency=80   여러 publish 동시 처리
set -euo pipefail

PROJECT_ID='gen-lang-client-0516945872'
REGION='asia-northeast3'
FUNCTION_NAME='analyze-image'
ENTRY_POINT='analyzeImage'
RUNTIME='nodejs22'

echo "[deploy-image] 프로젝트 설정: $PROJECT_ID"
gcloud config set project "$PROJECT_ID"

echo "[deploy-image] publisher 배포 시작: $FUNCTION_NAME ($REGION)"
gcloud functions deploy "$FUNCTION_NAME" \
  --gen2 \
  --region="$REGION" \
  --runtime="$RUNTIME" \
  --entry-point="$ENTRY_POINT" \
  --source=. \
  --trigger-http \
  --allow-unauthenticated \
  --timeout=60s \
  --memory=512MiB \
  --cpu=1 \
  --max-instances=20 \
  --concurrency=80 \
  --env-vars-file=.env.yaml \
  --format=none  # 성공 시 serviceConfig(secret 포함) stdout 덤프 차단

echo "[deploy-image] 완료"
