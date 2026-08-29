import React, { useRef } from 'react';
import { Link } from 'react-router-dom';
import { TopBar } from '../components/TopBar';
import { CameraCapture } from '../components/CameraCapture';
import { useLanguage } from '../contexts/LanguageContext';
import { getTranslation } from '../utils/translations';

export interface ImageFile {
  file: File;
  previewUrl: string;
  id: string;
}

export interface MainPageProps {
  imageFiles: ImageFile[];
  isLoading: boolean;
  error: string | null;
  status: 'idle' | 'loading' | 'done' | 'error';
  isCameraOpen: boolean;
  onFileChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onAnalyzeClick: () => void;
  onRemove: (index: number) => void;
  onRotate: (index: number, blob: Blob) => void;
  onOpenCamera: () => void;
  onCloseCamera: () => void;
  onCameraCapture: (files: File[]) => void;
  onClearAll: () => void;
}

export const MainPage: React.FC<MainPageProps> = ({
  imageFiles,
  isLoading,
  error,
  status,
  isCameraOpen,
  onFileChange,
  onAnalyzeClick,
  onRemove,
  onOpenCamera,
  onCloseCamera,
  onCameraCapture,
  onClearAll,
}) => {
  const { language } = useLanguage();
  const t = getTranslation(language);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // landing 데이터: 표시 텍스트는 translations(t.landing.*)에서, tech 스택/value 등 비번역 값은 인라인 유지
  const PIPELINE_STAGES = [
    { id: 'pre', title: t.landing.pipelinePreTitle, tech: 'OpenCV + CLAHE + Adaptive Thresholding', description: t.landing.pipelinePreDesc },
    { id: 'detect', title: t.landing.pipelineDetectTitle, tech: 'CRAFT + EAST', description: t.landing.pipelineDetectDesc },
    { id: 'recognize', title: t.landing.pipelineRecognizeTitle, tech: 'ViT + CNN + BiLSTM + CTC', description: t.landing.pipelineRecognizeDesc },
    { id: 'math', title: t.landing.pipelineMathTitle, tech: 'Im2Latex (CNN Encoder + Transformer Decoder)', description: t.landing.pipelineMathDesc },
  ];

  const HIGHLIGHTS = [
    { id: 'mobile', title: t.landing.highlightMobileTitle, description: t.landing.highlightMobileDesc, tag: t.landing.tagMobileOptimized },
    { id: 'ai-analysis', title: t.landing.highlightAiTitle, description: t.landing.highlightAiDesc, tag: t.landing.tagAiPowered },
    { id: 'statistics', title: t.landing.highlightStatsTitle, description: t.landing.highlightStatsDesc, tag: t.landing.tagDataAnalysis },
  ];

  const METRICS = [
    { id: 'accuracy', label: t.landing.metricAccuracyLabel, value: '95%+', detail: t.landing.metricAccuracyDetail },
    { id: 'speed', label: t.landing.metricSpeedLabel, value: t.landing.metricSpeedValue, detail: t.landing.metricSpeedDetail },
    { id: 'coverage', label: t.landing.metricCoverageLabel, value: t.landing.metricCoverageValue, detail: t.landing.metricCoverageDetail },
    { id: 'languages', label: t.landing.metricLanguagesLabel, value: t.landing.metricLanguagesValue, detail: t.landing.metricLanguagesDetail },
  ];

  const USE_CASES = [
    { id: 'student', title: t.landing.useCaseStudentTitle, description: t.landing.useCaseStudentDesc, bullets: [t.landing.useCaseStudentBullet1, t.landing.useCaseStudentBullet2, t.landing.useCaseStudentBullet3] },
    { id: 'parent', title: t.landing.useCaseParentTitle, description: t.landing.useCaseParentDesc, bullets: [t.landing.useCaseParentBullet1, t.landing.useCaseParentBullet2, t.landing.useCaseParentBullet3] },
    { id: 'teacher', title: t.landing.useCaseTeacherTitle, description: t.landing.useCaseTeacherDesc, bullets: [t.landing.useCaseTeacherBullet1, t.landing.useCaseTeacherBullet2, t.landing.useCaseTeacherBullet3] },
  ];

  const FAQS = [
    { q: t.landing.faq1Q, a: t.landing.faq1A },
    { q: t.landing.faq2Q, a: t.landing.faq2A },
    { q: t.landing.faq3Q, a: t.landing.faq3A },
    { q: t.landing.faq4Q, a: t.landing.faq4A },
  ];

  return (
    <div className="page-shell">
      <div className="bg-grid" aria-hidden={true} />
      <TopBar status={status} />

      <main className="page-content">
        <section className="hero" id="top">
          <div className="hero-copy">
            <p className="eyebrow">{t.landing.heroEyebrow}</p>
            <h1>
              {t.landing.heroTitle} <span>{t.landing.heroTitleEmphasis}</span>
            </h1>
            <p className="lede">
              {t.landing.heroLede}
            </p>
            <div className="hero-actions">
              <label className="primary" htmlFor="hero-image-input">
                {t.landing.getStarted}
              </label>
              <Link className="ghost" to="/stats">
                {t.landing.viewStats}
              </Link>
            </div>
            <div className="hero-tags">
              <span>{t.landing.tagAutoGrading}</span>
              <span>{t.landing.tagStatistics}</span>
              <span>{t.landing.tagSimilarProblems}</span>
              <span>{t.landing.tagMobileOptimized}</span>
            </div>
          </div>
          <div className="hero-panel">
            <div className="hero-panel__header">
              <div>
                <p className="eyebrow">{t.landing.realtimeAnalysis}</p>
                <strong>{t.landing.uploadFlow}</strong>
              </div>
            </div>

            <div className="upload-panel-moved">
              {/* 촬영/갤러리 버튼: 모바일에선 44~48px 터치 타깃, md(769px 이상 = app.css의 데스크톱 경계)부터 기존 1.5rem 패딩 복원.
                  패딩·글자 크기는 인라인 style에서 className으로 옮겨야 반응형이 먹는다(인라인이 클래스를 이긴다). */}
              <div className="mb-2 flex gap-2 md:mb-4">
                <button
                  type="button"
                  className="mobile-only-btn min-h-[44px] sm:min-h-0 flex-1 px-3 py-2 text-[0.95rem] md:p-6 md:text-base"
                  onClick={onOpenCamera}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    border: '2px solid rgba(79,70,229,0.5)',
                    borderRadius: 'var(--radius-md)',
                    cursor: 'pointer',
                    background: 'rgba(79,70,229,0.15)',
                    color: 'var(--text-main)',
                    fontWeight: 600,
                  }}
                >
                  📸 {t.camera.takePhoto}
                </button>
                <label
                  htmlFor="hero-image-input"
                  className="file-label min-h-[44px] sm:min-h-0 flex-1 px-3 py-2 text-[0.95rem] md:p-6 md:text-base"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    border: '2px dashed rgba(255,255,255,0.2)',
                    borderRadius: 'var(--radius-md)',
                    cursor: 'pointer',
                    background: 'rgba(255,255,255,0.05)',
                    color: 'var(--text-main)',
                    fontWeight: 500
                  }}
                >
                  {imageFiles.length > 0
                    ? t.upload.countSelected.replace('{count}', String(imageFiles.length))
                    : t.camera.gallery}
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
              <CameraCapture
                isOpen={isCameraOpen}
                maxImages={10}
                currentImageCount={imageFiles.length}
                onCapture={onCameraCapture}
                onClose={onCloseCamera}
              />

              {imageFiles.length > 0 && (
                <>
                  <div className="mb-2 flex items-center justify-between">
                    <span style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>
                      {t.upload.countImages.replace('{count}', String(imageFiles.length))}
                    </span>
                    <button
                      onClick={onClearAll}
                      className="relative px-2 py-[0.2rem] before:absolute before:content-[''] before:-inset-x-1 before:-inset-y-1.5"
                      style={{
                        background: 'transparent', border: '1px solid #ff4444', color: '#ff4444',
                        borderRadius: '4px', fontSize: '0.8rem', cursor: 'pointer'
                      }}
                    >
                      {t.upload.clearAll}
                    </button>
                  </div>
                  {/* 썸네일: 모바일은 4열 그리드로 크게(업로드 아래 빈 공간을 쓰면서, OCR 전에 사진이 읽을 만한지 확인 가능),
                      md 이상은 기존 60px 가로 스트립 그대로. */}
                  <div className="image-previews mb-3 grid grid-cols-4 gap-2 pb-2 md:mb-4 md:flex md:overflow-x-auto">
                    {imageFiles.map((imageFile, index) => (
                      <div key={imageFile.id} className="relative aspect-square w-full shrink-0 md:aspect-auto md:h-[60px] md:w-[60px]">
                        <img
                          src={imageFile.previewUrl}
                          alt="preview"
                          style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '4px' }}
                        />
                        <button
                          onClick={(e) => { e.preventDefault(); onRemove(index); }}
                          className="absolute top-0.5 right-0.5 h-6 w-6 text-xs md:-top-[5px] md:-right-[5px] md:h-[18px] md:w-[18px] md:text-[10px]"
                          style={{
                            background: '#ff4444', color: 'white',
                            borderRadius: '50%',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            border: 'none', cursor: 'pointer'
                          }}
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                </>
              )}

              {/* .primary는 app.css의 레이어 밖 규칙이라 Tailwind 유틸리티가 못 이긴다 → 인라인 clamp로 반응형 처리.
                  가운데 항(vw)이 615px 부근에서 이미 상한에 닿으므로 데스크톱(769px+)에서는 기존 1rem/1.1rem 그대로다. */}
              <button
                className="primary"
                onClick={onAnalyzeClick}
                disabled={imageFiles.length === 0 || isLoading}
                style={{ width: '100%', padding: 'clamp(0.7rem, 2.6vw, 1rem)', fontSize: 'clamp(1rem, 2.9vw, 1.1rem)' }}
              >
                {isLoading
                  ? t.analyzing.analyzing
                  : t.landing.startAiAnalysis
                }
              </button>
              {error && <p className="error-text" style={{ marginTop: '0.5rem', color: '#ff6b6b', fontSize: '0.9rem' }}>{error}</p>}
            </div>
          </div>
        </section>

        <section className="metrics">
          <div className="section-head">
            <div>
              <p className="eyebrow">{t.landing.metricsEyebrow}</p>
              <h2>{t.landing.metricsHeading}</h2>
            </div>
            <p className="muted">
              {t.landing.metricsDesc}
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
              <p className="eyebrow">{t.landing.solutionsEyebrow}</p>
              <h2>{t.landing.solutionsHeading}</h2>
            </div>
            <p className="muted">
              {t.landing.solutionsDesc}
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
                <p className="eyebrow">{t.landing.highlightsEyebrow}</p>
                <h3>{t.landing.highlightsHeading}</h3>
              </div>
              <p className="muted">{t.landing.highlightsDesc}</p>
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

        <section className="panel pipeline" id="pipeline">
          <div className="section-head">
            <div>
              <p className="eyebrow">Tech Stack</p>
              <h2>{t.landing.pipelineHeading}</h2>
            </div>
            <p className="muted">
              {t.landing.pipelineDesc}
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
              <h2>{t.landing.faqHeading}</h2>
            </div>
            <p className="muted">{t.landing.faqDesc}</p>
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
            <p className="eyebrow">{t.landing.getStarted}</p>
            <h2>{t.landing.ctaHeading}</h2>
            <p className="muted">
              {t.landing.ctaDesc}
            </p>
          </div>
          <div className="cta-actions">
            <a className="primary" href="#top">
              {t.landing.getStarted}
            </a>
            <Link className="ghost muted-text" to="/stats">
              {t.landing.viewStats}
            </Link>
          </div>
        </section>
      </main>
    </div>
  );
};
