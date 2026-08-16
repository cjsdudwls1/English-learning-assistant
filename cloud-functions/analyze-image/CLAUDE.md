# CLAUDE.md — Cloud Function: analyze-image

영어 시험지 이미지를 Vertex AI(Gemini)로 분석해 문제·정답·사용자 답을 추출하고
Supabase에 저장하는 파이프라인. Cloud Run 함수 2개(publisher HTTP 엔드포인트 +
Pub/Sub worker)로 구성된다.

## 주요 파일

- `index.js` — 엔트리포인트 (publisher + worker 둘 다 이 파일에서 export)
- `shared/splitPipeline.js` — **현행 프로덕션 경로** (SPLIT_PIPELINE, 3-호출: 구조 → 학생답 ∥ 정답)
- `shared/simplePipeline.js` — 2스텝 경로 (SIMPLE_PIPELINE, 추출 → 채점). normalizeItem·dedupeByNumber는
  splitPipeline도 여기서 가져다 쓰므로 SPLIT 경로에서도 살아있는 코드다
- `shared/processPage.js`, `shared/pass0.js`/`passA.js`/`passB.js`/`passC.js` — 기존 다단계 Pass 경로 (롤백용 보존)
- `shared/config.js` — 모델·플래그 등 설정
- `shared/dbOperations.js` — Supabase 저장 (problems/labels insert)
- `eval/` — 평가 하네스 (`eval/harness/`), GT 라벨(`eval/labels/`), 결과(`eval/results/`)
- `.env.yaml` — 배포용 환경변수. **비밀 포함 — 내용 열람·출력·커밋 금지**

## 파이프라인 선택

- `SPLIT_PIPELINE` (**기본 ON, 프로덕션 가동 중**): 역할분리 3-호출(구조 → 학생답 ∥ 정답).
  SIMPLE_PIPELINE보다 우선한다. 이미지 입력 비용 3배. 끄려면 `SPLIT_PIPELINE=0`.
- `SIMPLE_PIPELINE` (기본 ON, SPLIT가 켜져 있으면 도달 안 함): 2스텝 단순 파이프라인
- `SIMPLE_PIPELINE=0` + `SPLIT_PIPELINE=0`: 기존 다단계 Pass 경로로 롤백

**주의 — 플래그를 env로만 켜지 말 것**: `deploy-worker.ps1`이 `--env-vars-file=.env.yaml`로
env를 통째로 대체하므로, `gcloud run services update --update-env-vars`로만 넣은 값은
다음 배포에서 조용히 사라진다. 상시로 켤 플래그는 이 파일(config.js)의 기본값을 뒤집는다.

## thinking 예산

`THINKING_BUDGET`(전역 env)은 지연 단축용 스위치다. prod에서 `0`이면 모든 호출의 thinking이
꺼져 추론 품질이 크게 떨어진다 — 특히 문제를 실제로 푸는 Call 3. splitPipeline은 이 전역값을
무시하고 `thinkingLevel: 'high'`를 명시한다. Pass C(분류)는 `'low'`.
`thinkingBudget`은 미지정=전역값, `null`=모델 기본(미전송), 숫자=그 값.
`thinkingLevel`(`'low'|'medium'|'high'`)이 주어지면 숫자 budget보다 우선한다.

## 모델 세대별 파라미터 — temperature는 3.6부터 안 먹는다

`gemini-3.6-flash`·`gemini-3.5-flash-lite`는 `temperature`/`top_p`/`top_k`를 **무시한다**.
공식 문서는 "Strip temperature, top_p, top_k from generation configs"라고 하고 이후 세대에서
400을 예고하지만, Vertex 실측(2026-08-16)상 지금은 400이 아니라 조용한 무시다:

| 모델 | `temperature: 0.0`로 6회 호출 |
|---|---|
| `gemini-3.5-flash` | 6/6 동일 (파라미터가 먹는다) |
| `gemini-3.6-flash` | 출력이 갈림 (먹지 않는다) |

**증상이 없는 게 이 함정의 핵심이다.** 400도 안 나고 로그도 정상이라, temperature를 보내는
코드로 되돌아가도 아무도 모른다. `aiClient.js`의 `NO_SAMPLING_PARAMS`가 세대를 보고 걸러내며,
`test/modelParams.test.mjs`가 이를 고정한다. **새 모델을 시퀀스에 추가할 때 그 목록도 갱신할 것.**

재현성이 필요하면 `seed`를 쓴다. 단 seed 단독으로는 부족하고 `thinkingLevel`과 **함께** 고정해야
잡힌다(실측: seed만 → 흔들림, seed+level:high → 10/10 동일). 공식 레퍼런스도 "mostly
deterministic"이라고만 한다 — 보장이 아니므로 **정확도 실측은 1회 결과로 판단하지 말 것**.

## 규칙

- 모델 호출은 Vertex AI(Gemini). API 키·비밀은 env로만 — 코드/문서에 커밋 금지
- 파이프라인 로직 변경 시 eval 하네스로 회귀 확인. 단, GT 라벨 정비 전이므로
  수치는 상대 비교(변경 전후)만 유효하고 절대 정확도 지표로 쓰지 않는다
- 프론트엔드가 소비하는 응답/DB 스키마(problems·labels 필드)를 바꿀 때는
  `English-learning-assistant/src/services/` 소비처를 함께 확인

## 배포

Google Cloud Run. GitHub Actions 자동배포 없음 — 수동 스크립트 실행:

- `deploy.ps1` / `deploy.sh` — publisher → worker 순차 전체 배포
- `deploy-image.ps1`, `deploy-worker.ps1` — 개별 배포
