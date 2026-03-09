---
name: cloudinary-usage
description: Cloudinary Usage API를 사용하여 잔여 저장 용량, 크레딧, 대역폭 등 사용량을 확인하는 스킬. Cloudinary 용량 확인, 스토리지 잔여량, 크레딧 사용량, 대역폭 체크 등 Cloudinary 리소스 상태를 확인하고 싶을 때 이 스킬을 사용한다. 'Cloudinary 용량', '저장 공간', '크레딧 확인', 'usage' 등의 키워드가 포함된 요청에서도 반드시 이 스킬을 참조한다.
---

# Cloudinary Usage API 사용량 확인 스킬

Cloudinary의 Admin API 중 Usage 엔드포인트를 호출하여 현재 계정의 저장 용량, 크레딧, 대역폭, 리소스 수, 변환 횟수 등을 확인하는 방법을 정리한 스킬이다.

## 사전 조건

다음 3가지 환경 변수가 프로젝트에 설정되어 있어야 한다:

| 환경 변수 | 설명 | 예시 |
|-----------|------|------|
| `NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME` | Cloudinary Cloud 이름 | `dpaqhv0ay` |
| `CLOUDINARY_API_KEY` | API 키 | `263768268812658` |
| `CLOUDINARY_API_SECRET` | API 시크릿 | `kMxXSRHRkFeohzRa6Fp-F0zlsCA` |

일반적으로 `.env.local` 또는 `.env` 파일에 저장되어 있다.

## API 엔드포인트

```
GET https://api.cloudinary.com/v1_1/{cloud_name}/usage
```

- 인증 방식: **HTTP Basic Auth** (`API_KEY:API_SECRET`)
- 응답 형식: JSON

## 확인 절차

### 1단계: 환경 변수 확인

프로젝트의 `.env.local` 또는 `.env` 파일에서 Cloudinary 인증 정보를 찾는다.

```bash
grep -i "CLOUDINARY" .env.local
```

### 2단계: Usage API 호출

Windows PowerShell 환경에서는 `curl.exe`를 명시적으로 사용해야 한다. PowerShell의 `curl`은 `Invoke-WebRequest`의 별칭이므로 `-u` 옵션이 동작하지 않는다.

```bash
curl.exe -s -u {API_KEY}:{API_SECRET} https://api.cloudinary.com/v1_1/{CLOUD_NAME}/usage
```

### 3단계: 결과를 보기 좋게 파싱

Node.js를 사용하여 JSON 응답을 사람이 읽기 좋은 형태로 출력한다.

```bash
curl.exe -s -u {API_KEY}:{API_SECRET} https://api.cloudinary.com/v1_1/{CLOUD_NAME}/usage | node -e "
const c=[];
process.stdin.on('data',d=>c.push(d));
process.stdin.on('end',()=>{
  const j=JSON.parse(Buffer.concat(c).toString());
  console.log('=== Cloudinary 사용량 현황 ===');
  console.log('플랜:', j.plan);
  console.log('기준일:', j.last_updated);
  console.log('');
  console.log('--- 저장 용량 (Storage) ---');
  console.log('사용량:', (j.storage?.usage / 1024 / 1024).toFixed(2), 'MB');
  console.log('크레딧 소모:', j.storage?.credits_usage);
  console.log('');
  console.log('--- 대역폭 (Bandwidth) ---');
  console.log('사용량:', (j.bandwidth?.usage / 1024 / 1024).toFixed(2), 'MB');
  console.log('크레딧 소모:', j.bandwidth?.credits_usage);
  console.log('');
  console.log('--- 크레딧 (Credits) ---');
  console.log('사용:', j.credits?.usage?.toFixed(2), '/', j.credits?.limit?.toFixed(2));
  console.log('사용률:', j.credits?.used_percent?.toFixed(2) + '%');
  console.log('잔여:', (j.credits?.limit - j.credits?.usage)?.toFixed(2));
  console.log('');
  console.log('--- 리소스 ---');
  console.log('총 리소스:', j.resources, '개');
  console.log('변환 횟수:', j.transformations?.usage);
  console.log('요청 수:', j.requests);
  console.log('');
  console.log('--- 업로드 제한 ---');
  console.log('이미지 최대:', (j.media_limits?.image_max_size_bytes / 1024 / 1024), 'MB');
  console.log('동영상 최대:', (j.media_limits?.video_max_size_bytes / 1024 / 1024), 'MB');
});
"
```

## API 응답 구조

```json
{
  "plan": "Free",
  "last_updated": "2026-03-02",
  "storage": {
    "usage": 191831997,        // 바이트 단위
    "credits_usage": 0.18
  },
  "bandwidth": {
    "usage": 272774086,        // 바이트 단위
    "credits_usage": 0.25
  },
  "credits": {
    "usage": 0.45,             // 사용한 크레딧
    "limit": 25,               // 전체 크레딧 한도
    "used_percent": 1.8        // 사용 비율 (%)
  },
  "resources": 74,             // 저장된 리소스 수
  "transformations": {
    "usage": 24,
    "credits_usage": 0.02
  },
  "requests": 86,
  "media_limits": {
    "image_max_size_bytes": 10485760,   // 10 MB
    "video_max_size_bytes": 104857600,  // 100 MB
    "raw_max_size_bytes": 10485760,     // 10 MB
    "image_max_px": 25000000,
    "asset_max_total_px": 50000000
  }
}
```

## 플랜별 크레딧 한도

| 플랜 | 월간 크레딧 | 저장 용량 | 대역폭 |
|------|------------|----------|--------|
| **Free** | 25 크레딧 | 크레딧 기반 | 크레딧 기반 |
| **Plus** | 225 크레딧 | 크레딧 기반 | 크레딧 기반 |
| **Advanced** | 별도 협의 | 별도 협의 | 별도 협의 |

Free 플랜에서는 저장 용량과 대역폭에 별도의 GB 한도가 없고, **크레딧 기반**으로 통합 관리된다. 따라서 잔여 용량 확인 시 `credits.usage`와 `credits.limit`을 비교하는 것이 핵심이다.

## 크레딧 소모 기준 (Free 플랜)

| 항목 | 1 크레딧당 |
|------|-----------|
| 저장 용량 | ~1 GB |
| 대역폭 | ~1 GB |
| 변환 | ~1,000회 |
| 이미지 노출 | ~10,000회 |

## 주의 사항

1. **Windows PowerShell에서는 반드시 `curl.exe`를 사용해야 한다.** `curl`은 `Invoke-WebRequest`의 별칭이므로 `-u` 옵션을 인식하지 못한다.
2. **`last_updated` 필드**는 사용량 데이터의 마지막 갱신 시점이다. 실시간이 아니라 일 단위로 갱신될 수 있다.
3. **API 호출 자체도 `requests` 카운트에 포함**되므로 너무 자주 호출하지 않는다.
4. 환경 변수에 API Secret이 포함되어 있으므로 **로그나 콘솔 출력에 시크릿이 노출되지 않도록** 주의한다.
