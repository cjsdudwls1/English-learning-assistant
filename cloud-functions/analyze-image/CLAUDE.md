# CLAUDE.md — Cloud Function: analyze-image

영어 시험지 이미지를 Vertex AI(Gemini)로 분석해 문제·정답·사용자 답을 추출하고
Supabase에 저장하는 파이프라인. Cloud Run 함수 2개(publisher HTTP 엔드포인트 +
Pub/Sub worker)로 구성된다.

## 주요 파일

- `index.js` — 엔트리포인트 (publisher + worker 둘 다 이 파일에서 export)
- `shared/simplePipeline.js` — **현행 프로덕션 경로** (SIMPLE_PIPELINE, 2스텝: 추출 → 채점)
- `shared/processPage.js`, `shared/pass0.js`/`passA.js`/`passB.js`/`passC.js` — 기존 다단계 Pass 경로 (롤백용 보존)
- `shared/config.js` — 모델·플래그 등 설정
- `shared/dbOperations.js` — Supabase 저장 (problems/labels insert)
- `eval/` — 평가 하네스 (`eval/harness/`), GT 라벨(`eval/labels/`), 결과(`eval/results/`)
- `.env.yaml` — 배포용 환경변수. **비밀 포함 — 내용 열람·출력·커밋 금지**

## 파이프라인 선택

- `SIMPLE_PIPELINE=1` (기본, 프로덕션 가동 중): 2스텝 단순 파이프라인
- `SIMPLE_PIPELINE=0`: 기존 다단계 Pass 경로로 롤백

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
