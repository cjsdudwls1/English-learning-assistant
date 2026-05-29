/**
 * 단일 페이지 4-Pass 분석 오케스트레이션 모듈
 * - index.js에서 추출 (행위보존). 프로덕션(index.js)과 로컬 eval 하네스가
 *   동일 코드를 공유하도록 단일 소스화한다.
 * - processPage: Pass A(구조) + Pass 0(좌표) → 크롭 → Pass B(필기) → 주관식 → Pass C(분류)
 * - mergeHandwritingMarks: Pass B marks 검증 + pageItems 병합
 *
 * 원본: pageAnalyzer.ts#analyzeOnePage / mergeHandwritingMarks
 */

import { cropRegions } from './imageCropper.js';
import {
  executePassA, executePass0, executePassB, executePassBFullImage,
  executePassC, detectSubjectiveUserAnswers, detectCorrectFromCrops,
} from './passes.js';
import { USER_ANSWER_MODEL_SEQUENCE } from './config.js';

/**
 * Pass B marks를 검증하고 pageItems에 병합한다.
 * - 객관식(선택지 1~5)의 경우 범위 밖이면 폐기
 * - 주관식/서술형/O/X는 자유 텍스트 허용
 * - user_answer, correct_answer, user_marked_correctness 모두 병합
 */
export function mergeHandwritingMarks(pageItems, marks, sessionId) {
  if (marks.length === 0) return;

  // 진단 로그: 필터링 전 전체 marks 출력
  console.log(`[Pass B] Raw marks BEFORE filtering:`, {
    sessionId,
    marks: marks.map(m =>
      `Q${m.problem_number}: user_answer=${m.user_answer}, correct_answer=${m.correct_answer ?? 'N/A'}`
    ),
  });

  for (const mark of marks) {
    // 선택지 범위 초과 검증: 객관식인 경우만 유효한 선택지 번호(1~5) 체크
    if (mark.user_answer) {
      const ansNum = parseInt(mark.user_answer, 10);
      // 순수 숫자인데 범위 밖인 경우만 폐기 (주관식/서술형 자유 텍스트는 허용)
      if (!isNaN(ansNum) && String(ansNum) === String(mark.user_answer).trim() && (ansNum < 1 || ansNum > 5)) {
        console.log(`[Pass B] Q${mark.problem_number}: answer "${mark.user_answer}" is a number out of choice range (1-5) → discarded`);
        mark.user_answer = null;
        mark.ambiguous = true;
      }
    }
  }

  // problem_number → mark 데이터 매핑 (user_answer + correct_answer + user_marked_correctness)
  const markMap = new Map();
  for (const mark of marks) {
    markMap.set(String(mark.problem_number), {
      user_answer: mark.user_answer,
      correct_answer: mark.correct_answer || null,
      user_marked_correctness: mark.user_marked_correctness || null,
    });
  }

  for (const item of pageItems) {
    const pNum = String(item.problem_number || '');
    const match = markMap.get(pNum);
    if (match) {
      item.user_answer = match.user_answer;
      item.correct_answer = match.correct_answer;
      item.user_marked_correctness = match.user_marked_correctness;
    }
  }

  console.log(`[handler] Pass B 병합 완료: ${marks.length}개 marks`, {
    sessionId,
    mergeDetails: marks.map(m =>
      `Q${m.problem_number}: user=${m.user_answer ?? 'null'}, correct=${m.correct_answer ?? 'null'}`
    ),
  });
}

/**
 * 단일 페이지에 대한 4-Pass 분석 파이프라인 실행
 * Pass A(구조) + Pass 0(좌표) → 크롭 → Pass B(필기) → Pass C(분류)
 *
 * @param {object} opts
 * @param {boolean} [opts.runClassification=true] - false면 Pass C(분류) 생략.
 *   로컬 eval은 user_answer/correct_answer만 채점하므로 분류 비용을 절약한다.
 *   프로덕션 호출부는 이 옵션을 지정하지 않아 기본 true → 행위 불변.
 *
 * 원본: pageAnalyzer.ts#analyzeOnePage
 */
export async function processPage({ ai, sessionId, imageData, pageNum, totalPages, taxonomyData, userLanguage, runClassification = true, correctSource = 'crop' }) {
  // Pass A + Pass 0 병렬 실행
  const [passAResult, pass0Result] = await Promise.all([
    executePassA({ ai, sessionId, imageBase64: imageData.imageBase64, mimeType: imageData.mimeType, pageNum, totalPages, taxonomyData }),
    executePass0({ ai, sessionId, imageBase64: imageData.imageBase64, mimeType: imageData.mimeType }),
  ]);

  const pageItems = passAResult.parsed?.items || passAResult.parsed?.problems || passAResult.parsed?.pages?.[0]?.problems || [];
  console.log(`[handler] Pass A: ${pageItems.length}개 문제 (${passAResult.model}), Pass 0: ${pass0Result.bboxes.length}개 bbox`, { sessionId });

  // Pass A 결과에서 문제 유형 판별 (객관식 vs 주관식)
  // 우선순위: 명시적 키워드 > choices 유무
  // - 객관식 키워드가 있으면 무조건 객관식 (choices 추출 실패해도)
  // - 주관식 키워드가 있으면 무조건 주관식
  // - 키워드 없으면 choices 유무로 판단
  const OBJECTIVE_KEYWORDS = [
    '고르시오', '고른 것은', '고를 것은', '다음 중', '다음 글의 밑줄', '밑줄 친',
    '적절한 것은', '적절하지 않은 것은', '적절하지 않은', '옳은 것은', '옳지 않은',
    '알맞은 것은', '알맞지 않은', '가장 적절', '가장 알맞은', '바른 것은', '틀린 것은',
    '5지선다', '4지선다', '①', '②', '③', '④', '⑤',
  ];
  const SUBJECTIVE_KEYWORDS = [
    '서술형', '고쳐 쓰', '바꿔 쓰', '영작', '쓰시오', '쓰세요',
    '빈칸을 채우', '빈 칸을 채우', '문장을 완성', '단어를 쓰', '단어를 적', '답을 적',
    '서술하시오', '논술', '단답형',
  ];
  const questionContextMap = new Map();
  for (const item of pageItems) {
    const hasChoices = Array.isArray(item.choices) && item.choices.length > 0;
    const instructionText = item.instruction || '';
    const questionBodyText = item.question_body || '';
    const combinedText = `${instructionText}\n${questionBodyText}`;

    const hasObjectiveKw = OBJECTIVE_KEYWORDS.some(kw => combinedText.includes(kw));
    const hasSubjectiveKw = SUBJECTIVE_KEYWORDS.some(kw => combinedText.includes(kw));

    let isSubjective;
    if (hasObjectiveKw && !hasSubjectiveKw) {
      isSubjective = false; // 명시적 객관식 (choices 추출 실패해도 객관식)
    } else if (hasSubjectiveKw && !hasObjectiveKw) {
      isSubjective = true; // 명시적 주관식
    } else if (hasObjectiveKw && hasSubjectiveKw) {
      // 양쪽 키워드 모두 있으면 choices 유무로 결정
      isSubjective = !hasChoices;
    } else {
      // 키워드 없음 → 객관식 기본.
      // choices=0이어도 주관식 키워드가 없으면 주관식으로 단정하지 않는다.
      // 영어 시험(28~45)은 대부분 객관식이며, 묶음 문제([38~39] 등)의 후속 문항은
      // instruction이 비고 위치마커(①~⑤)가 choices로 안 잡혀 choices=0이 되곤 한다.
      // 이를 주관식으로 오판하면 correct_answer가 번호 대신 지문 문장으로 추출되는 결함 발생
      // (실측: Q39 correct가 지문 문장 전체로 추출됨).
      isSubjective = false;
    }

    console.log(`[handler] Q${item.problem_number} 유형 판별: isSubjective=${isSubjective}, hasChoices=${hasChoices}, hasObjKw=${hasObjectiveKw}, hasSubjKw=${hasSubjectiveKw}`, { sessionId });

    questionContextMap.set(String(item.problem_number), {
      isSubjective,
      instruction: instructionText,
      questionBody: questionBodyText,
      hasChoices,
      choices: item.choices || [],
    });
  }

  // Pass B: 크롭 기반 필기 인식 또는 전체 이미지 fallback
  let passBResult;

  if (pass0Result.bboxes.length > 0) {
    // bbox가 있으면: 서버 사이드 크롭 → Pass B 크롭 기반 분석
    try {
      const cropResult = await cropRegions(imageData.imageBase64, imageData.mimeType, pass0Result.bboxes);
      const answerAreaCrops = cropResult.answerAreaCrops;
      const fullCrops = cropResult.fullCrops;
      console.log(`[handler] 크롭: ${answerAreaCrops.length} answer + ${fullCrops.length} full`, { sessionId });

      passBResult = await executePassB({ ai, sessionId, answerAreaCrops, fullCrops, questionContextMap, correctSource });
      console.log(`[handler] Pass B (크롭): ${passBResult.marks.length}개 marks (기대: ${pageItems.length}개)`, { sessionId });

      // marks에서 통째로 누락된 문항(크롭 fetch 실패 등)
      const missingProblems = pageItems
        .filter(it => !passBResult.marks.some(m => String(m.problem_number) === String(it.problem_number)))
        .map(it => String(it.problem_number));
      // correct_answer가 비어있는 mark 존재 여부
      const hasMissingCorrect = passBResult.marks.some(m => m.correct_answer == null || String(m.correct_answer).trim() === '');

      // 전체 이미지 fallback은 (1) 통째 누락 문항 복구, (2) correct_answer 결손 보충 용도.
      // user_answer는 일부러 덮어쓰지 않는다: 고해상도 크롭(answerArea + fullCrop 재독해)이
      // 읽지 못한 마크를 저해상도·전체페이지 인식이 추측하면 오답을 주입한다
      // (실측: Q45 정답 ③인데 full-page가 ⑤로 오인식). 못 읽은 마크는 null로 두는 편이
      // 자신있는 오답보다 안전하다.
      if (missingProblems.length > 0 || hasMissingCorrect) {
        console.log(`[handler] Pass B 보충 필요 (통째 누락 [${missingProblems.join(',')}], correct결손=${hasMissingCorrect}), 전체 이미지 fallback`, { sessionId });
        const fallbackResult = await executePassBFullImage({
          ai, sessionId,
          imageBase64: imageData.imageBase64,
          mimeType: imageData.mimeType,
          totalPages,
          focusNumbers: missingProblems,
          modelSequence: USER_ANSWER_MODEL_SEQUENCE, // 전체이미지 필기 지각도 3.5-flash 우선(2.5-flash 인접번호 오인 회피)
        });
        console.log(`[handler] Pass B fallback 보충: ${fallbackResult.marks.length}개 marks`, { sessionId });

        for (const fbMark of fallbackResult.marks) {
          const existing = passBResult.marks.find(m => String(m.problem_number) === String(fbMark.problem_number));
          if (!existing) {
            // 통째 누락 문항: full-page가 유일한 출처이므로 그대로 채택
            passBResult.marks.push(fbMark);
          } else if ((existing.correct_answer == null || String(existing.correct_answer).trim() === '') && fbMark.correct_answer) {
            // 기존 mark는 correct_answer 결손만 보충, user_answer는 보존(덮어쓰지 않음)
            existing.correct_answer = fbMark.correct_answer;
          }
        }
        console.log(`[handler] Pass B 최종 병합: ${passBResult.marks.length}개 marks`, { sessionId });
      }

      // correctSource='fullpage' 잔여 보충: 풀페이지(fallback)가 채우지 못한 correct만 문항별
      // 크롭으로 1회 보충한다. 어법지 등 문항이 많은 페이지에서 풀페이지 1회 추론이 일부 문항
      // correct를 누락(실측: Q5)하는 recall 손실을 메우면서, 호출 증가는 잔여분(보통 0~소수)뿐이다.
      if (correctSource === 'fullpage') {
        const stillMissing = new Set(
          passBResult.marks
            .filter(m => m.correct_answer == null || String(m.correct_answer).trim() === '')
            .map(m => String(m.problem_number))
        );
        const fixCrops = fullCrops.filter(fc => stillMissing.has(String(fc.problem_number)));
        if (fixCrops.length > 0) {
          console.log(`[handler] correct 잔여 보충 ${fixCrops.length}개 크롭: [${fixCrops.map(c => c.problem_number).join(',')}]`, { sessionId });
          const fix = await detectCorrectFromCrops({ ai, sessionId, fullCrops: fixCrops, questionContextMap });
          for (const fm of fix.marks) {
            const ex = passBResult.marks.find(m => String(m.problem_number) === String(fm.problem_number));
            if (ex && (ex.correct_answer == null || String(ex.correct_answer).trim() === '') && fm.correct_answer) {
              ex.correct_answer = fm.correct_answer;
            }
          }
        }
      }
    } catch (cropError) {
      // 크롭 실패 시: 전체 이미지 기반 fallback (이전 pageAnalyzer.ts:288-297 복원)
      console.error(`[handler] 크롭/Pass B 실패, 전체 이미지 fallback:`, cropError?.message, { sessionId });
      passBResult = await executePassBFullImage({
        ai, sessionId,
        imageBase64: imageData.imageBase64,
        mimeType: imageData.mimeType,
        totalPages,
        modelSequence: USER_ANSWER_MODEL_SEQUENCE,
      });
      console.log(`[handler] Pass B (full-image fallback): ${passBResult.marks.length}개 marks`, { sessionId });
    }
  } else {
    // bbox 0개: 전체 이미지 기반 분석 (이전 pageAnalyzer.ts:298-308 복원)
    console.log(`[handler] Pass 0: bbox 0개, 전체 이미지 fallback으로 전환`, { sessionId });
    passBResult = await executePassBFullImage({
      ai, sessionId,
      imageBase64: imageData.imageBase64,
      mimeType: imageData.mimeType,
      totalPages,
      modelSequence: USER_ANSWER_MODEL_SEQUENCE,
    });
    console.log(`[handler] Pass B (full-image fallback): ${passBResult.marks.length}개 marks`, { sessionId });
  }

  // Pass B 결과 병합: 원본 mergeHandwritingMarks 방식으로 검증 + 병합
  // 먼저 pageItems의 user_answer/correct_answer/user_marked_correctness를 null로 초기화
  for (const item of pageItems) {
    item.user_answer = null;
    item.user_marked_correctness = null;
    item.correct_answer = null;
  }
  mergeHandwritingMarks(pageItems, passBResult.marks, sessionId);

  // Subjective questions: full-image based user_answer detection (overrides crop-based results)
  const subjectiveProblems = [];
  for (const [pNum, ctx] of questionContextMap) {
    if (ctx.isSubjective) {
      subjectiveProblems.push({ problem_number: pNum, instruction: ctx.instruction, questionBody: ctx.questionBody });
    }
  }
  if (subjectiveProblems.length > 0) {
    console.log(`[handler] 주관식 ${subjectiveProblems.length}개 문제 → 전체 이미지 기반 user_answer 감지`, { sessionId });
    const subjectiveResult = await detectSubjectiveUserAnswers({
      ai, sessionId,
      imageBase64: imageData.imageBase64, mimeType: imageData.mimeType,
      subjectiveProblems,
    });
    for (const mark of subjectiveResult.marks) {
      const item = pageItems.find(it => String(it.problem_number) === String(mark.problem_number));
      if (item && mark.user_answer != null) {
        item.user_answer = mark.user_answer;
      }
    }
  }

  // Pass C: 분류 (visual_context가 있으면 이미지도 전달)
  // runClassification=false(로컬 eval)면 분류 생략 — user_answer/correct_answer 채점에 불필요.
  if (runClassification) {
    const passCResult = await executePassC({
      ai, sessionId, taxonomyData, pageItems, userLanguage,
      imageBase64: imageData.imageBase64, mimeType: imageData.mimeType,
    });
    console.log(`[handler] Pass C: ${passCResult.classifications.length}개 분류`, { sessionId });
    for (const cls of passCResult.classifications) {
      const matchedItem = pageItems.find(item => String(item.problem_number) === String(cls.problem_number));
      if (matchedItem) {
        matchedItem.classification = cls.classification;
        matchedItem.metadata = cls.metadata;
        // correct_answer는 Pass B에서 설정된 값을 보존
      }
    }
  }

  return { pageItems, usedModel: passAResult.model };
}
