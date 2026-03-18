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
import { AllProblemsPage } from './pages/AllProblemsPage';
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
      <div className="bg-grid" aria-hidden={true} />
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
              <label className="primary" htmlFor="hero-image-input">
                {language === 'ko' ? '지금 시작하기' : 'Get Started'}
              </label>
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
            </div>

            <div className="upload-panel-moved" style={{ marginTop: '1.5rem' }}>
              <div style={{ marginBottom: '1rem' }}>
                <label
                  htmlFor="hero-image-input"
                  className="file-label"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: '100%',
                    padding: '1.5rem',
                    border: '2px dashed rgba(255,255,255,0.2)',
                    borderRadius: 'var(--radius-md)',
                    cursor: 'pointer',
                    background: 'rgba(255,255,255,0.05)',
                    color: 'var(--text-main)',
                    fontWeight: 500
                  }}
                >
                  {imageFiles.length > 0
                    ? (language === 'ko' ? `${imageFiles.length}/3장 선택됨 (클릭하여 추가)` : `${imageFiles.length}/3 selected (Click to add more)`)
                    : (language === 'ko' ? '+ 이미지 업로드 (최대 3장)' : '+ Upload Images (max 3)')}
                </label>
                <input
                  id="hero-image-input"
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={onFileChange}
                  style={{ display: 'none' }}
                />
              </div>

              {imageFiles.length > 0 && (
                <div className="image-previews" style={{ display: 'flex', gap: '0.5rem', overflowX: 'auto', paddingBottom: '0.5rem', marginBottom: '1rem' }}>
                  {imageFiles.map((imageFile, index) => (
                    <div key={imageFile.id} style={{ position: 'relative', flexShrink: 0, width: '60px', height: '60px' }}>
                      <img
                        src={imageFile.previewUrl}
                        alt="preview"
                        style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '4px' }}
                      />
                      <button
                        onClick={(e) => { e.preventDefault(); onRemove(index); }}
                        style={{
                          position: 'absolute', top: -5, right: -5,
                          background: '#ff4444', color: 'white',
                          borderRadius: '50%', width: '18px', height: '18px',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          border: 'none', cursor: 'pointer', fontSize: '10px'
                        }}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <button
                className="primary"
                onClick={onAnalyzeClick}
                disabled={imageFiles.length === 0 || isLoading}
                style={{ width: '100%', padding: '1rem', fontSize: '1.1rem' }}
              >
                {isLoading
                  ? (language === 'ko' ? '분석 중…' : 'Analyzing...')
                  : (language === 'ko' ? 'AI 분석 시작하기' : 'Start AI Analysis')
                }
              </button>
              {error && <p className="error-text" style={{ marginTop: '0.5rem', color: '#ff6b6b', fontSize: '0.9rem' }}>{error}</p>}
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
          {/*
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
          */}
          {error && <p className="error-text">{error}</p>}
          {/*
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
          */}
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


  // 이미지 압축: Canvas API를 사용하여 긴 변 1600px, JPEG 80% 품질로 리사이징
  const compressImage = (file: File, maxDimension: number = 1200, quality: number = 0.8): Promise<{ base64: string; mimeType: string }> => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        try {
          let { width, height } = img;
          // 긴 변이 maxDimension보다 크면 비율 유지하며 축소
          if (width > maxDimension || height > maxDimension) {
            const ratio = Math.min(maxDimension / width, maxDimension / height);
            width = Math.round(width * ratio);
            height = Math.round(height * ratio);
          }
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            reject(new Error('Canvas 2D context not available'));
            return;
          }
          ctx.drawImage(img, 0, 0, width, height);
          // JPEG로 압축 (품질 0.8 = 80%)
          const dataUrl = canvas.toDataURL('image/jpeg', quality);
          const base64 = dataUrl.split(',')[1];
          console.log(`[Compress] ${file.name}: ${img.naturalWidth}x${img.naturalHeight} → ${width}x${height}, base64 len: ${base64.length} (원본 ${file.size} bytes)`);
          URL.revokeObjectURL(url);
          resolve({ base64, mimeType: 'image/jpeg' });
        } catch (e) {
          URL.revokeObjectURL(url);
          reject(e);
        }
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error(`Failed to load image: ${file.name}`));
      };
      img.src = url;
    });
  };

  const fileToBase64 = (file: File): Promise<{ base64: string; mimeType: string }> => {
    // 이미지 파일이면 압축 적용
    if (file.type.startsWith('image/')) {
      return compressImage(file);
    }
    // 이미지가 아닌 파일은 원본 그대로
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

      console.log(`Starting 2-phase analysis for ${imageFiles.length} images...`);
      const functionUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/analyze-image`;
      const session = await supabase.auth.getSession();
      const accessToken = session.data.session?.access_token;

      if (!accessToken) {
        const errorMsg = language === 'ko' ? '인증 토큰이 없습니다. 다시 로그인해주세요.' : 'Authentication token is missing. Please login again.';
        setError(errorMsg);
        setIsLoading(false);
        setStatus('error');
        alert(errorMsg);
        return;
      }

      if (!userData.user?.id) {
        const errorMsg = language === 'ko' ? '사용자 ID를 가져올 수 없습니다. 다시 로그인해주세요.' : 'Cannot get user ID. Please login again.';
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
            const { base64, mimeType } = await fileToBase64(imageFile.file);
            if (!base64 || typeof base64 !== 'string' || !base64.trim()) {
              throw new Error(`Invalid base64 for file: ${imageFile.file.name}`);
            }
            return { imageBase64: base64, mimeType: mimeType || 'image/jpeg', fileName: imageFile.file.name };
          } catch (convertError) {
            console.error(`[${index}] Failed to convert file:`, imageFile.file.name, convertError);
            throw convertError;
          }
        })
      );

      // ═══════════════════════════════════════════════════════
      // PHASE 1: Extract (구조 + 좌표 추출)
      // ═══════════════════════════════════════════════════════
      console.log(`[Phase 1] Sending extract request with ${imagesArray.length} image(s)...`);

      const extractResponse = await fetch(functionUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          mode: 'extract',
          images: imagesArray,
          userId: userData.user.id,
          language: currentLanguage,
        }),
      });

      if (!extractResponse.ok) {
        const errorText = await extractResponse.text();
        throw new Error(`Extract failed: ${extractResponse.status} - ${errorText}`);
      }

      const extractResult = await extractResponse.json();
      const createdSessionId = extractResult?.sessionId;
      const pages = extractResult?.pages;

      if (!createdSessionId || !pages || !Array.isArray(pages)) {
        throw new Error(language === 'ko' ? '구조 추출 결과가 유효하지 않습니다.' : 'Invalid extract result.');
      }

      console.log(`[Phase 1] Extract done. Session: ${createdSessionId}, Pages: ${pages.length}`);

      // ═══════════════════════════════════════════════════════
      // PHASE 1.5: Client-Side Canvas Crop
      // ═══════════════════════════════════════════════════════
      console.log(`[Phase 1.5] Starting client-side canvas crop...`);

      const { cropAllRegions } = await import('./utils/canvasCropper');

      const pagesWithCrops: any[] = [];
      for (let i = 0; i < pages.length; i++) {
        const page = pages[i];
        const imageData = imagesArray[i];

        if (!page.bboxes || page.bboxes.length === 0) {
          console.warn(`[Phase 1.5] Page ${page.pageNum}: No bboxes, skipping crop`);
          pagesWithCrops.push({
            ...page,
            answerAreaCrops: [],
            fullCrops: [],
          });
          continue;
        }

        try {
          const dataUri = `data:${imageData.mimeType};base64,${imageData.imageBase64}`;
          const { answerAreaCrops, fullCrops } = await cropAllRegions(dataUri, page.bboxes);

          console.log(`[Phase 1.5] Page ${page.pageNum}: ${answerAreaCrops.length} answer + ${fullCrops.length} full crops`);

          pagesWithCrops.push({
            ...page,
            answerAreaCrops,
            fullCrops,
          });
        } catch (cropError) {
          console.error(`[Phase 1.5] Page ${page.pageNum}: Crop failed`, cropError);
          pagesWithCrops.push({
            ...page,
            answerAreaCrops: [],
            fullCrops: [],
          });
        }
      }

      console.log(`[Phase 1.5] Client-side crop completed for ${pagesWithCrops.length} pages`);

      // ═══════════════════════════════════════════════════════
      // PHASE 2: Detect (크롭된 이미지로 필기 인식 — analyze-detect)
      // ═══════════════════════════════════════════════════════
      console.log(`[Phase 2] Sending detect request to analyze-detect...`);

      const detectUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/analyze-detect`;
      const detectResponse = await fetch(detectUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          sessionId: createdSessionId,
          pages: pagesWithCrops.map(p => ({
            answerAreaCrops: p.answerAreaCrops,
            fullCrops: p.fullCrops,
          })),
        }),
      });

      if (!detectResponse.ok) {
        const errorText = await detectResponse.text();
        throw new Error(`Detect failed: ${detectResponse.status} - ${errorText}`);
      }

      const detectResult = await detectResponse.json();
      console.log(`[Phase 2] Detect done. Merging marks into pageItems...`);

      // marks를 pageItems에 병합
      const pagesWithMarks = pagesWithCrops.map((page, i) => {
        const detectedMarks = detectResult.pages?.[i]?.marks || [];
        const mergedItems = (page.pageItems || []).map((item: any) => {
          const mark = detectedMarks.find((m: any) => m.problem_number === item.problem_number);
          return {
            ...item,
            user_answer: mark?.user_answer ?? null,
            correct_answer: mark?.correct_answer ?? null,
          };
        });
        return {
          pageItems: mergedItems,
          pageModel: page.pageModel || '',
        };
      });

      // ═══════════════════════════════════════════════════════
      // PHASE 3: Classify (분류 + DB 저장 — analyze-classify, 백그라운드)
      // ═══════════════════════════════════════════════════════
      console.log(`[Phase 3] Sending classify request to analyze-classify...`);

      const classifyUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/analyze-classify`;
      const classifyResponse = await fetch(classifyUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          sessionId: createdSessionId,
          userId: userData.user.id,
          language: currentLanguage,
          pages: pagesWithMarks,
        }),
      });

      if (!classifyResponse.ok) {
        const errorText = await classifyResponse.text();
        throw new Error(`Classify failed: ${classifyResponse.status} - ${errorText}`);
      }

      const classifyResult = await classifyResponse.json();
      console.log(`[Phase 3] Classify request accepted. Session: ${classifyResult?.sessionId}`);

      setIsLoading(false);
      setStatus('done');
      setImageFiles([]);

      const uploadMessage =
        language === 'ko'
          ? `${imagesArray.length}개 이미지 업로드 완료. AI 분석이 진행중입니다. (세션: ${createdSessionId}) 앱에서 나가도 좋습니다.`
          : `${imagesArray.length} image(s) uploaded. AI analysis is in progress. (Session: ${createdSessionId}) You can leave the app.`;
      alert(uploadMessage);

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
    const MAX_IMAGES = 3; // wall time 제한 내에서 안정적으로 처리 가능한 수
    const files = event.target.files;
    if (!files || files.length === 0) return;

    const imageFilesArray = Array.from(files).filter(f => f.type.startsWith('image/'));
    if (imageFilesArray.length === 0) {
      setError(language === 'ko' ? '이미지 파일만 선택할 수 있습니다.' : 'Only image files can be selected.');
      return;
    }

    // 현재 이미지 수 + 새로 추가할 이미지 수가 최대치를 초과하는지 확인
    const currentCount = imageFiles.length;
    const remainingSlots = MAX_IMAGES - currentCount;

    if (remainingSlots <= 0) {
      setError(language === 'ko'
        ? `최대 ${MAX_IMAGES}장까지만 업로드할 수 있습니다.`
        : `You can upload up to ${MAX_IMAGES} images only.`);
      return;
    }

    // 추가 가능한 만큼만 선택
    const filesToAdd = imageFilesArray.slice(0, remainingSlots);
    if (filesToAdd.length < imageFilesArray.length) {
      setError(language === 'ko'
        ? `최대 ${MAX_IMAGES}장까지만 업로드할 수 있습니다. ${filesToAdd.length}장만 추가됩니다.`
        : `You can upload up to ${MAX_IMAGES} images only. Only ${filesToAdd.length} will be added.`);
    }

    // 각 파일을 Promise로 변환하여 모든 파일이 로드될 때까지 대기
    const filePromises = filesToAdd.map((file) => {
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
      <Route path="/problems" element={<AuthGate><PageLayout><AllProblemsPage /></PageLayout></AuthGate>} />
      <Route path="/profile" element={<AuthGate><PageLayout><ProfilePage /></PageLayout></AuthGate>} />
      <Route path="*" element={<AuthGate><PageLayout><div className="text-center py-10"><a href="/upload" className="text-indigo-600 dark:text-indigo-400 underline hover:text-indigo-800 dark:hover:text-indigo-300">{language === 'ko' ? '문제 업로드하러 가기' : 'Go to Upload'}</a></div></PageLayout></AuthGate>} />
    </Routes>
  );
};

export default App;
