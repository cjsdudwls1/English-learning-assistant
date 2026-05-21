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
    "explanation": "정답 해설 (한국어로)"
  }
]`,
      requirements: [
        '각 문제는 정확히 5개의 선택지를 가져야 합니다 (5지선다형)',
        '정답은 하나만 있어야 합니다 (is_correct: true)',
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
    "explanation": "Answer explanation"
  }
]`,
      requirements: [
        'Each problem must have exactly 5 choices',
        'Only one answer should be correct (is_correct: true)',
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
    "explanation": "정답 해설 (한국어로)"
  }
]`,
      requirements: [
        '정답과 허용 가능한 대체 정답을 모두 포함하세요',
        '빈칸은 ___로 표시하세요',
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
    "explanation": "Answer explanation"
  }
]`,
      requirements: [
        'Include correct answer and acceptable alternatives',
        'Use ___ for blanks',
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
    "explanation": "문제 해설 및 핵심 포인트"
  }
]`,
      requirements: [
        '답안 작성에 필요한 명확한 가이드라인을 제공하세요',
        '채점 기준을 구체적으로 명시하세요',
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
    "explanation": "Key points and explanation"
  }
]`,
      requirements: [
        'Provide clear guidelines for answering',
        'Include specific grading criteria',
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
    "explanation": "정답 해설 (한국어로, 2~3문장 이내)"
  }
]`,
      requirements: [
        'correct_answer는 true 또는 false로 작성하세요',
        '해설은 반드시 2~3문장 이내로 간결하게 작성하세요. 장황한 설명은 금지합니다',
        '해설에서 "하지만", "다시 생각하면" 등으로 자기 모순적인 내용을 쓰지 마세요. 결론만 명확하게 서술하세요',
        'explanation 값에는 왜 정답이 true/false인지 핵심 근거만 포함하세요',
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
    "explanation": "Brief explanation (2-3 sentences max)"
  }
]`,
      requirements: [
        'correct_answer should be true or false',
        'Keep explanation to 2-3 sentences maximum. Be concise and direct',
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
