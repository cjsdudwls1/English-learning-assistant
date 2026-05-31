import React, { useRef } from 'react';
import { Link } from 'react-router-dom';
import { TopBar } from '../components/TopBar';
import { CameraCapture } from '../components/CameraCapture';
import { useLanguage } from '../contexts/LanguageContext';
import {
  AI_PROVIDERS,
  AIProviderId,
  getProvider,
  isProviderEnabled,
} from '../config/aiProviders';
import {
  PIPELINE_STAGES,
  HIGHLIGHTS,
  METRICS,
  USE_CASES,
  FAQS,
} from '../constants/landing';

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
  providerId: AIProviderId;
  modelId: string;
  providerEnabled: boolean;
  onProviderChange: (providerId: AIProviderId) => void;
  onModelChange: (modelId: string) => void;
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
  providerId,
  modelId,
  providerEnabled,
  onProviderChange,
  onModelChange,
  onFileChange,
  onAnalyzeClick,
  onRemove,
  onOpenCamera,
  onCloseCamera,
  onCameraCapture,
  onClearAll,
}) => {
  const { language } = useLanguage();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const currentProvider = getProvider(providerId);

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
                  📸 {language === 'ko' ? '사진 촬영' : 'Take Photo'}
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
                    ? (language === 'ko' ? `${imageFiles.length}장 선택됨` : `${imageFiles.length} selected`)
                    : (language === 'ko' ? '🖼️ 갤러리 선택' : '🖼️ Gallery')}
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
                      {language === 'ko' ? `${imageFiles.length}장 선택됨` : `${imageFiles.length} images`}
                    </span>
                    <button
                      onClick={onClearAll}
                      style={{
                        background: 'transparent', border: '1px solid #ff4444', color: '#ff4444',
                        padding: '0.2rem 0.5rem', borderRadius: '4px', fontSize: '0.8rem', cursor: 'pointer'
                      }}
                    >
                      {language === 'ko' ? '초기화' : 'Clear All'}
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

              <div style={{ marginBottom: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <label style={{ fontSize: '0.85rem', color: 'var(--text-muted)', fontWeight: 500 }}>
                  {language === 'ko' ? 'AI 모델 선택' : 'AI Model'}
                </label>
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                  <select
                    value={providerId}
                    onChange={(e) => onProviderChange(e.target.value as AIProviderId)}
                    disabled={isLoading}
                    style={{
                      flex: 1, minWidth: 120, padding: '0.5rem 0.75rem',
                      border: '1px solid rgba(255,255,255,0.15)', borderRadius: 'var(--radius-md)',
                      background: 'rgba(255,255,255,0.05)', color: 'var(--text-main)', fontSize: '0.9rem',
                    }}
                  >
                    {AI_PROVIDERS.map((p) => {
                      const enabled = isProviderEnabled(p.id);
                      const suffix = enabled
                        ? ''
                        : (language === 'ko' ? ' (준비중)' : ' (Coming soon)');
                      return (
                        <option key={p.id} value={p.id}>{p.label}{suffix}</option>
                      );
                    })}
                  </select>
                  <select
                    value={modelId}
                    onChange={(e) => onModelChange(e.target.value)}
                    disabled={isLoading || !currentProvider}
                    style={{
                      flex: 1, minWidth: 140, padding: '0.5rem 0.75rem',
                      border: '1px solid rgba(255,255,255,0.15)', borderRadius: 'var(--radius-md)',
                      background: 'rgba(255,255,255,0.05)', color: 'var(--text-main)', fontSize: '0.9rem',
                    }}
                  >
                    {currentProvider?.models.map((m) => (
                      <option key={m.id} value={m.id}>{m.label}</option>
                    ))}
                  </select>
                </div>
                {!providerEnabled && (
                  <p style={{
                    margin: 0, padding: '0.5rem 0.75rem',
                    background: 'rgba(255,180,0,0.12)', border: '1px solid rgba(255,180,0,0.35)',
                    borderRadius: 'var(--radius-md)', color: '#ffc857', fontSize: '0.85rem',
                  }}>
                    {language === 'ko' ? '서비스 준비중입니다.' : 'Service coming soon.'}
                  </p>
                )}
              </div>

              <button
                className="primary"
                onClick={onAnalyzeClick}
                disabled={imageFiles.length === 0 || isLoading || !providerEnabled}
                style={{ width: '100%', padding: '1rem', fontSize: '1.1rem' }}
              >
                {isLoading
                  ? (language === 'ko' ? '분석 중…' : 'Analyzing...')
                  : !providerEnabled
                    ? (language === 'ko' ? '서비스 준비중입니다' : 'Service coming soon')
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
            <a className="primary" href="#top">
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
