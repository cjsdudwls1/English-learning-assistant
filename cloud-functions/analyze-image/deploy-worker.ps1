#Requires -Version 5.1
<#
analyze-worker GCF 배포 스크립트 (consumer / heavy - Windows PowerShell)
- 역할: analyze-jobs Pub/Sub topic 메시지 수신 → 이미지 분석 파이프라인 실행
- Pub/Sub trigger (Eventarc) — at-least-once delivery
- Resource:
  --memory=2GiB     sharp 리사이즈 + Gemini 응답 누적 OOM 방지
  --cpu=2           Pass A/B 병렬 + JSON 파싱 CPU 부담
  --timeout=540s    600s 강제 SIGKILL 전 markSessionFailed 호출 여유
  --max-instances=60 30명×3장=90건 동시 + 50명까지 헤드룸 (Vertex AI quota 균형)
  --concurrency=1   인스턴스당 단일 메시지 (분석 CPU/메모리 집약적)
  --retry           Pub/Sub at-least-once + exponential backoff (transient error 재시도)
  NOTE: startup-cpu-boost는 functions deploy 플래그가 없어 별도 적용 →
        gcloud run services update analyze-worker --region=asia-northeast3 --cpu-boost
        (gen2 deploy는 기존 run 설정을 보존하므로 한 번 켜두면 재배포 후에도 유지)
  NOTE: min-instances 미지정=0 유지 (idle 과금 0). cold라도 30명 100% 성공 실측됨(2026-05-24).
#>
$ErrorActionPreference = 'Stop'

$PROJECT_ID = 'gen-lang-client-0516945872'
$REGION = 'asia-northeast3'
$FUNCTION_NAME = 'analyze-worker'
$ENTRY_POINT = 'analyzeWorker'
$RUNTIME = 'nodejs22'
$TOPIC = 'analyze-jobs'

Write-Host "[deploy-worker] 프로젝트 설정: $PROJECT_ID"
gcloud config set project $PROJECT_ID
if (-not $?) { throw 'gcloud config set project 실패' }

Write-Host "[deploy-worker] worker 배포 시작: $FUNCTION_NAME ($REGION) trigger=$TOPIC"
gcloud functions deploy $FUNCTION_NAME `
  --gen2 `
  --region=$REGION `
  --runtime=$RUNTIME `
  --entry-point=$ENTRY_POINT `
  --source=. `
  --trigger-topic=$TOPIC `
  --retry `
  --timeout=540s `
  --memory=2GiB `
  --cpu=2 `
  --max-instances=60 `
  --concurrency=1 `
  --env-vars-file=.env.yaml

if (-not $?) { throw '배포 실패' }
Write-Host "[deploy-worker] 완료"
