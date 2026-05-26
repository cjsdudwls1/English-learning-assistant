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
