#Requires -Version 5.1
<#
analyze-image GCF 배포 스크립트 (publisher / light - Windows PowerShell)
- 역할: HTTP 요청 수신 → 검증 → Pub/Sub publish (가벼움) + 에이전트 루프(mode:'agent')
- 무거운 분석 파이프라인은 analyze-worker에서 처리 (deploy-worker.ps1)
- Resource:
  --memory=512MiB    publish + auth + JSON 처리만 수행 (이미지 base64 미경유)
  --cpu=1            경량 작업이라 충분
  --timeout=300s     publish는 통상 수백 ms지만 mode:'agent'는 루프를 **요청 안에서** 끝낸다.
                     ↑ 아래 'cpu-throttling과 에이전트' 참고. timeout은 요청이 실제로 떠 있는
                       동안만 과금되므로 이 값을 올려도 유휴 비용은 0이다.
  --max-instances=20 30 동시 + 여유 (publish 빠르니 인스턴스 적게)
  --min-instances=0  idle 인스턴스 상시 과금 방지(필수). 부하테스트 때 수동으로 5+no-throttle로
                     바뀌어 수일간 과금된 적 있음 → 스크립트에 0을 명시해 재발 차단.
                     cpu-throttling은 functions deploy 기본값(throttled)이라 별도 설정 불필요.
  --concurrency=80   여러 publish를 동시에 처리 (CPU 부족 없음)

── cpu-throttling과 에이전트 (여기 건드리기 전에 읽을 것) ──
이 서비스는 cpu-throttling=true다. 스로틀 상태에서는 **응답을 flush한 뒤의 백그라운드 작업에
CPU가 할당되지 않는다** — setTimeout·await 이후가 사실상 멈춘다. 그래서 에이전트 루프는
fire-and-forget이 아니라 요청 안에서 끝난다(요청 처리 중엔 CPU 100% 할당).

--no-cpu-throttling으로 풀지 말 것: Cloud Scheduler가 4분마다 워밍업 핑을 넣어 인스턴스가
상시 살아있으므로, 스로틀을 풀면 1vCPU가 24/7 과금된다(월 $50 규모). 위 min-instances 사고와
같은 종류의 함정이다.

에이전트 예산(shared/agent/runtime.js DEFAULT_BUDGET_MS)은 이 --timeout보다 반드시 작아야
한다. test/agentBudget.test.mjs가 두 값을 같이 고정한다.
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
  --timeout=300s `
  --memory=512MiB `
  --cpu=1 `
  --max-instances=20 `
  --min-instances=0 `
  --concurrency=80 `
  --env-vars-file=.env.yaml `
  --format=none  # 성공 시 serviceConfig(secret 포함) stdout 덤프 차단

if (-not $?) { throw '배포 실패' }
Write-Host "[deploy-image] 완료"
