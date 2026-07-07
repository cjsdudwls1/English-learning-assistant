/**
 * 문항 유형 판별 — Pass A 추출 문항별 컨텍스트(questionContextMap) 구축
 * processPage.js에서 분리(행위보존). 크롭/Pass B/게이트가 공유하는 문항별 판정
 * (isSubjective/isMultiFormat/isWordChoice/isMultiBlank 등)을 한 곳에서 산출한다.
 * ⚠️ 괄호고르기 감지 시 item.choices를 in-place로 비우는 부수효과가 있다(원본 동작 보존).
 */

import { parseInlineChoiceOptions, parseNumberedBlanks } from './answerSanitizers.js';
import { detectMultiAnswer } from './dbOperations.js';

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
  // 성분 표시형(주어/동사/목적어/목적격보어 라벨링), 배열/완성/찾아쓰기형 — choices가 없는
  // 주관식인데 객관식 키워드가 없어 미분류되던 유형(실측 _04 Q66~68 "성분을 표시하시오").
  '표시하', '배열하', '나열하', '완성하', '연결하', '찾아 쓰', '찾아서 쓰', '고치시오', '바르게 고',
];

/**
 * @param {Array} pageItems - Pass A 추출 문항(괄호고르기 감지 시 item.choices in-place 비움)
 * @param {string} sessionId
 * @returns {Map<string, object>} problem_number → 문항 컨텍스트
 */
export function buildQuestionContextMap(pageItems, sessionId) {
  const questionContextMap = new Map();
  for (const item of pageItems) {
    const hasChoices = Array.isArray(item.choices) && item.choices.length > 0;
    const instructionText = item.instruction || '';
    const questionBodyText = item.question_body || '';
    const combinedText = `${instructionText}\n${questionBodyText}`;

    const hasObjectiveKw = OBJECTIVE_KEYWORDS.some(kw => combinedText.includes(kw));
    const hasSubjectiveKw = SUBJECTIVE_KEYWORDS.some(kw => combinedText.includes(kw));

    // 유형 판별 우선순위: 주관식 키워드 유무 → 그다음 choices 유무.
    // 핵심 규칙: 선택지(①~⑤)가 명확히 추출됐으면(hasChoices) 객관식이다.
    // '영작/쓰시오' 같은 주관식 키워드가 instruction에 있어도, 선택지에서 답을 고르는
    // 유형("다음 우리말을 영작할 때 세 번째로 오는 단어는? ①a ②we ③him …")은 객관식.
    // 이를 주관식으로 오판하면 user_answer가 손글씨 낙서로, correct_answer가 선택지
    // 텍스트("him")로 추출돼 정답을 오답 처리하는 결함이 생긴다(실측 12번).
    let isSubjective;
    if (!hasSubjectiveKw) {
      // 주관식 키워드 없음 → 객관식 기본.
      // choices=0이어도 주관식으로 단정하지 않는다(영어 시험 28~45 대부분 객관식,
      // 묶음문제 후속 문항은 위치마커 ①~⑤가 choices로 안 잡혀 choices=0이 되곤 함.
      // 주관식 오판 시 correct_answer가 번호 대신 지문 문장으로 추출됨 — 실측 Q39).
      isSubjective = false;
    } else {
      // 주관식 키워드 존재 → 선택지가 명확히 추출됐으면 객관식, 없으면 주관식.
      // (객관식 키워드 동시 존재 여부와 무관하게 choices가 최종 판단 기준)
      isSubjective = !hasChoices;
    }

    console.log(`[handler] Q${item.problem_number} 유형 판별: isSubjective=${isSubjective}, hasChoices=${hasChoices}, hasObjKw=${hasObjectiveKw}, hasSubjKw=${hasSubjectiveKw}`, { sessionId });

    // 다중정답(multi MC) 사전판정: correct_answer는 아직 추출 전(Pass B가 이 다음 단계)이라
    // instruction 신호만 사용(detectMultiAnswer 2번째 인자 null). 정식 판정은 저장 시점
    // dbOperations.resolveAnswerFormat이 choices까지 반영해 재확정하므로, 이 값은 Pass B
    // 추출 단계에서 sanitizeMcAnswer(단일)냐 sanitizeMcAnswerSet(집합)이냐를 가르는 스위치일
    // 뿐이다 — 오탐(false positive)의 최악의 결과는 저장 단계에서 다시 single로 재확정되는 것뿐.
    const isMultiFormat = detectMultiAnswer(instructionText, null);

    // 괄호고르기(word-choice, 어법 선택형) 감지.
    // ⚠️ Pass A는 괄호 옵션을 종종 choices(①②)로 오적재한다(실측 ch2) → !hasChoices 게이트 불가.
    // 또 Pass A가 body의 슬래시/괄호를 뭉개기도 한다(실측 "(he who)","who which)") → 인라인 파싱만으론
    // recall 부족. 두 신호를 병용한다:
    //  (1) 문장 속 인라인 "(x/y)" 그룹 파싱(가장 확실, 옵션 철자까지 획득) — body 우선, 없으면 instruction.
    //  (2) fallback: "괄호 안에서/골라" 지시문 + 2~4개의 짧은 '단어형' choices(Pass A가 괄호를 뭉갠 경우).
    //      "괄호 안"은 word-choice 고유 표현이라 ①②③④⑤ 정규 MC와 안전하게 구분된다(정밀도).
    // 감지 시 isSubjective=false 고정 + choices=[](ctx·item 모두) 비워, MC 인덱스화("2" 오출력)와
    // 서술형 자유텍스트 양쪽을 우회 → 답을 '옵션 단어'로 추출·비교.
    let wordChoiceOptions = parseInlineChoiceOptions(questionBodyText);
    if (wordChoiceOptions.length < 2) wordChoiceOptions = parseInlineChoiceOptions(instructionText);
    if (wordChoiceOptions.length < 2) {
      const wcCue = /괄호\s*안|괄호\s*에서|괄호\s*속/.test(combinedText);
      if (wcCue && hasChoices) {
        const words = (item.choices || [])
          .map(c => (typeof c === 'string' ? c : (c?.text || c?.label || '')))
          .map(s => String(s).trim()).filter(Boolean);
        const allWordLike = words.length >= 2 && words.length <= 4 &&
          words.every(w => /[A-Za-z]/.test(w) && w.split(/\s+/).length <= 3 && w.length <= 20);
        if (allWordLike) wordChoiceOptions = words;
      }
    }
    const isWordChoice = wordChoiceOptions.length >= 2;
    if (isWordChoice) {
      item.choices = []; // 인라인 단어옵션을 MC 선택지로 오적재한 것을 제거 → 저장/채점 텍스트 경로로
    }

    // 다중빈칸 서술형(multi_blank) 감지(Phase 2 대비 컨텍스트만 기록): "(1)…(2)…(3)…" 연속 빈칸.
    // 현재는 진단/추적 용도로만 저장 — 실제 분리추출·저장은 Phase 2에서 처리.
    const blankStems = (isSubjective && !isWordChoice) ? parseNumberedBlanks(questionBodyText) : [];
    const isMultiBlank = blankStems.length >= 2;

    if (isWordChoice) {
      console.log(`[handler] Q${item.problem_number} 괄호고르기 감지: options=[${wordChoiceOptions.join(' / ')}] → isSubjective=false, choices 비움`, { sessionId });
    }
    if (isMultiBlank) {
      console.log(`[handler] Q${item.problem_number} 다중빈칸 감지: ${blankStems.length}개 빈칸(Phase 2 추적용)`, { sessionId });
    }

    questionContextMap.set(String(item.problem_number), {
      isSubjective: isWordChoice ? false : isSubjective,
      hasObjectiveKw,
      isMultiFormat: isWordChoice ? false : isMultiFormat,
      instruction: instructionText,
      questionBody: questionBodyText,
      hasChoices: isWordChoice ? false : hasChoices,
      choices: isWordChoice ? [] : (item.choices || []),
      isWordChoice,
      wordChoiceOptions,
      isMultiBlank,
      blankStems,
    });
  }
  return questionContextMap;
}
