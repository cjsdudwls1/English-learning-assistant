
# 작업: 이미지 분석 파이프라인의 주관식 문제 디텍팅 정확도 개선

## 핵심 문제
현재 이미지 분석(cloud-functions/analyze-image/)에서 **주관식(서술형) 문제의 user_answer, correct_answer 디텍팅이 부정확**하다.
객관식(1~5번 선택)은 어느정도 되지만, 서술형 답안(예: "cutting", "Are", "aren't going to clean the streets after school" 등)의 인식이 잘 안된다.

참고로 **제미나이 웹(gemini.google.com)에 같은 이미지를 던지고 "OCR해"라고만 해도 완벽하게 읽어내는데**, 우리 앱의 API 호출에서는 안 되는 상황이다. 이것은 프롬프트가 너무 복잡하거나, 멀티패스 파이프라인의 구조적 문제일 가능성이 있다.

## 프로젝트 컨텍스트

### 아키텍처 개요
- **프로젝트**: 영어 시험 이미지 → OCR → 문제/답안 추출 → DB 저장하는 React PWA 앱
- **이미지 분석**: Google Cloud Function (Node.js 22, ESM) — `cloud-functions/analyze-image/`
- **AI 모델**: Vertex AI (Gemini) — `@google/genai` SDK 사용
- **DB**: Supabase (PostgreSQL)

### 파이프라인 구조 (4-Pass)
```
Pass A (구조추출) + Pass 0 (bbox좌표) → 병렬 실행
    → 이미지 크롭
    → Pass B (필기인식: user_answer + correct_answer)
    → Pass C (분류: classification + metadata)
```

### 핵심 파일 (수정 대상)
| 파일 | 역할 |
|------|------|
| `cloud-functions/analyze-image/index.js` | 메인 오케스트레이터, processPage(), mergeHandwritingMarks() |
| `cloud-functions/analyze-image/shared/prompts.js` | 모든 프롬프트 (buildStructurePrompt, buildHandwritingDetectionPrompt, buildCroppedUserAnswerPrompt, buildCroppedCorrectAnswerPrompt 등) |
| `cloud-functions/analyze-image/shared/passes.js` | Pass A/0/B/C 실행 로직, executePassBFullImage() |
| `cloud-functions/analyze-image/shared/config.js` | 모델 시퀀스, 타임아웃, 스키마 설정 |
| `cloud-functions/analyze-image/shared/aiClient.js` | 모델 호출, failover, JSON 파싱 |

### 테스트 방법
```bash
cd cloud-functions/analyze-image
node test-analyze.js "<이미지경로>" "<기대_사용자답안>" "<기대_실제답안>"
```
- 종료코드 0 = PASS, 1 = FAIL, 2 = 스크립트 오류
- `--verbose` 플래그로 각 Pass의 원시 JSON 확인 가능

### 테스트 케이스 (반드시 이것으로 검증)

**테스트 이미지 및 라벨 (정답 기준)**: `테스트용 이미지 라벨.md` 참조

## 작업 지시

### 반복 루프
1. 현재 코드로 테스트 실행 → 결과 확인
2. 문제점 분석 (특히 `--verbose`로 각 Pass 원시 응답 확인)
3. **스스로 가설을 세우고**, 그에 맞는 수정을 시도
4. 테스트 재실행 → 결과 비교
5. **PASS될 때까지 1~4 반복**

### 수정 범위 (완전 개방)

**제한 없이, 네가 효과적이라고 판단하는 모든 수정을 자유롭게 시도하라.**

수정 가능한 영역은  **프로젝트 내 어떤 부분이든 상관없다.**  
특정 접근법을 여기서 지정하지 않는다. 네가 `--verbose` 결과와 코드를 직접 분석하여, **실제 병목이 어디인지 스스로 파악**하고, 그에 맞는 해결책을 **자율적으로 설계하고 실험**하라.

#### 핵심 원칙
1. **데이터 기반 판단**: 감으로 수정하지 말고, `--verbose` 원시 응답을 분석해서 "어디서 정보가 누락/왜곡되는지"를 먼저 특정한 뒤 수정하라.
2. **다양한 관점에서 접근**: 한 가지 방향(예: 프롬프트만 계속 고치기)에 매달리지 말 것. 프롬프트가 문제가 아닐 수도 있다. 구조, 모델, 후처리, 심지어 이미지 전처리까지 모든 가능성을 열어둬라.
3. **대담한 실험 허용**: 기존 파이프라인을 전면 재설계하는 것도, 완전히 새로운 접근을 시도하는 것도 괜찮다. 실험이 실패하면 되돌리면 된다.
4. **교착 상태 탈출**: 동일 부분을 3회 이상 수정해도 개선이 없으면, 반드시 완전히 다른 접근법으로 전환하라. 같은 방향을 고집하지 말 것.

#### 참고 사실 (힌트일 뿐, 이것에 국한되지 말 것)
- 제미나이 웹(gemini.google.com)에 같은 이미지를 던지고 "OCR해"라고만 해도 완벽하게 읽어낸다. 이 사실이 시사하는 바를 네가 스스로 해석하라.
- 현재 4-Pass 구조가 정확도에 기여하는지, 오히려 방해가 되는지도 검증 대상이다.
- 프롬프트, 모델 파라미터, 파이프라인 구조, 후처리 로직, 이미지 크롭 방식 등 모든 것이 수정 대상이다.

### 중요 규칙
1. **한 곳만 고치다 안 되면 매너리즘에 빠지지 말 것** — 동일 부분을 3회 이상 수정해도 개선이 없으면, 반드시 다른 접근법으로 전환하거나, `--verbose`로 원시 데이터를 다시 분석하여 실제 병목을 재확인할 것.
2. **실험적인 큰 도전을 해볼 것** — 현재 파이프라인 구조 자체가 문제일 수 있으므로, 근본적인 구조 변경도 적극적으로 시도하라.
3. **공식 문서 확인 습관** — @google/genai SDK 사용법, Vertex AI API 파라미터 등 확실하지 않은 부분은 반드시 공식 문서를 확인할 것.
4. **test-analyze.js 의 검증 로직도 필요하면 수정** — 서술형 답안은 정확한 문자열 일치가 어려울 수 있으므로, 유사도 기반 비교나 정규화 비교로 변경해도 됨.
5. **계획-검토 워크플로우(`.agents/workflows/계획-검토.md`)는 이 작업에서는 건너뛰어도 됨** — 반복적 실험 작업이므로 매번 계획 검토를 거치면 속도가 너무 느려짐.
6. **코드 품질과 유지보수성 절대 타협 금지** — "일단 작동하게 만들고 나중에 수정하자"는 접근 방식은 **절대 금지**한다. 버그를 수정하는 과정에서 새로운 기술적 부채를 발생시키지 말 것. 모든 수정 사항은 코드 품질과 유지보수성을 보장해야 하며, 임시방편(hack)이나 하드코딩된 우회(workaround)를 남기지 말 것.
7.  내가 읽어야 할 것(커밋 메시지, 너의 검토요청) 은 모두 **한국어**로 작성할 것. 이외에는 영어로(컨텍스트 효율을 위해)