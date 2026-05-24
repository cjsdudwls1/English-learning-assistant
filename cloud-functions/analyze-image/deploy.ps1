#Requires -Version 5.1
<#
analyze-image + analyze-worker 통합 배포 wrapper (Windows PowerShell)
- Phase 3 이후 publisher/worker 분리 아키텍처
- 둘을 순차 배포 (publisher 먼저 → worker 나중. 신규 토픽 메시지 처리 가능 시점 보장)
- 개별 배포: deploy-image.ps1 / deploy-worker.ps1
#>
$ErrorActionPreference = 'Stop'
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

Write-Host '[deploy] 1/2 publisher (analyze-image) 배포'
& "$scriptDir\deploy-image.ps1"
if (-not $?) { throw 'analyze-image 배포 실패' }

Write-Host '[deploy] 2/2 worker (analyze-worker) 배포'
& "$scriptDir\deploy-worker.ps1"
if (-not $?) { throw 'analyze-worker 배포 실패' }

Write-Host '[deploy] 전체 완료'
