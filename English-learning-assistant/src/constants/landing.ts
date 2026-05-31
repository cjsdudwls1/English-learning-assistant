/**
 * 메인(랜딩) 페이지의 마케팅 섹션 상수.
 * 텍스트만 다루며 컴포넌트 의존성이 없어 별도 분리한다.
 */

export const PIPELINE_STAGES = [
  {
    id: 'pre',
    title: '노이즈 제거/전처리',
    tech: 'OpenCV + CLAHE + Adaptive Thresholding',
    description: '문항 대비를 높이고 조명을 보정해 안정적인 탐지를 보장합니다.',
  },
  {
    id: 'detect',
    title: '문자 검출',
    tech: 'CRAFT + EAST',
    description: '텍스트 라인을 감지하고 박스 형태로 시각화합니다.',
  },
  {
    id: 'recognize',
    title: '문자 인식',
    tech: 'ViT + CNN + BiLSTM + CTC',
    description: '문자열 시퀀스를 추론해 토큰을 생성합니다.',
  },
  {
    id: 'math',
    title: '수식 인식',
    tech: 'Im2Latex (CNN Encoder + Transformer Decoder)',
    description: '수식을 LaTeX 형태로 복원합니다.',
  },
] as const;

export const HIGHLIGHTS = [
  {
    id: 'mobile',
    title: '모바일 중심 분석',
    description: '모바일에서 촬영한 문제 이미지를 자동으로 분석하고 채점합니다.',
    tag: '모바일 최적화',
  },
  {
    id: 'ai-analysis',
    title: 'AI 자동 채점',
    description: 'Gemini AI가 문제를 자동으로 인식하고 정답/오답을 판단합니다.',
    tag: 'AI 기반',
  },
  {
    id: 'statistics',
    title: '학습 통계 제공',
    description: '문제 유형별, 카테고리별 상세한 학습 통계를 제공합니다.',
    tag: '데이터 분석',
  },
] as const;

export const METRICS = [
  { id: 'accuracy', label: '분석 정확도', value: '95%+', detail: 'AI 기반 자동 채점' },
  { id: 'speed', label: '평균 분석 시간', value: '10-60초', detail: '이미지당 처리 시간' },
  { id: 'coverage', label: '지원 문제 유형', value: '4가지', detail: '객관식/단답형/서술형/OX' },
  { id: 'languages', label: '다국어 지원', value: '한/영', detail: '한국어 및 영어' },
] as const;

export const USE_CASES = [
  {
    id: 'student',
    title: '학생',
    description: '문제를 촬영하면 자동으로 분석되고, 틀린 문제를 다시 풀어볼 수 있습니다.',
    bullets: ['자동 채점', '틀린 문제 재시도', '학습 통계 확인'],
  },
  {
    id: 'parent',
    title: '학부모',
    description: '자녀의 학습 현황을 한눈에 파악하고, 취약 영역을 확인할 수 있습니다.',
    bullets: ['학습 통계 확인', '취약 영역 파악', '진도 추적'],
  },
  {
    id: 'teacher',
    title: '선생님',
    description: '학생들의 문제 풀이를 빠르게 확인하고, 유사 문제를 생성할 수 있습니다.',
    bullets: ['빠른 채점', '유사 문제 생성', '학급 통계'],
  },
] as const;

export const FAQS = [
  {
    q: '어떤 형식의 이미지를 업로드할 수 있나요?',
    a: 'JPG, PNG, WEBP 등 일반적인 이미지 형식을 지원합니다. 여러 이미지를 한 번에 업로드할 수 있습니다.',
  },
  {
    q: 'AI 분석은 얼마나 걸리나요?',
    a: '이미지당 약 10-60초 정도 소요됩니다. 분석은 백그라운드에서 진행되며, 완료되면 통계 페이지에서 확인할 수 있습니다.',
  },
  {
    q: '틀린 문제를 다시 풀 수 있나요?',
    a: '네, 통계 페이지에서 틀린 문제만 필터링하여 다시 풀어볼 수 있습니다. 유사 문제도 생성할 수 있습니다.',
  },
  {
    q: '데이터는 안전하게 보관되나요?',
    a: '모든 데이터는 사용자별로 격리되어 저장되며, 다른 사용자의 데이터에 접근할 수 없습니다.',
  },
] as const;
