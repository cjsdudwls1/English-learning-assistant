
위와같은 엣지펑션 로그이며 이미지 테스트 결과는 별첨 사진과 같음. 

실제론 사용자 답안=4,5,2 실제정답=5,3,5

테스트에 사용된 이미지는 'C:\cheon\cheon_wokespace\edu\test_image\이어지는 지문\KakaoTalk_20251202_101043325_07.jpg


1. Pass B를 Pass A와 병렬로 실행하도록 수정
2. Pass B를  buildOcrPrompt(imageCount)처럼 단순화 하라. 사용자 답안이랑 실제 문제정답만 체크하도록. 자연스럽게 pass c의 문제 정답 추론 프롬프트는 삭제하라. 근데 여러장 들어 갈 수 있으니 문제번호랑 매칭되도록 시켜야 ai가 안헷갈릴듯  
3. ai문제 생성 시 지문의 종류(대화, 기사, 인터뷰, 소설 등등) 도 선택 할 수 있도록 수정.
4. 현재 이미지 분석 및 분석 결과 저장 및 ui 출력 부분이 모두 객관식 문제에 맞춰져있는데 서술형, 주관식, o/x등등 모든 문제 유형을 지원하도록 수정하라.
5.  문제분석 카드에서 사용자 답안과 실제정답을 사용자가 직접 수정할 수 있도록 텍스트 박스로 나오도록 수정.
6. 새 페이지를 만들어서 등록한 모든 문제와 그정보를 쉽게 볼 수 있도록 하는 페이지 추가






정확도를 위한 추가 번외
7. https://docs.cloud.google.com/vertex-ai/generative-ai/docs/bounding-box-detection
바운딩 박스 디텍팅 가능하다는 제미나이 공식문서임

프롬프트("얼굴이 있는 양말의 위치를 찾아라...") -> 양말에 바운딩 박스가 그려진 이미지를 화면에 보여줌.

이거 응용하면 모든 부분(문제 추출, 사용자 답안 추출)에서 더 나아질 수 도

8. gpt왈

  1. 전처리

LLM보다 먼저 먹히는 경우가 많습니다.

deskew(기울기 보정)

contrast 강화

grayscale/binarization

빨간/파란 펜 stroke 강조

노이즈 제거

사용자 표시가 연필, 형광펜, 빨간 펜처럼 다양하면 전처리 유무 차이가 큽니다.
특히 “선택지 주변 미세 흔적”은 원본 그대로보다 강조본이 훨씬 잘 잡힙니다.

  2. 하이브리드 방식: CV/문서 OCR + LLM

이 작업은 “언어 이해”보다 “마크 탐지” 비중이 큽니다.
그래서 가장 강한 조합은 보통 이겁니다.

OCR/문서 구조 도구: 인쇄된 텍스트와 위치 잡기

간단한 CV: stroke, circle, checkmark 같은 시각 흔적 감지

LLM: 애매한 경우만 최종 판정

Google 쪽 문서 OCR 계열은 checkbox extraction, handwriting/font-style detection 같은 기능을 제공하고, 버전에 따라 동작을 고정(frozen version)해 일관성을 유지하는 옵션도 있습니다. 다만 너 케이스는 “체크박스 자체”보다 “①~⑤ 근처 자유형 필기”에 가까워서, Document AI 단독 해결책 보다는 보조 신호 로 보는 게 맞습니다.

실전 추천:

printed anchor 위치 = OCR/Pass A

실제 pen mark 여부 = CV/mark detector

최종 choice 연결 = LLM validator

이 3개를 섞으면 LLM 단독보다 안정적입니다.
