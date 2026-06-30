/**
 * 문제 생성용 프롬프트 템플릿
 * - supabase/functions/generate-problems-by-type/index.ts 의 promptTemplates + buildPrompt 이식
 * - Deno → Node.js ESM
 */

export const PROBLEM_TYPES = ['multiple_choice', 'short_answer', 'essay', 'ox'];

const promptTemplates = {
  multiple_choice: {
    ko: {
      intro: (count, classification) => `다음 분류에 해당하는 영어 객관식 문제 ${count}개를 생성해주세요 (각 문제는 5지선다).\n\n분류: ${classification}`,
      format: `각 문제는 다음 형식의 JSON 배열로 반환해주세요:
[
  {
    "stem": "문제 본문 (영어로 작성)",
    "choices": [
      {"text": "선택지 1", "is_correct": false},
      {"text": "선택지 2", "is_correct": true},
      {"text": "선택지 3", "is_correct": false},
      {"text": "선택지 4", "is_correct": false},
      {"text": "선택지 5", "is_correct": false}
    ],
    "explanation": "정답 해설 (한국어, 4~6문장, 각 항목은 줄바꿈으로 구분). 서로 다른 학습 정보를 담아라(반복 금지): ① 정답의 직접 근거 — 적용된 핵심 문법·어법·어휘 규칙과 이 문장에서 어떻게 작동하는지, ② 그 규칙이 성립하는 원리 — 왜 그런지(암기가 아닌 이해), ③ 가장 헷갈리는 오답의 함정 — 어느 선택지가 왜 매력적 오답인지, ④ 적용 확장 — 같은 규칙이 쓰이는 다른 짧은 예나 기억 팁",
    "wrong_explanation": {
      "0": "1번 선택지가 오답인 이유 (2~3문장): 무엇이 틀렸는지 + 이 선택지를 고르게 만드는 오해·함정의 정체 + 올바른 교정 방법",
      "2": "3번 선택지가 오답인 이유 (2~3문장): 같은 형식",
      "3": "4번 선택지가 오답인 이유 (2~3문장): 같은 형식",
      "4": "5번 선택지가 오답인 이유 (2~3문장): 같은 형식"
    }
  }
]`,
      requirements: [
        '각 문제는 정확히 5개의 선택지를 가져야 합니다 (5지선다형)',
        '정답은 하나만 있어야 합니다 (is_correct: true)',
        'explanation은 ①정답의 직접 근거(핵심 문법·어법·어휘 규칙) ②그 규칙의 원리 ③대표 오답의 함정 ④적용 확장(다른 예·기억 팁)을 4~6문장으로 담되, 학습자가 이 해설만으로 유사 문제를 스스로 풀 수 있을 만큼 구체적으로 쓰세요. 같은 말 반복·군더더기는 금지',
        'wrong_explanation에는 정답을 제외한 나머지 4개 선택지 각각에 대해, 그 선택지의 인덱스(0부터 시작, 정답 인덱스 제외)를 키로 왜 틀렸는지·왜 매력적 오답인지(함정의 정체)·올바른 교정 방법을 2~3문장으로 설명하세요',
        'JSON 형식만 반환하고 다른 설명은 추가하지 마세요',
      ],
    },
    en: {
      intro: (count, classification) => `Generate ${count} multiple choice English problems (5 choices each).\n\nClassification: ${classification}`,
      format: `Return each problem as a JSON array:
[
  {
    "stem": "Problem text",
    "choices": [
      {"text": "Choice 1", "is_correct": false},
      {"text": "Choice 2", "is_correct": true},
      {"text": "Choice 3", "is_correct": false},
      {"text": "Choice 4", "is_correct": false},
      {"text": "Choice 5", "is_correct": false}
    ],
    "explanation": "Answer explanation (4-6 sentences, each point on its own line). Convey distinct learning value (no repetition): (1) the direct basis — the key grammar/usage/vocabulary rule and how it works in this sentence, (2) the underlying principle — why the rule holds (understanding, not memorization), (3) the trap — which wrong choice is most tempting and why, (4) an applied extension — another short example using the same rule or a memory tip",
    "wrong_explanation": {
      "0": "Why choice 1 is wrong (2-3 sentences): what is wrong + the misconception/trap that makes it tempting + how to correct it",
      "2": "Why choice 3 is wrong (2-3 sentences): same format",
      "3": "Why choice 4 is wrong (2-3 sentences): same format",
      "4": "Why choice 5 is wrong (2-3 sentences): same format"
    }
  }
]`,
      requirements: [
        'Each problem must have exactly 5 choices',
        'Only one answer should be correct (is_correct: true)',
        'explanation must cover, in 4-6 sentences, (1) the direct basis (key grammar/usage/vocabulary rule), (2) the principle behind it, (3) the trap of the most tempting wrong choice, and (4) an applied extension (another example or memory tip), specific enough that a learner can solve similar problems from it alone. No repetition or filler',
        'wrong_explanation must include, for each of the 4 non-correct choices keyed by index (0-based, excluding the correct one), 2-3 sentences on why it is wrong, why it is a tempting distractor (the trap), and how to correct it',
        'Return only JSON format without additional explanation',
      ],
    },
  },
  short_answer: {
    ko: {
      intro: (count, classification) => `다음 분류에 해당하는 영어 단답형 문제 ${count}개를 생성해주세요.\n\n분류: ${classification}`,
      format: `각 문제는 다음 형식의 JSON 배열로 반환해주세요:
[
  {
    "stem": "문제 본문 (빈칸 채우기, 영작 등)",
    "correct_answer": "정답",
    "acceptable_answers": ["정답", "대체 정답1", "대체 정답2"],
    "explanation": "정답 해설 (한국어, 4~6문장, 각 항목 줄바꿈). ① 정답의 근거 — 핵심 문법·표현과 빈칸/영작에서의 작동, ② 그 표현이어야 하는 원리, ③ 허용되는 대체 정답과 안 되는 표현의 경계, ④ 학습자가 흔히 쓰는 오답·실수와 교정 방법"
  }
]`,
      requirements: [
        '정답과 허용 가능한 대체 정답을 모두 포함하세요',
        '빈칸은 ___로 표시하세요',
        'explanation은 ①정답 근거(핵심 문법·표현) ②그 표현의 원리 ③허용 대체 정답과 오답의 경계 ④흔한 실수·교정을 4~6문장으로, 학습자가 스스로 점검할 수 있을 만큼 구체적으로 쓰세요. 반복·군더더기 금지',
        'JSON 형식만 반환하고 다른 설명은 추가하지 마세요',
      ],
    },
    en: {
      intro: (count, classification) => `Generate ${count} short answer English problems.\n\nClassification: ${classification}`,
      format: `Return each problem as a JSON array:
[
  {
    "stem": "Problem text (fill in the blank, etc.)",
    "correct_answer": "Answer",
    "acceptable_answers": ["Answer", "Alt1", "Alt2"],
    "explanation": "Answer explanation (4-6 sentences, each point on its own line): (1) the basis — key grammar/expression and how it works here, (2) why this expression is required, (3) which alternative answers are acceptable vs. not (the boundary), (4) common mistakes learners make and how to fix them"
  }
]`,
      requirements: [
        'Include correct answer and acceptable alternatives',
        'Use ___ for blanks',
        'explanation must cover, in 4-6 sentences, (1) the rationale (key grammar/expression), (2) why that expression is required, (3) the boundary between acceptable and unacceptable answers, and (4) common mistakes and fixes. No filler',
        'Return only JSON format',
      ],
    },
  },
  essay: {
    ko: {
      intro: (count, classification) => `다음 분류에 해당하는 영어 서술형 문제 ${count}개를 생성해주세요.\n\n분류: ${classification}`,
      format: `각 문제는 다음 형식의 JSON 배열로 반환해주세요:
[
  {
    "stem": "서술형 문제 본문 (에세이, 문장 작성 등)",
    "guidelines": "답안 작성 가이드라인 (최소 단어 수, 포함해야 할 내용 등)",
    "sample_answer": "모범 답안",
    "grading_criteria": ["채점 기준 1", "채점 기준 2", "채점 기준 3"],
    "explanation": "문제 해설 및 핵심 포인트 (한국어, 4~6문장, 각 항목 줄바꿈): ① 출제 의도 — 이 문제가 평가하는 능력, ② 강한 답안의 핵심 요소 — 내용·구조·표현 측면, ③ 학생들이 자주 하는 실수, ④ 점수를 끌어올리는 구체적 팁이나 활용 표현 예"
  }
]`,
      requirements: [
        '답안 작성에 필요한 명확한 가이드라인을 제공하세요',
        '채점 기준을 구체적으로 명시하세요',
        'explanation에는 ①출제 의도 ②강한 답안의 핵심 요소(내용·구조·표현) ③학생들이 자주 하는 실수 ④점수를 끌어올리는 구체적 팁이나 표현 예를 4~6문장으로 담되, 학습자가 스스로 답안을 개선할 수 있을 만큼 구체적으로 쓰세요. 군더더기·반복은 금지',
        'JSON 형식만 반환하고 다른 설명은 추가하지 마세요',
      ],
    },
    en: {
      intro: (count, classification) => `Generate ${count} essay-type English problems.\n\nClassification: ${classification}`,
      format: `Return each problem as a JSON array:
[
  {
    "stem": "Essay problem text",
    "guidelines": "Writing guidelines (word count, content requirements)",
    "sample_answer": "Sample answer",
    "grading_criteria": ["Criteria 1", "Criteria 2", "Criteria 3"],
    "explanation": "Key points and explanation (4-6 sentences, each point on its own line): (1) the intent — what skill this assesses, (2) the essential elements of a strong answer (content, structure, expression), (3) common mistakes students make, (4) concrete tips or example phrases that raise the score"
  }
]`,
      requirements: [
        'Provide clear guidelines for answering',
        'Include specific grading criteria',
        'explanation must cover, in 4-6 sentences, (1) the intent of the task, (2) the essential elements of a strong answer (content, structure, expression), (3) common mistakes students make, and (4) concrete tips or example phrases that raise the score, specific enough for a learner to improve their own answer. No filler or repetition',
        'Return only JSON format',
      ],
    },
  },
  ox: {
    ko: {
      intro: (count, classification) => `다음 분류에 해당하는 O/X 문제 ${count}개를 생성해주세요.\n\n분류: ${classification}`,
      format: `각 문제는 다음 형식의 JSON 배열로 반환해주세요:
[
  {
    "stem": "O/X 판단 문장 (영어로)",
    "correct_answer": true,
    "explanation": "정답 해설 (한국어, 4~6문장, 각 항목 줄바꿈): ① 정답이 true/false인 명확한 근거, ② 적용된 핵심 문법·어법 규칙과 그것이 이 문장에서 작동하는 원리, ③ 이 진술에서 학습자가 흔히 헷갈리는 지점(반대로 판단하게 만드는 함정), ④ 기억 팁이나 같은 규칙이 적용되는 다른 짧은 예. 결론은 처음부터 명확히 — 번복·자기모순 금지"
  }
]`,
      requirements: [
        'correct_answer는 true 또는 false로 작성하세요',
        '해설은 4~6문장으로 ①정답 근거 ②적용된 문법·어법 규칙과 그 원리 ③학습자가 헷갈리는 함정 ④기억 팁이나 다른 예를 담되, 학습자가 같은 유형을 스스로 판단할 수 있을 만큼 구체적으로 쓰세요. 불필요한 반복은 피하세요',
        '해설에서 "하지만", "다시 생각하면" 등으로 자기 모순적인 내용을 쓰지 마세요. 결론을 명확하게 서술하세요',
        'JSON 형식만 반환하고 다른 설명은 추가하지 마세요',
      ],
    },
    en: {
      intro: (count, classification) => `Generate ${count} True/False English problems.\n\nClassification: ${classification}`,
      format: `Return each problem as a JSON array:
[
  {
    "stem": "Statement to judge (True/False)",
    "correct_answer": true,
    "explanation": "Answer explanation (4-6 sentences, each point on its own line): (1) the clear basis for why the answer is true/false, (2) the key grammar/usage rule applied and how it works in this sentence, (3) the common point of confusion in this statement (the trap that makes learners judge the opposite), (4) a memory tip or another short example of the same rule. State the conclusion clearly from the start — no reversal or self-contradiction"
  }
]`,
      requirements: [
        'correct_answer should be true or false',
        'Explain in 4-6 sentences: (1) the basis for the answer, (2) the grammar/usage rule applied and its underlying principle, (3) the trap that confuses learners, and (4) a memory tip or another example, specific enough for a learner to judge similar statements on their own. Avoid unnecessary repetition',
        'Do not contradict yourself in the explanation. State the conclusion clearly',
        'Return only JSON format',
      ],
    },
  },
};

/**
 * 문제 생성 프롬프트 빌더
 * @param {object} request - { problemType, problemCount, classification, language, difficulty, includePassage, passageLength, passageTopic, passageGenre, difficultyLevel, vocabLevel, sharedPassage }
 * @returns {string}
 */
export function buildProblemPrompt(request) {
  const { problemType, problemCount, classification, language, difficulty } = request;
  const template = promptTemplates[problemType][language];

  const classificationPath = classification
    ? [classification.depth1, classification.depth2, classification.depth3, classification.depth4]
        .filter(Boolean)
        .join(' > ')
    : (language === 'ko' ? '일반 영어' : 'General English');

  let prompt = template.intro(problemCount, classificationPath);

  if (difficulty) {
    prompt += language === 'ko' ? `\n\n난이도: ${difficulty}` : `\n\nDifficulty: ${difficulty}`;
  }

  if (request.difficultyLevel) {
    prompt += language === 'ko'
      ? `\n\n[문제 난이도]\n문제 난이도는 5단계 중 ${request.difficultyLevel}단계로 설정하라. (1=기초, 3=수능 평균, 5=최고난도)`
      : `\n\n[Difficulty Level]\nSet the problem difficulty to level ${request.difficultyLevel} out of 5. (1=Basic, 3=Average, 5=Most Difficult)`;
  }

  if (request.vocabLevel) {
    prompt += language === 'ko'
      ? `\n\n[어휘 수준]\n사용 어휘 수준은 5단계 중 ${request.vocabLevel}단계로 설정하라. (1=중학 기초, 2=고1, 3=수능, 4=TEPS/편입, 5=GRE/학술)`
      : `\n\n[Vocabulary Level]\nSet the vocabulary level to ${request.vocabLevel} out of 5. (1=Basic/Middle School, 2=High School Year 1, 3=CSAT, 4=TEPS/Transfer, 5=GRE/Academic)`;
  }

  if (request.includePassage) {
    if (request.sharedPassage) {
      prompt += language === 'ko'
        ? `\n\n[지문 기반 출제 지시]\n아래 제공된 영어 지문을 읽고, 이 지문의 내용에 기반하여 문제를 출제하라. 지문 내용을 정확히 이해해야만 풀 수 있는 문제를 만들어라.\n\n--- 지문 ---\n${request.sharedPassage}\n--- 지문 끝 ---`
        : `\n\n[Passage-Based Problem Creation]\nRead the passage below and create problems based on its content. Problems should require accurate understanding of the passage to answer.\n\n--- Passage ---\n${request.sharedPassage}\n--- End of Passage ---`;
    } else {
      prompt += language === 'ko'
        ? `\n\n[지문 포함 지시]\n하나의 영어 지문(passage)을 생성하고, 모든 문제를 그 지문에 기반하여 출제하라. 지문은 학술적이거나 교양적인 내용의 영어 원문이어야 하며, 문제는 해당 지문을 읽고 풀 수 있도록 설계하라. 모든 문제의 "passage" 필드에 동일한 지문을 포함시켜라.`
        : `\n\n[Passage Inclusion]\nGenerate ONE English passage and create ALL problems based on that single passage. The passage should be academic or informational English text, and all problems should be designed to be answered after reading the passage. Include the same passage in the "passage" field of every problem.`;

      if (request.passageLength) {
        prompt += language === 'ko'
          ? `\n지문 길이는 약 ${request.passageLength}자(±100자)로 작성하라.`
          : `\nThe passage length should be approximately ${request.passageLength} characters (±100 characters).`;
      }

      if (request.passageTopic?.category && request.passageTopic?.subfield) {
        prompt += language === 'ko'
          ? `\n지문의 주제는 ${request.passageTopic.category} 분야의 ${request.passageTopic.subfield}에 관한 학술적/교양적 내용으로 작성하라.`
          : `\nThe passage topic should be about ${request.passageTopic.subfield} in the field of ${request.passageTopic.category}, written as academic or informational content.`;
      }

      if (request.passageGenre) {
        prompt += language === 'ko'
          ? `\n지문의 형식(종류)은 반드시 "${request.passageGenre}" 형태로 작성하라. 예: 편지라면 Dear...로 시작, 기사라면 헤드라인+본문, 대화문이라면 A/B 화자 교대 등.`
          : `\nThe passage MUST be written in "${request.passageGenre}" format. For example: a letter should start with "Dear...", a news article should have a headline and body, a dialogue should alternate between speakers, etc.`;
      }
    }
  }

  let formatStr = template.format;
  if (request.includePassage) {
    const passageField = language === 'ko'
      ? '"passage": "지문 전문 (영어 원문)",\n    '
      : '"passage": "Full passage text",\n    ';
    formatStr = formatStr.replace(/\{\s*\n\s+"/, `{\n    ${passageField}"`);
  }

  prompt += '\n\n' + formatStr;
  prompt += '\n\n' + (language === 'ko' ? '중요 사항:' : 'Important:');
  template.requirements.forEach((req, idx) => {
    prompt += `\n${idx + 1}. ${req}`;
  });

  if (request.includePassage) {
    const passageReqIdx = template.requirements.length + 1;
    if (request.sharedPassage) {
      prompt += language === 'ko'
        ? `\n${passageReqIdx}. 각 문제 JSON 객체에 "passage" 필드를 추가하여 위에서 제공한 지문 전문을 그대로 포함하세요.`
        : `\n${passageReqIdx}. Add a "passage" field to each problem JSON object containing the exact passage text provided above.`;
    } else {
      prompt += language === 'ko'
        ? `\n${passageReqIdx}. 모든 문제 JSON 객체의 "passage" 필드에 동일한 지문 전문을 포함하세요.`
        : `\n${passageReqIdx}. Include the same full passage text in the "passage" field of every problem JSON object.`;
    }
  }

  return prompt;
}
