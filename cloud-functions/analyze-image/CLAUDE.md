# CLAUDE.md — Cloud Function: analyze-image

이 디렉토리는 Google Cloud Function (Node.js)으로 구현된 이미지 분석 파이프라인이다.

## 역할

영어 시험 이미지를 OCR로 분석하여 문제와 답(정답/사용자 답)을 추출한다.

## 주요 파일

- `index.js` — 메인 함수 (2-Pass 분석 로직)
- `shared/` — 공유 유틸리티
- `.env.yaml` — 환경변수 설정

## 분석 파이프라인 (2-Pass)

1. **Pass A**: 이미지에서 문제 텍스트와 선택지를 추출
2. **Pass B**: 정답과 사용자가 체크한 답을 추출
3. **병합**: 두 Pass 결과를 통합하여 최종 분석 결과 생성

## 규칙

- 이 디렉토리의 파일을 수정할 때 반드시 `.agents/workflows/이미지-분석-변경.md`를 먼저 읽을 것
- Vertex AI (Gemini) 모델 사용
- 테스트 방법: `.agents/workflows/이미지-분석-테스트.md` 참조

## 배포

Google Cloud Run에 배포. 자세한 절차: `.agents/workflows/배포.md`
