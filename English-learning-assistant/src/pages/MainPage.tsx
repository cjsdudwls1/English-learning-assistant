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

            <div className="upload-panel-moved" style={{ marginTop: '1.5rem' }}>
              <div style={{ marginBottom: '1rem', display: 'flex', gap: '0.5rem' }}>
                <button
                  type="button"
                  className="mobile-only-btn"
                  onClick={onOpenCamera}
                  style={{
                    flex: 1,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: '1.5rem',
                    border: '2px solid rgba(79,70,229,0.5)',
                    borderRadius: 'var(--radius-md)',
                    cursor: 'pointer',
                    background: 'rgba(79,70,229,0.15)',
                    color: 'var(--text-main)',
                    fontWeight: 600,
                    fontSize: '1rem',
                  }}
                >
                  📸 {t.camera.takePhoto}
                </button>
                <label
                  htmlFor="hero-image-input"
                  className="file-label"
                  style={{
                    flex: 1,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
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
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                    <span style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>
                      {t.upload.countImages.replace('{count}', String(imageFiles.length))}
                    </span>
                    <button
                      onClick={onClearAll}
                      style={{
                        background: 'transparent', border: '1px solid #ff4444', color: '#ff4444',
                        padding: '0.2rem 0.5rem', borderRadius: '4px', fontSize: '0.8rem', cursor: 'pointer'
                      }}
                    >
                      {t.upload.clearAll}
                    </button>
                  </div>
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
                </>
              )}

              <button
                className="primary"
                onClick={onAnalyzeClick}
                disabled={imageFiles.length === 0 || isLoading}
                style={{ width: '100%', padding: '1rem', fontSize: '1.1rem' }}
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
