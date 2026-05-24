#Requires -Version 5.1
<#
analyze-image GCF 배포 스크립트 (publisher / light - Windows PowerShell)
- 역할: HTTP 요청 수신 → 검증 → Pub/Sub publish (가벼움)
- 무거운 분석 파이프라인은 analyze-worker에서 처리 (deploy-worker.ps1)
- Resource:
  --memory=512MiB    publish + auth + JSON 처리만 수행 (이미지 base64 미경유)
  --cpu=1            경량 작업이라 충분
  --timeout=60s      Pub/Sub publish는 통상 수백 ms
  --max-instances=20 30 동시 + 여유 (publish 빠르니 인스턴스 적게)
  --min-instances=0  idle 인스턴스 상시 과금 방지(필수). 부하테스트 때 수동으로 5+no-throttle로
                     바뀌어 수일간 과금된 적 있음 → 스크립트에 0을 명시해 재발 차단.
                     cpu-throttling은 functions deploy 기본값(throttled)이라 별도 설정 불필요.
  --concurrency=80   여러 publish를 동시에 처리 (CPU 부족 없음)
#>
$ErrorActionPreference = 'Stop'

$PROJECT_ID = 'gen-lang-client-0516945872'
$REGION = 'asia-northeast3'
$FUNCTION_NAME = 'analyze-image'
$ENTRY_POINT = 'analyzeImage'
$RUNTIME = 'nodejs22'

Write-Host "[deploy-image] 프로젝트 설정: $PROJECT_ID"
gcloud config set project $PROJECT_ID
if (-not $?) { throw 'gcloud config set project 실패' }

Write-Host "[deploy-image] publisher 배포 시작: $FUNCTION_NAME ($REGION)"
gcloud functions deploy $FUNCTION_NAME `
  --gen2 `
  --region=$REGION `
  --runtime=$RUNTIME `
  --entry-point=$ENTRY_POINT `
  --source=. `
  --trigger-http `
  --allow-unauthenticated `
  --timeout=60s `
  --memory=512MiB `
  --cpu=1 `
  --max-instances=20 `
  --min-instances=0 `
  --concurrency=80 `
  --env-vars-file=.env.yaml

if (-not $?) { throw '배포 실패' }
Write-Host "[deploy-image] 완료"
