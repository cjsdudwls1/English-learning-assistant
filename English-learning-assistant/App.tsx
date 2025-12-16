import React, { useState, useCallback, useRef } from 'react';
import { Routes, Route, Link, useLocation, useNavigate } from 'react-router-dom';
import { supabase } from './services/supabaseClient';
import { AuthGate } from './components/AuthGate';
import { LogoutButton } from './components/LoginButton';
import { ThemeToggle } from './components/ThemeToggle';
import { LanguageToggle } from './components/LanguageToggle';
import { TopBar } from './components/TopBar';
import { PageLayout } from './components/PageLayout';
import { EditPage } from './pages/EditPage';
import { StatsPage } from './pages/StatsPage';
import { RecentProblemsPage } from './pages/RecentProblemsPage';
import { AnalyzingPage } from './pages/AnalyzingPage';
import { SessionDetailPage } from './pages/SessionDetailPage';
import { RetryProblemsPage } from './pages/RetryProblemsPage';
import { ProfilePage } from './pages/ProfilePage';
import { useLanguage } from './contexts/LanguageContext';
import { useTheme } from './contexts/ThemeContext';
import { getTranslation } from './utils/translations';
import { ImageRotator } from './components/ImageRotator';
import { Loader } from './components/Loader';
import './styles/app.css';

// eduscope-ai에만 있는 기능 (UI만 유지)
const PIPELINE_STAGES = [
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

const HIGHLIGHTS = [
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

const METRICS = [
  { id: 'accuracy', label: '분석 정확도', value: '95%+', detail: 'AI 기반 자동 채점' },
  { id: 'speed', label: '평균 분석 시간', value: '10-60초', detail: '이미지당 처리 시간' },
  { id: 'coverage', label: '지원 문제 유형', value: '4가지', detail: '객관식/단답형/서술형/OX' },
  { id: 'languages', label: '다국어 지원', value: '한/영', detail: '한국어 및 영어' },
] as const;

const USE_CASES = [
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

const FAQS = [
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

interface ImageFile {
  file: File;
  previewUrl: string;
  id: string;
}

// 메인 페이지 컴포넌트 (eduscope-ai 스타일)
const MainPage: React.FC<{
  imageFiles: ImageFile[];
  isLoading: boolean;
  error: string | null;
  status: 'idle' | 'loading' | 'done' | 'error';
  onFileChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onAnalyzeClick: () => void;
  onRemove: (index: number) => void;
  onRotate: (index: number, blob: Blob) => void;
}> = ({ imageFiles, isLoading, error, status, onFileChange, onAnalyzeClick, onRemove, onRotate }) => {
  const { language } = useLanguage();
  const t = getTranslation(language);
  const fileInputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="page-shell">
      <div className="bg-grid" aria-hidden="true" />
      <TopBar status={status} />

      <main className="page-content">
        <section className="hero" id="top">
          <div className="hero-copy">
            <p className="eyebrow">AI 기반 영어 문제 분석 시스템</p>
            <h1>
              손글씨 문제까지 <br />
              한 번에 분석하는 <span>AI 영어 문제 분석기</span>
            </h1>
            <p className="lede">
              {language === 'ko' 
                ? '문제 이미지를 업로드하면 AI가 자동으로 인식하고 채점합니다. 틀린 문제는 다시 풀어보고, 상세한 학습 통계를 확인할 수 있습니다.'
                : 'Upload problem images and AI will automatically recognize and grade them. Review incorrect problems and check detailed learning statistics.'}
            </p>
            <div className="hero-actions">
              <a className="primary" href="#lab">
                {language === 'ko' ? '지금 시작하기' : 'Get Started'}
              </a>
              <Link className="ghost" to="/stats">
                {language === 'ko' ? '통계 보기' : 'View Stats'}
              </Link>
            </div>
            <div className="hero-tags">
              <span>{language === 'ko' ? '자동 채점' : 'Auto Grading'}</span>
              <span>{language === 'ko' ? '학습 통계' : 'Statistics'}</span>
              <span>{language === 'ko' ? '유사 문제' : 'Similar Problems'}</span>
              <span>{language === 'ko' ? '모바일 최적화' : 'Mobile Optimized'}</span>
            </div>
          </div>
          <div className="hero-panel">
            <div className="hero-panel__header">
              <div>
                <p className="eyebrow">실시간 분석</p>
                <strong>{language === 'ko' ? '간단히 업로드 → AI 분석 → 결과 확인' : 'Upload → AI Analysis → View Results'}</strong>
              </div>
              <span className="hero-badge">{imageFiles.length > 0 ? (language === 'ko' ? '이미지 준비 완료' : 'Images Ready') : (language === 'ko' ? '이미지를 올려보세요' : 'Upload Images')}</span>
            </div>
            <div className="hero-mini">
              <div className="mini-row">
                <span>{language === 'ko' ? '파일' : 'Files'}</span>
                <p>{imageFiles.length > 0 ? `${imageFiles.length} ${language === 'ko' ? '개' : 'files'}` : (language === 'ko' ? '선택된 파일 없음' : 'No files selected')}</p>
              </div>
              <div className="mini-row">
                <span>{language === 'ko' ? '상태' : 'Status'}</span>
                <p>{status === 'idle' ? (language === 'ko' ? '대기 중' : 'Idle') : status === 'loading' ? (language === 'ko' ? '분석 중' : 'Analyzing') : status === 'done' ? (language === 'ko' ? '완료' : 'Done') : (language === 'ko' ? '오류' : 'Error')}</p>
              </div>
            </div>
          </div>
        </section>

        <section className="metrics">
          <div className="section-head">
            <div>
              <p className="eyebrow">{language === 'ko' ? '성능 · 정확도' : 'Performance · Accuracy'}</p>
              <h2>{language === 'ko' ? '높은 정확도의 AI 분석' : 'High Accuracy AI Analysis'}</h2>
            </div>
            <p className="muted">
              {language === 'ko' 
                ? '실제 서비스 환경에서 측정된 정확도와 성능을 제공합니다.'
                : 'We provide accuracy and performance measured in real service environments.'}
            </p>
          </div>
          <div className="metrics-grid">
            {METRICS.map((metric) => (
              <article key={metric.id} className="metric-card">
                <p className="metric-value">{metric.value}</p>
                <h3>{metric.label}</h3>
                <p className="muted">{metric.detail}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="solutions" id="solutions">
          <div className="section-head">
            <div>
              <p className="eyebrow">{language === 'ko' ? '주요 기능' : 'Key Features'}</p>
              <h2>{language === 'ko' ? '학습자와 교육자를 위한 솔루션' : 'Solutions for Learners and Educators'}</h2>
            </div>
            <p className="muted">
              {language === 'ko' 
                ? '학생, 학부모, 선생님 모두가 활용할 수 있는 다양한 기능을 제공합니다.'
                : 'We provide various features that students, parents, and teachers can all use.'}
            </p>
          </div>
          <div className="usecase-grid">
            {USE_CASES.map((usecase) => (
              <article key={usecase.id} className="usecase-card">
                <h3>{usecase.title}</h3>
                <p>{usecase.description}</p>
                <ul>
                  {usecase.bullets.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </article>
            ))}
          </div>

          <div className="highlights" id="stories">
            <div className="section-head">
              <div>
                <p className="eyebrow">{language === 'ko' ? '핵심 차별화' : 'Key Differentiators'}</p>
                <h3>{language === 'ko' ? '촬영부터 통계까지 한 번에' : 'From Capture to Statistics'}</h3>
              </div>
              <p className="muted">{language === 'ko' ? '모바일 최적화, AI 자동 채점, 상세한 학습 통계를 함께 제공합니다.' : 'We provide mobile optimization, AI auto-grading, and detailed learning statistics.'}</p>
            </div>
            <div className="highlight-grid">
              {HIGHLIGHTS.map((card) => (
                <article key={card.id} className="highlight-card">
                  <span className="tag">{card.tag}</span>
                  <h3>{card.title}</h3>
                  <p>{card.description}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="lab" id="lab">
          <div className="section-head">
            <div>
              <p className="eyebrow">{language === 'ko' ? '이미지 업로드 · AI 분석' : 'Image Upload · AI Analysis'}</p>
              <h2>{language === 'ko' ? '영어 문제 이미지 분석' : 'English Problem Image Analysis'}</h2>
            </div>
            <p className="muted">
              {language === 'ko' 
                ? '문제 이미지를 업로드하면 AI가 자동으로 분석합니다. 분석은 백그라운드에서 진행되며, 통계 페이지에서 결과를 확인할 수 있습니다.'
                : 'Upload problem images and AI will automatically analyze them. Analysis runs in the background, and you can check results on the statistics page.'}
            </p>
          </div>
          {error && <p className="error-text">{error}</p>}
          <div className="lab-grid">
            <div className="lab-left">
              <div className="panel upload-panel">
                <div>
                  <label htmlFor="image-input" className="file-label">
                    {t.upload.sectionTitle}
                  </label>
                  <input
                    id="image-input"
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={onFileChange}
                    className="file-input"
                  />
                  {imageFiles.length > 0 && (
                    <p className="file-meta">
                      {imageFiles.length} {language === 'ko' ? '개 파일 선택됨' : 'files selected'}
                    </p>
                  )}
                </div>
                <div className="action-stack">
                  <button 
                    className="primary" 
                    onClick={onAnalyzeClick}
                    disabled={imageFiles.length === 0 || isLoading}
                  >
                    {isLoading 
                      ? (language === 'ko' ? '분석 중…' : 'Analyzing...')
                      : `${t.upload.uploadButton} (${imageFiles.length}${t.upload.uploadCount})`
                    }
                  </button>
                </div>
              </div>

              <div className="panel canvas-panel">
                {imageFiles.length > 0 ? (
                  <div className="image-grid">
                    {imageFiles.map((imageFile, index) => (
                      <div key={imageFile.id} className="image-item">
                        <button
                          onClick={() => onRemove(index)}
                          className="image-item-remove"
                          title={t.upload.delete}
                        >
                          ×
                        </button>
                        <div style={{ padding: '0.5rem' }}>
                          <ImageRotator
                            imageUrl={imageFile.previewUrl}
                            onRotate={(blob) => onRotate(index, blob)}
                            className="max-w-full max-h-[300px] object-contain"
                          />
                        </div>
                        <div className="image-item-name">
                          {imageFile.file.name}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="placeholder">
                    {language === 'ko' 
                      ? '이미지를 선택하면 여기에서 미리볼 수 있습니다.'
                      : 'Select images to preview them here.'}
                  </div>
                )}
                <p className="muted note">
                  {language === 'ko' 
                    ? '이미지를 클릭하여 회전시킬 수 있습니다. 삭제하려면 × 버튼을 클릭하세요.'
                    : 'Click images to rotate them. Click × to delete.'}
                </p>
              </div>
            </div>

            <div className="lab-right">
              <section className="panel details-panel">
                <div className="panel-head">
                  <div>
                    <p className="eyebrow">{language === 'ko' ? '업로드 정보' : 'Upload Info'}</p>
                    <h3>{language === 'ko' ? '선택된 이미지' : 'Selected Images'}</h3>
                  </div>
                </div>
                
                {imageFiles.length > 0 ? (
                  <div>
                    <p className="muted">
                      {language === 'ko' 
                        ? `총 ${imageFiles.length}개의 이미지가 선택되었습니다.`
                        : `${imageFiles.length} image(s) selected.`}
                    </p>
                    <div className="info-message" style={{ marginTop: '1rem' }}>
                      <p>
                        {language === 'ko' 
                          ? '📸 이미지를 업로드하면 즉시 "업로드되었습니다!" 메시지가 표시됩니다. AI 분석은 백그라운드에서 진행되며, 통계 페이지에서 결과를 확인할 수 있습니다.'
                          : '📸 When you upload an image, you will immediately see an "Uploaded!" message. AI analysis runs in the background, and you can check the results on the statistics page.'}
                      </p>
                    </div>
                  </div>
                ) : (
                  <p className="muted">
                    {language === 'ko' 
                      ? '이미지를 선택하면 여기에 정보가 표시됩니다.'
                      : 'Image information will appear here when you select images.'}
                  </p>
                )}

                {isLoading && (
                  <div className="loader-container">
                    <Loader />
                  </div>
                )}
              </section>
            </div>
          </div>
        </section>

        <section className="panel pipeline" id="pipeline">
          <div className="section-head">
            <div>
              <p className="eyebrow">Tech Stack</p>
              <h2>{language === 'ko' ? 'AI 분석 파이프라인' : 'AI Analysis Pipeline'}</h2>
            </div>
            <p className="muted">
              {language === 'ko' 
                ? '이미지 업로드부터 AI 분석, 데이터 저장까지 순차적으로 실행합니다.'
                : 'Runs sequentially from image upload to AI analysis to data storage.'}
            </p>
          </div>
          <div className="timeline">
            {PIPELINE_STAGES.map((stage, index) => (
              <article key={stage.id} className="timeline-card">
                <div className="timeline-step">Step {index + 1}</div>
                <h3>{stage.title}</h3>
                <p className="tech">{stage.tech}</p>
                <p>{stage.description}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="panel faq" id="faq">
          <div className="section-head">
            <div>
              <p className="eyebrow">FAQ</p>
              <h2>{language === 'ko' ? '자주 받는 질문' : 'Frequently Asked Questions'}</h2>
            </div>
            <p className="muted">{language === 'ko' ? '사용 방법, 기능, 보안에 대한 질문을 정리했습니다.' : 'We have compiled questions about usage, features, and security.'}</p>
          </div>
          <div className="faq-grid">
            {FAQS.map((item, idx) => (
              <article key={idx} className="faq-card">
                <h3>{item.q}</h3>
                <p>{item.a}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="panel cta" id="cta">
          <div>
            <p className="eyebrow">{language === 'ko' ? '지금 시작하기' : 'Get Started'}</p>
            <h2>{language === 'ko' ? 'AI 영어 문제 분석을 시작하세요' : 'Start AI English Problem Analysis'}</h2>
            <p className="muted">
              {language === 'ko' 
                ? '이미지 업로드부터 통계 확인까지 모든 기능을 무료로 이용할 수 있습니다.'
                : 'All features from image upload to statistics are available for free.'}
            </p>
          </div>
          <div className="cta-actions">
            <a className="primary" href="#lab">
              {language === 'ko' ? '지금 시작하기' : 'Get Started'}
            </a>
            <Link className="ghost muted-text" to="/stats">
              {language === 'ko' ? '통계 보기' : 'View Statistics'}
            </Link>
          </div>
        </section>
      </main>
    </div>
  );
};

const App: React.FC = () => {
  const { language } = useLanguage();
  const location = useLocation();
  const navigate = useNavigate();
  const [imageFiles, setImageFiles] = useState<ImageFile[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const fileInputRef = useRef<HTMLInputElement>(null);


  const fileToBase64 = (file: File): Promise<{ base64: string; mimeType: string }> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => {
        const result = reader.result as string;
        const [header, data] = result.split(',');
        const mimeType = header.match(/:(.*?);/)?.[1] || 'application/octet-stream';
        resolve({ base64: data, mimeType });
      };
      reader.onerror = (error) => reject(error);
    });
  };

  const handleAnalyzeClick = useCallback(async () => {
    if (imageFiles.length === 0) {
      setError(language === 'ko' ? '분석할 이미지를 먼저 업로드해주세요.' : 'Please upload an image to analyze first.');
      return;
    }

    setIsLoading(true);
    setStatus('loading');
    setError(null);

    try {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) {
        setError(language === 'ko' ? '로그인이 필요합니다.' : 'Login required.');
        setIsLoading(false);
        setStatus('error');
        return;
      }
      
      const currentLanguage = language;

      if (!import.meta.env.VITE_SUPABASE_URL || !import.meta.env.VITE_SUPABASE_ANON_KEY) {
        setError(language === 'ko' ? '환경 변수가 설정되지 않았습니다.' : 'Environment variables are not set.');
        setIsLoading(false);
        setStatus('error');
        return;
      }

      console.log(`Starting upload and analysis for ${imageFiles.length} images...`);
      const functionUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/analyze-image`;
      const session = await supabase.auth.getSession();
      const accessToken = session.data.session?.access_token;

      // accessToken 검증
      if (!accessToken) {
        const errorMsg = language === 'ko' ? '인증 토큰이 없습니다. 다시 로그인해주세요.' : 'Authentication token is missing. Please login again.';
        console.error('Access token is missing. Session:', session);
        setError(errorMsg);
        setIsLoading(false);
        setStatus('error');
        alert(errorMsg);
        return;
      }

      if (!userData.user?.id) {
        const errorMsg = language === 'ko' ? '사용자 ID를 가져올 수 없습니다. 다시 로그인해주세요.' : 'Cannot get user ID. Please login again.';
        console.error('User ID is missing. UserData:', userData);
        setError(errorMsg);
        setIsLoading(false);
        setStatus('error');
        alert(errorMsg);
        return;
      }

      // 모든 이미지를 base64로 변환
      console.log(`Converting ${imageFiles.length} files to base64...`);
      const imagesArray = await Promise.all(
        imageFiles.map(async (imageFile, index) => {
          try {
            console.log(`[${index}] Processing file:`, imageFile.file.name, 'Size:', imageFile.file.size, 'Type:', imageFile.file.type);
            const { base64, mimeType } = await fileToBase64(imageFile.file);
            console.log(`[${index}] File converted to base64:`, imageFile.file.name, 'Base64 length:', base64?.length, 'MimeType:', mimeType);
            
            if (!base64 || typeof base64 !== 'string' || !base64.trim()) {
              console.error(`[${index}] Invalid base64:`, imageFile.file.name);
              throw new Error(`Invalid base64 for file: ${imageFile.file.name}`);
            }
            
            return {
              imageBase64: base64,
              mimeType: mimeType || 'image/jpeg',
              fileName: imageFile.file.name,
            };
          } catch (convertError) {
            console.error(`[${index}] Failed to convert file:`, imageFile.file.name, convertError);
            throw convertError;
          }
        })
      );

      // ✅ Edge Function(analyze-image)은 멀티 이미지 입력(images[])을 지원
      // => 여러 이미지를 한 번에 전송해서 "한 세션"으로 분석(문항 연속성 유지)
      console.log(`Sending analyze-image request with ${imagesArray.length} image(s)...`);

      const response = await fetch(functionUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          images: imagesArray,
          userId: userData.user.id,
          language: currentLanguage,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Edge Function error:', response.status, errorText);
        throw new Error(`Edge Function error: ${response.status} - ${errorText}`);
      }

      const result = await response.json();
      const createdSessionId = result?.sessionId ? String(result.sessionId) : '';
      if (!createdSessionId) {
        console.warn('Unexpected analyze-image response:', result);
        throw new Error(language === 'ko' ? '세션 생성에 실패했습니다. (sessionId 없음)' : 'Failed to create session. (Missing sessionId)');
      }

      console.log('Session created:', { sessionId: createdSessionId, imageCount: imagesArray.length });

      setIsLoading(false);
      setStatus('done');

      const uploadMessage =
        language === 'ko'
          ? `${imagesArray.length}개 이미지 업로드 완료. AI 분석이 진행중입니다. (세션: ${createdSessionId}) 앱에서 나가도 좋습니다.`
          : `${imagesArray.length} image(s) uploaded. AI analysis is in progress. (Session: ${createdSessionId}) You can leave the app.`;
      alert(uploadMessage);

      // React Router를 사용하여 페이지 이동 (전체 리로드 없이)
      navigate('/stats');
    } catch (err) {
      console.error(err);
      const errorMessage = language === 'ko' 
        ? '업로드 중 오류가 발생했습니다. 다시 시도해주세요.'
        : 'An error occurred during upload. Please try again.';
      setError(err instanceof Error ? err.message : errorMessage);
      setIsLoading(false);
      setStatus('error');
    }
  }, [imageFiles, language]);

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;
    
    const imageFilesArray = Array.from(files).filter(f => f.type.startsWith('image/'));
    if (imageFilesArray.length === 0) {
      setError(language === 'ko' ? '이미지 파일만 선택할 수 있습니다.' : 'Only image files can be selected.');
      return;
    }
    
    // 각 파일을 Promise로 변환하여 모든 파일이 로드될 때까지 대기
    const filePromises = imageFilesArray.map((file) => {
      return new Promise<ImageFile>((resolve) => {
        const id = `${Date.now()}_${Math.random()}_${file.name}`;
        const reader = new FileReader();
        reader.onloadend = () => {
          const previewUrl = reader.result as string;
          const imageFile: ImageFile = { file, previewUrl, id };
          resolve(imageFile);
        };
        reader.onerror = () => {
          console.error('FileReader error for', file.name);
          // 에러가 발생해도 빈 ImageFile 객체로 처리 (나중에 필터링 가능)
          resolve({ file, previewUrl: '', id });
        };
        reader.readAsDataURL(file);
      });
    });
    
    // 모든 파일이 로드되면 상태 업데이트
    Promise.all(filePromises).then((loadedFiles) => {
      // 유효한 파일만 필터링 (previewUrl이 있는 것만)
      const validFiles = loadedFiles.filter(f => f.previewUrl);
      if (validFiles.length > 0) {
        setImageFiles(prev => [...prev, ...validFiles]);
        setError(null);
      }
    }).catch((error) => {
      console.error('Error loading files:', error);
      setError(language === 'ko' ? '파일을 읽는 중 오류가 발생했습니다.' : 'Error reading files.');
    });
    
    // input 값 초기화 (같은 파일을 다시 선택할 수 있도록)
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleRemove = (index: number) => {
    setImageFiles(prev => {
      const removed = prev[index];
      if (removed && removed.previewUrl.startsWith('blob:')) {
        URL.revokeObjectURL(removed.previewUrl);
      }
      return prev.filter((_, i) => i !== index);
    });
  };

  const handleRotate = (index: number, rotatedBlob: Blob) => {
    setImageFiles(prev => {
      const imageFile = prev[index];
      if (!imageFile) return prev;
      
      const rotatedFile = new File([rotatedBlob], imageFile.file.name, {
        type: rotatedBlob.type,
        lastModified: Date.now(),
      });
      
      const previewUrl = URL.createObjectURL(rotatedBlob);
      
      if (imageFile.previewUrl.startsWith('blob:')) {
        URL.revokeObjectURL(imageFile.previewUrl);
      }
      
      const updated = [...prev];
      updated[index] = { ...imageFile, file: rotatedFile, previewUrl };
      return updated;
    });
  };

  return (
    <Routes>
      <Route path="/upload" element={
        <AuthGate>
          <MainPage
            imageFiles={imageFiles}
            isLoading={isLoading}
            error={error}
            status={status}
            onFileChange={handleFileChange}
            onAnalyzeClick={handleAnalyzeClick}
            onRemove={handleRemove}
            onRotate={handleRotate}
          />
        </AuthGate>
      } />
      <Route path="/" element={
        <AuthGate>
          <MainPage
            imageFiles={imageFiles}
            isLoading={isLoading}
            error={error}
            status={status}
            onFileChange={handleFileChange}
            onAnalyzeClick={handleAnalyzeClick}
            onRemove={handleRemove}
            onRotate={handleRotate}
          />
        </AuthGate>
      } />
      <Route path="/edit/:sessionId" element={<AuthGate><PageLayout><EditPage /></PageLayout></AuthGate>} />
      <Route path="/analyzing/:sessionId" element={<AuthGate><PageLayout><AnalyzingPage /></PageLayout></AuthGate>} />
      <Route path="/session/:sessionId" element={<AuthGate><PageLayout><SessionDetailPage /></PageLayout></AuthGate>} />
      <Route path="/retry" element={<AuthGate><PageLayout><RetryProblemsPage /></PageLayout></AuthGate>} />
      <Route path="/recent" element={<AuthGate><PageLayout><RecentProblemsPage /></PageLayout></AuthGate>} />
      <Route path="/stats" element={<AuthGate><PageLayout><StatsPage /></PageLayout></AuthGate>} />
      <Route path="/profile" element={<AuthGate><PageLayout><ProfilePage /></PageLayout></AuthGate>} />
      <Route path="*" element={<AuthGate><PageLayout><div className="text-center py-10"><a href="/upload" className="text-indigo-600 dark:text-indigo-400 underline hover:text-indigo-800 dark:hover:text-indigo-300">{language === 'ko' ? '문제 업로드하러 가기' : 'Go to Upload'}</a></div></PageLayout></AuthGate>} />
    </Routes>
  );
};

export default App;
