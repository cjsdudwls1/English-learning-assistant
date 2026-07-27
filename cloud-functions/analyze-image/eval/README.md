# analyze-image 평가 하네스 (eval/)

프로덕션과 **동일한 `shared/` 코드**(processPage)를 로컬에서 실행해, 답안 추출 품질을
정량 측정하고 회귀를 검증하기 위한 도구. 모델 교체/프롬프트 변경의 효과를 실측으로 판단한다.

## 디렉터리
```
eval/
  harness/
    load-env.mjs        # .env.yaml → process.env (값은 로그 금지)
    pipeline-runner.mjs  # buildAIClient + runPipelineOnImage (prod 동일 경로)
    smoke.mjs            # 단일 이미지 스모크
    score.mjs            # precision-first 채점 + 멀티런 안정성 분석 (순수함수)
    run-eval.mjs         # 멀티런 오케스트레이터(동시성 제한) + 결과 저장
  labels/
    ground-truth.json   # Tier-A 인간 라벨(gold) — 채점 기준
  results/              # 런 산출물 <tag>-<ts>.json (재현/비교용)
```

## 실행
```bash
# 베이스라인(HEAD) 측정: gold 5장 × 3런, 동시성 3(prod ANALYSIS_BATCH_SIZE 모사)
node eval/harness/run-eval.mjs --runs 3 --concurrency 3 --tag baseline

# test_image 전체 커버리지(채점은 gold만): 1런
node eval/harness/run-eval.mjs --runs 1 --tag coverage --all
```

## 채점 규칙 (precision-first)
"자신있는 오답(confident-wrong)은 null(기권)보다 해롭다"가 1원칙.

| 분류 | 의미 | precision | recall |
|------|------|-----------|--------|
| correct | GT값(또는 ambiguous accept집합)과 일치 | + | + |
| abstain | null 반환(=정직한 기권) | 제외 | − |
| wrong   | 비-null 인데 불일치 = **confident-wrong** | − | − |

- `precision = correct / (correct + wrong)` — 답을 낸 것 중 정답률(정밀도).
- `recall = correct / (correct + abstain + wrong)` — 전체 커버리지.
- `ambiguous`(학생이 흐릿/복수 마킹) 문항은 `null` 반환을 **정답 취급**(abstain, 비처벌).
- 서술형(text)은 정규화 fuzzy 매칭으로 별도 채점(주 지표에서 분리).

### 버킷 (문항 형식별로 분리 집계)

| 버킷 | 대상 | 비교 방식 | GT 필드 |
|------|------|-----------|---------|
| `mc_*` | 단일정답 객관식 | 번호 1개 일치 | `user_answer` / `correct_answer` |
| `multi_*` | 복수정답 객관식(`answer_format: "multi_select"`) | **번호 집합 완전일치** | `user_answers` / `correct_answers` |
| `text_*` | 서술형 · 다중빈칸(`multi_blank`) | 정규화 fuzzy 매칭 | `user_answer` / `correct_answer` |

`multi_*`를 `mc_*`와 섞지 않는 이유 — 집합 완전일치는 단일 선택과 난도가 달라 섞으면 지표
해석이 흐려지고, 기존 `mc_*` 수치의 의미가 바뀌어 이전 결과 파일과 비교할 수 없게 된다.

**복수정답 채점 규칙**
- 부분집합도 `wrong`. 두 개 중 하나만 뽑은 것은 기권이 아니라 전사 실패다.
- 아무 번호도 못 뽑았으면 `abstain`(비처벌).
- `"3, 4"` · `"③④"` · `["3","4"]`를 모두 같은 집합으로 본다(표기·순서 무관).
- GT의 `user_answers`/`correct_answers` 배열이 없거나 형태가 불명이면 채점을 보류하고
  `multi_gt_invalid`로 집계한다 — 라벨 결함이 지표에 묻히지 않도록 하네스가 경고를 출력한다.
- `multi_blank`(순서 있는 텍스트 배열)는 인덱스별 텍스트 채점이 미구현이라 `text_*` 경로를
  탄다. 스칼라를 이어붙인 우회값으로 채점되므로 해당 문항 수치는 참고치로만 볼 것.

## 단위 테스트
```bash
npm test    # node --test "test/**/*.test.mjs" — AI·DB 없이 순수함수만 검증
```
`test/multiSelect.test.mjs`가 복수정답 경로 4곳(score.mjs 채점 · simplePipeline
normalizeItem·프롬프트 · answerSanitizers 별칭 · dbOperations computeIsCorrect)을 묶어
검증한다. 루트의 `test-*.js`는 실제 GCP/Supabase를 때리는 별개의 수동 스크립트다.

## 멀티런 안정성 (run-to-run instability)
- `flaky_class`: N런에서 정/오/기권 분류가 바뀐 인스턴스 수(흐릿 마크의 핵심 문제).
- `always_wrong`: N런 내내 confident-wrong (구조적 오인 — 가장 위험).
- `wrong_max`: 단일 런 최대 confident-wrong 수(최악 케이스).

## 실험 시퀀스
1. **baseline** — HEAD `shared/` 구성.
2. **harden** — §3 저위험 하드닝(아래) 적용 후 회귀검증(베이스라인 대비 비열화).
3. **consensus** — §4 user_answer 교차뷰 확인(feature-flag, 기본 OFF) 측정.

### §3 저위험 하드닝 (API 호출 0 추가 → 동시성 무영향)
- **bbox 복구**: 좌표 swap/clamp(0–1000). 유효 bbox는 무변경 → 회귀 불가, 손상만 복구.
- **MC 답안 범위 정합성**: 객관식 답이 1–5 밖 숫자면 null(정밀도 보호). 서술형 텍스트 불간섭.
- **full-image fallback 프롬프트 X/O 분별**: 크롭 경로엔 있으나 full-image 경로엔 없던
  "자가채점 O를 user_answer로 오인 금지" 규칙 추가.

### §4 user_answer 교차뷰 확인 (consensus, feature-flag)
- answerArea 크롭 결과(비-null)를 fullCrop(다른 뷰)으로 1회 교차확인.
  - 일치 → 채택(고신뢰) · 불일치 → null(기권, 정밀도 우선) · fullCrop=null → answerArea 유지.
- 부하: **문항당 +1 호출 상한**(N×아님). 기본 OFF → prod 30명 동시부하 무영향.
  ON 시 호출 증가분을 측정해 안전여유 평가 후에만 권고.
