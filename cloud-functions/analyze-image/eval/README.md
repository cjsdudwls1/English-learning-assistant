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
    gt-path.mjs          # --gt 로 라벨 세트 선택 (기본 ground-truth.json)
  labels/
    ground-truth.json   # Tier-A 인간 라벨(gold) — 기본 채점 기준
    draft-answerkey-*.json  # 인쇄 해설지로 correct_answer를 확정한 세트
  results/              # 런 산출물 <tag>-<ts>.json (재현/비교용)
```

## 실행
```bash
# 베이스라인(HEAD) 측정: gold 5장 × 3런, 동시성 3(prod ANALYSIS_BATCH_SIZE 모사)
node eval/harness/run-eval.mjs --runs 3 --concurrency 3 --tag baseline

# test_image 전체 커버리지(채점은 gold만): 1런
node eval/harness/run-eval.mjs --runs 1 --tag coverage --all

# 다른 라벨 세트로 채점 (run-eval · rescore · compare · simulate-grading · baseline-single-call 공통)
node eval/harness/run-eval.mjs --gt draft-answerkey-2026-07-28.json --runs 3 --tag answerkey
node eval/harness/rescore.mjs eval/results/<파일>.json --gt draft-answerkey-2026-07-28.json
```

### 라벨 세트를 합치지 않고 고르는 이유

`ground-truth.json`은 `correct_answer` 근거가 사람의 어법 추론이고,
`draft-answerkey-*.json`은 인쇄된 해설지로 확정한 것이다 — **품질 계층이 다르다.**
한 파일에 합치면 "정확도 X%"가 두 계층의 평균이 되어 어느 쪽 문제인지 분간할 수 없고,
문항 수가 달라져 이전 결과 파일과의 상대 비교(이 하네스가 유일하게 신뢰하는 비교 방식)도
끊긴다. `--gt` 없이 실행하면 종전과 똑같이 `ground-truth.json`을 쓴다.

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
| `blank_*` | 다중빈칸(`answer_format: "multi_blank"`) | **인덱스별 텍스트 일치** | `user_answers` / `correct_answers` |
| `blank_cell_*` | 위 문항의 개별 빈칸 | 칸 단위 텍스트 일치 | 〃 (칸별) |
| `text_*` | 서술형 | 정규화 fuzzy 매칭 | `user_answer` / `correct_answer` |

`multi_*`·`blank_*`를 `mc_*`/`text_*`와 섞지 않는 이유 — 집합 완전일치와 인덱스 정렬은 단일
선택·단일 문자열과 난도가 달라 섞으면 지표 해석이 흐려지고, 기존 `mc_*`/`text_*` 수치의
의미가 바뀌어 이전 결과 파일과 비교할 수 없게 된다.

**복수정답 채점 규칙**
- 부분집합도 `wrong`. 두 개 중 하나만 뽑은 것은 기권이 아니라 전사 실패다.
- 아무 번호도 못 뽑았으면 `abstain`(비처벌).
- `"3, 4"` · `"③④"` · `["3","4"]`를 모두 같은 집합으로 본다(표기·순서 무관).
- GT의 `user_answers`/`correct_answers` 배열이 없거나 형태가 불명이면 채점을 보류하고
  `multi_gt_invalid`로 집계한다 — 라벨 결함이 지표에 묻히지 않도록 하네스가 경고를 출력한다.

**다중빈칸 채점 규칙** (`blank_*`)
- 빈칸마다 독립 판정한 뒤 문항 단위로 종합한다: 하나라도 `wrong`이면 문항 `wrong`,
  전 칸 `correct`면 `correct`, 그 외(일부만 읽고 나머지 기권)는 `abstain` — 부분 크레딧은
  주지 않는다. 세 칸 중 하나를 잘못 읽은 것은 "절반 맞음"이 아니라 오독이기 때문이다.
- GT보다 칸을 더 냈으면 없는 빈칸을 지어낸 것이므로 `wrong`.
- 예측이 배열(`user_answers`)이 아니어도 `"(1) x (2) y"`·`"x, y"` 스칼라를 칸으로 쪼개
  채점한다 — 모델 출력 형태가 흔들려도 지표가 무너지지 않게.
- `blank_cell_*`는 같은 문항을 빈칸 단위로 다시 센다. 문항 단위만 보면 "3칸 중 2칸은 정확히
  읽었다"가 사라져 개선/열화를 분간할 수 없다.
- GT의 `user_answers`/`correct_answers`가 배열이 아니면 채점을 보류하고 `blank_gt_invalid`로
  집계한다(복수정답과 동일하게 라벨 결함을 드러낸다).

## 단위 테스트
```bash
npm test    # node --test "test/**/*.test.mjs" — AI·DB 없이 순수함수만 검증
```
- `test/multiSelect.test.mjs` — 복수정답 경로 4곳(score.mjs 채점 · simplePipeline
  normalizeItem·프롬프트 · answerSanitizers 별칭 · dbOperations computeIsCorrect)
- `test/multiBlank.test.mjs` — 다중빈칸 인덱스 채점(칸 파싱 · 문항 종합 · 셀 집계)
- `test/problemMatching.test.mjs` — 문항 번호 매칭(아래 참조)

루트의 `test-*.js`는 실제 GCP/Supabase를 때리는 별개의 수동 스크립트다.

## 문항 번호 매칭 (GT ↔ 예측)

교재 연습(Unit Exercise)은 한 페이지 안에서 구획 A·B·C가 각각 1번부터 다시 시작한다.
번호에서 첫 숫자열만 뽑아 키로 쓰면 `A-1`·`B-1`·`C-1`이 전부 `"1"`로 뭉개져 서로 다른
문항끼리 대조된다 — GT를 그대로 되돌려주는 완벽한 예측조차 29문항 중 14개가 wrong으로
찍혔다(2026-07-28 실측). 그래서 2단계로 짝짓는다.

1. **정밀 키**(`normalizeProblemNum`) — 섹션 라벨을 보존한다(`A-1`/`A 1`/`A1` → `a-1`).
   단 `Q`·`No`·`문제`·`#` 같은 장식 접두는 표기 습관이지 식별자가 아니므로 제거해
   `"Q1"`과 `"1"`이 같은 문항이 되게 한다.
2. **관대 키 폴백**(`looseProblemNum`, 첫 숫자열) — 정밀 키가 빗나갔을 때만, 그리고
   **그 숫자를 가진 GT 문항이 페이지 내 유일하고 예측 후보도 정확히 1개일 때만** 쓴다.
   모호하면 매칭을 포기해 `missing`(비처벌)으로 둔다 — 엉뚱한 문항과 짝지어 만드는
   confident-wrong이 판독 실패보다 해롭다는 1원칙 그대로다.

기존 `ground-truth.json`은 번호가 전부 숫자이고 페이지 내 유일해 폴백 경로로 종전과
동일하게 동작한다(64문항 wrong 0·extra 0 실측). 파이프라인 쪽도 섹션이 나뉜 페이지에서는
`problem_number`를 `"A-1"` 형태로 내도록 프롬프트가 지시한다.

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
