#!/usr/bin/env bash
# analyze-image GCF 배포 스크립트 (Linux/macOS/WSL)
# 30명 동시 부하 시나리오 대응:
#   --memory=2GiB      sharp 리사이즈 + Gemini 응답 누적 OOM 방지
#   --cpu=2            CPU 부족으로 인한 응답 지연 방지
#   --timeout=540s     600s 강제 SIGKILL 전 markSessionFailed 호출 여유 확보
#   --max-instances=20 quota 폭발 차단
#   --concurrency=1    인스턴스당 단일 요청 (이미지 분석은 CPU/메모리 집약적)
set -euo pipefail

PROJECT_ID='gen-lang-client-0516945872'
REGION='asia-northeast3'
FUNCTION_NAME='analyze-image'
ENTRY_POINT='analyzeImage'
RUNTIME='nodejs22'

echo "[deploy] 프로젝트 설정: $PROJECT_ID"
gcloud config set project "$PROJECT_ID"

echo "[deploy] 함수 배포 시작: $FUNCTION_NAME ($REGION)"
gcloud functions deploy "$FUNCTION_NAME" \
  --gen2 \
  --region="$REGION" \
  --runtime="$RUNTIME" \
  --entry-point="$ENTRY_POINT" \
  --source=. \
  --trigger-http \
  --allow-unauthenticated \
  --timeout=540s \
  --memory=2GiB \
  --cpu=2 \
  --max-instances=20 \
  --concurrency=1 \
  --env-vars-file=.env.yaml

echo "[deploy] 완료"
