#!/usr/bin/env bash
# analyze-worker GCF 배포 스크립트 (consumer / heavy - Linux/macOS/WSL)
# - 역할: analyze-jobs Pub/Sub topic 메시지 수신 → 이미지 분석 파이프라인 실행
# - Pub/Sub trigger (Eventarc) — at-least-once delivery
# Resource:
#   --memory=2GiB     sharp 리사이즈 + Gemini 응답 누적 OOM 방지
#   --cpu=2           Pass A/B 병렬 + JSON 파싱 CPU 부담
#   --timeout=540s    600s 강제 SIGKILL 전 markSessionFailed 호출 여유
#   --max-instances=40 30명 동시 + 여유 (Vertex AI quota 균형)
#   --concurrency=1   인스턴스당 단일 메시지 (분석 CPU/메모리 집약적)
#   --retry           Pub/Sub at-least-once + exponential backoff
set -euo pipefail

PROJECT_ID='gen-lang-client-0516945872'
REGION='asia-northeast3'
FUNCTION_NAME='analyze-worker'
ENTRY_POINT='analyzeWorker'
RUNTIME='nodejs22'
TOPIC='analyze-jobs'

echo "[deploy-worker] 프로젝트 설정: $PROJECT_ID"
gcloud config set project "$PROJECT_ID"

echo "[deploy-worker] worker 배포 시작: $FUNCTION_NAME ($REGION) trigger=$TOPIC"
gcloud functions deploy "$FUNCTION_NAME" \
  --gen2 \
  --region="$REGION" \
  --runtime="$RUNTIME" \
  --entry-point="$ENTRY_POINT" \
  --source=. \
  --trigger-topic="$TOPIC" \
  --retry \
  --timeout=540s \
  --memory=2GiB \
  --cpu=2 \
  --max-instances=40 \
  --concurrency=1 \
  --env-vars-file=.env.yaml \
  --format=none  # 성공 시 serviceConfig(secret 포함) stdout 덤프 차단

echo "[deploy-worker] 완료"
