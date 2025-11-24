export type Language = 'ko' | 'en';

export interface Translations {
  // 공통
  common: {
    save: string;
    cancel: string;
    close: string;
    delete: string;
    edit: string;
    loading: string;
    error: string;
    success: string;
    confirm: string;
    yes: string;
    no: string;
  };
  
  // 업로드 페이지
  upload: {
    title: string;
    description: string;
    uploadButton: string;
    uploading: string;
    uploadCount: string;
  };
  
  // 통계 페이지
  stats: {
    title: string;
    statsByType: string;
    periodSetting: string;
    startDate: string;
    endDate: string;
    oneMonth: string;
    threeMonths: string;
    sixMonths: string;
    thisYear: string;
    total: string;
    correct: string;
    incorrect: string;
    accuracy: string;
    category: string;
    reclassifyAll: string;
    reclassifying: string;
    generateSimilar: string;
    generating: string;
    selectCategory: string;
    selectLeafCategory: string;
    generatedProblems: string;
    close: string;
    chartOverview: string;
    correctVsIncorrectChart: string;
    categoryDistributionChart: string;
    noData: string;
    unclassified: string;
  };
  
  // 최근 문제 페이지
  recent: {
    title: string;
    noProblems: string;
    problemCount: string;
    viewDetails: string;
    loadMore: string;
  };
  
  // 라벨링 카드
  labeling: {
    correct: string;
    incorrect: string;
    viewDetails: string;
    finalSave: string;
    saving: string;
  };
  
  // 유사문제 카드
  practice: {
    problem: string;
    correct: string;
    incorrect: string;
    answer: string;
    explanation: string;
    selectedAnswer: string;
    wrongExplanation: string;
    noExplanation: string;
    timeSpent: string;
    summaryTitle: string;
  };
  
  // 세션 상세
  session: {
    title: string;
    back: string;
    delete: string;
    deleteConfirm: string;
  };
  
  // 프로필
  profile: {
    title: string;
    name: string;
    age: string;
    grade: string;
    language: string;
    korean: string;
    english: string;
    save: string;
    saving: string;
  };
  
  // 로그인
    login: {
      login: string;
      signup: string;
      email: string;
      password: string;
      name: string;
      age: string;
      grade: string;
      gender: string;
      language: string;
      korean: string;
      english: string;
      selectLanguage: string;
      processing: string;
    };
  
  // 헤더
  header: {
    upload: string;
    stats: string;
    recent: string;
    profile: string;
    logout: string;
  };
  
  // 앱 공통
  app: {
    title: string;
    description: string;
    customerSupport: string;
  };
  
  // 예시 문장 생성
  example: {
    generate: string;
    generating: string;
    selectCategory: string;
  };
  
  // 문제 메타데이터
  problemMetadata: {
    difficulty: string;
    wordDifficulty: string;
    problemType: string;
    analysis: string;
  };
  
  // 분류 정보
  taxonomy: {
    classificationDetails: string;
    classificationHierarchy: string;
    definition: string;
    coreRule: string;
    errorSignals: string;
    examples: string;
    wrong: string;
    correct: string;
    relatedRules: string;
    metadata: string;
    difficulty: string;
    tags: string;
  };
}

export const translations: Record<Language, Translations> = {
  ko: {
    common: {
      save: '저장',
      cancel: '취소',
      close: '닫기',
      delete: '삭제',
      edit: '수정',
      loading: '불러오는 중...',
      error: '오류',
      success: '성공',
      confirm: '확인',
      yes: '예',
      no: '아니오',
    },
    upload: {
      title: '영어 문제 이미지 업로드',
      description: '손글씨로 푼 영어 문제 이미지를 업로드하세요.',
      uploadButton: '이미지 올리기',
      uploading: '업로드 중...',
      uploadCount: '개',
      sectionTitle: '문제 이미지 업로드',
      selectFile: '파일 선택',
      noFileSelected: '선택된 파일 없음',
      filesSelected: '개 파일 선택됨',
      multipleImages: '여러 이미지를 한번에 선택할 수 있습니다',
      selectedImages: '선택된 이미지',
      clearAll: '전체 삭제',
      delete: '삭제',
      rotateHint: '회전 버튼을 사용하여 각 이미지 방향을 조정할 수 있습니다',
    },
    stats: {
      title: '통계',
      statsByType: '유형별 정오답 통계',
      periodSetting: '기간 설정:',
      startDate: '시작일:',
      endDate: '종료일:',
      oneMonth: '1개월',
      threeMonths: '3개월',
      sixMonths: '6개월',
      thisYear: '올 한 해',
      total: '전체',
      correct: '정답',
      incorrect: '오답',
      accuracy: '정답률',
      category: '카테고리',
      reclassifyAll: '🔄 전체 문제 재분류',
      reclassifying: '재분류 중...',
      generateSimilar: '유사 문제 생성',
      generating: '생성 중...',
      selectCategory: '문제 유형을 선택해주세요.',
      selectLeafCategory: '최하위 depth의 문제 유형을 선택해주세요.',
      generatedProblems: '생성된 유사 문제',
      close: '닫기',
      chartOverview: '차트로 보는 통계',
      correctVsIncorrectChart: '정오답 비율',
      categoryDistributionChart: '상위 유형별 정오답',
      noData: '표시할 데이터가 없습니다.',
      unclassified: '미분류',
    },
    recent: {
      title: '최근 업로드한 문제',
      noProblems: '업로드한 문제가 없습니다.',
      problemCount: '개',
      viewDetails: '상세보기',
      loadMore: '더보기',
    },
    labeling: {
      correct: '정답',
      incorrect: '오답',
      viewDetails: '상세보기',
      finalSave: '최종 저장',
      saving: '저장 중...',
    },
    practice: {
      problem: '문제',
      correct: '정답',
      incorrect: '오답',
      answer: '정답',
      explanation: '정답 해설',
      selectedAnswer: '선택하신 답 해설',
      wrongExplanation: '선택하신 답 오답 해설',
      noExplanation: '이 선택지가 왜 오답인지에 대한 설명이 없습니다.',
      timeSpent: '소요 시간',
      summaryTitle: '유사 문제 풀이 결과',
    },
    session: {
      title: '세션 상세',
      back: '뒤로',
      delete: '삭제',
      deleteConfirm: '이 세션을 삭제하시겠습니까?',
    },
    profile: {
      title: '프로필',
      myProfile: '내 프로필',
      back: '돌아가기',
      name: '이름',
      email: '이메일',
      gender: '성별',
      male: '남성',
      female: '여성',
      age: '연령',
      agePlaceholder: '예: 15',
      grade: '학년',
      selectGrade: '선택하세요',
      language: '언어',
      korean: '한국어',
      english: 'English',
      save: '저장',
      saving: '저장 중...',
      cancel: '취소',
      saved: '프로필이 성공적으로 저장되었습니다.',
      loadError: '프로필을 불러오는데 실패했습니다.',
      saveError: '프로필 저장 중 오류가 발생했습니다.',
    },
    login: {
      login: '로그인',
      signup: '회원가입',
      email: '이메일',
      password: '비밀번호',
      name: '이름',
      age: '나이',
      grade: '학년',
      gender: '성별',
      language: '언어',
      korean: '한국어',
      english: 'English',
      selectLanguage: '언어를 선택해주세요.',
      processing: '처리 중...',
    },
    header: {
      upload: '업로드',
      stats: '통계',
      recent: '최근 문제',
      profile: '프로필',
      logout: '로그아웃',
    },
    app: {
      title: 'AI 영어 문제 분석기',
      description: '손글씨로 푼 문제 이미지를 업로드하고 AI의 정밀 분석을 받아보세요.',
      customerSupport: '고객지원',
    },
    example: {
      generate: '예시 문장 생성',
      generating: '생성 중...',
      selectCategory: '카테고리를 선택해주세요.',
    },
    problemMetadata: {
      difficulty: '난이도',
      wordDifficulty: '단어 난이도',
      problemType: '문제 유형',
      analysis: '분석 정보',
    },
    taxonomy: {
      classificationDetails: '분류 상세 정보',
      classificationHierarchy: '분류 계층',
      definition: '정의',
      coreRule: '핵심 규칙',
      errorSignals: '오류 신호',
      examples: '예시',
      wrong: '오류 예시',
      correct: '정답 예시',
      relatedRules: '관련 규칙',
      metadata: '메타데이터',
      difficulty: '난이도',
      tags: '태그',
    },
  },
  en: {
    common: {
      save: 'Save',
      cancel: 'Cancel',
      close: 'Close',
      delete: 'Delete',
      edit: 'Edit',
      loading: 'Loading...',
      error: 'Error',
      success: 'Success',
      confirm: 'Confirm',
      yes: 'Yes',
      no: 'No',
    },
    upload: {
      title: 'Upload English Problem Image',
      description: 'Upload an image of an English problem you solved by hand.',
      uploadButton: 'Upload Image',
      uploading: 'Uploading...',
      uploadCount: '',
      sectionTitle: 'Upload Problem Image',
      selectFile: 'Choose File',
      noFileSelected: 'No file selected',
      filesSelected: 'file(s) selected',
      multipleImages: 'You can select multiple images at once',
      selectedImages: 'Selected Images',
      clearAll: 'Clear All',
      delete: 'Delete',
      rotateHint: 'Use the rotate button to adjust the orientation of each image',
    },
    stats: {
      title: 'Statistics',
      statsByType: 'Statistics by Type',
      periodSetting: 'Period Setting:',
      startDate: 'Start Date:',
      endDate: 'End Date:',
      oneMonth: '1 Month',
      threeMonths: '3 Months',
      sixMonths: '6 Months',
      thisYear: 'This Year',
      total: 'Total',
      correct: 'Correct',
      incorrect: 'Incorrect',
      accuracy: 'Accuracy',
      category: 'Category',
      reclassifyAll: '🔄 Reclassify All Problems',
      reclassifying: 'Reclassifying...',
      generateSimilar: 'Generate Similar Problems',
      generating: 'Generating...',
      selectCategory: 'Please select a problem type.',
      selectLeafCategory: 'Please select a leaf category (lowest depth).',
      generatedProblems: 'Generated Similar Problems',
      close: 'Close',
      chartOverview: 'Statistics Overview',
      correctVsIncorrectChart: 'Correct vs Incorrect',
      categoryDistributionChart: 'Top Categories',
      noData: 'No data available.',
      unclassified: 'Unclassified',
    },
    problemMetadata: {
      difficulty: 'Difficulty',
      wordDifficulty: 'Word Difficulty',
      problemType: 'Problem Type',
      analysis: 'Analysis',
    },
    recent: {
      title: 'Recently Uploaded Problems',
      noProblems: 'No problems uploaded yet.',
      problemCount: '',
      viewDetails: 'View Details',
      loadMore: 'Load More',
    },
    labeling: {
      correct: 'Correct',
      incorrect: 'Incorrect',
      viewDetails: 'View Details',
      finalSave: 'Final Save',
      saving: 'Saving...',
    },
    practice: {
      problem: 'Problem',
      correct: 'Correct',
      incorrect: 'Incorrect',
      answer: 'Answer',
      explanation: 'Explanation',
      selectedAnswer: 'Your Answer Explanation',
      wrongExplanation: 'Wrong Answer Explanation',
      noExplanation: 'No explanation available for why this choice is incorrect.',
      timeSpent: 'Time Spent',
      summaryTitle: 'Practice Summary',
    },
    session: {
      title: 'Session Details',
      back: 'Back',
      delete: 'Delete',
      deleteConfirm: 'Are you sure you want to delete this session?',
    },
    profile: {
      title: 'Profile',
      myProfile: 'My Profile',
      back: 'Back',
      name: 'Name',
      email: 'Email',
      gender: 'Gender',
      male: 'Male',
      female: 'Female',
      age: 'Age',
      agePlaceholder: 'e.g., 15',
      grade: 'Grade',
      selectGrade: 'Select',
      language: 'Language',
      korean: '한국어',
      english: 'English',
      save: 'Save',
      saving: 'Saving...',
      cancel: 'Cancel',
      saved: 'Profile saved successfully.',
      loadError: 'Failed to load profile.',
      saveError: 'An error occurred while saving the profile.',
    },
    login: {
      login: 'Login',
      signup: 'Sign Up',
      email: 'Email',
      password: 'Password',
      name: 'Name',
      age: 'Age',
      grade: 'Grade',
      gender: 'Gender',
      language: 'Language',
      korean: '한국어',
      english: 'English',
      selectLanguage: 'Please select a language.',
      processing: 'Processing...',
    },
    header: {
      upload: 'Upload',
      stats: 'Statistics',
      recent: 'Recent',
      profile: 'Profile',
      logout: 'Logout',
    },
    app: {
      title: 'AI English Problem Analyzer',
      description: 'Upload images of problems you solved by hand and get precise AI analysis.',
      customerSupport: 'Customer Support',
    },
    example: {
      generate: 'Generate Example Sentence',
      generating: 'Generating...',
      selectCategory: 'Please select a category.',
    },
    problemMetadata: {
      difficulty: 'Difficulty',
      wordDifficulty: 'Word Difficulty',
      problemType: 'Problem Type',
      analysis: 'Analysis',
    },
    taxonomy: {
      classificationDetails: 'Classification Details',
      classificationHierarchy: 'Classification Hierarchy',
      definition: 'Definition',
      coreRule: 'Core Rule',
      errorSignals: 'Error Signals',
      examples: 'Examples',
      wrong: 'Wrong',
      correct: 'Correct',
      relatedRules: 'Related Rules',
      metadata: 'Metadata',
      difficulty: 'Difficulty',
      tags: 'Tags',
    },
  },
};

export function getTranslation(language: Language): Translations {
  return translations[language];
}

