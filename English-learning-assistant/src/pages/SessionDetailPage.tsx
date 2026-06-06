import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import type { ProblemItem } from '../types';
import { MultiProblemEditor } from '../components/MultiProblemEditor';
import { fetchSessionProblems, updateProblemLabels, getSessionStatus } from '../services/db';
import { supabase } from '../services/supabaseClient';
import { ImageRotator } from '../components/ImageRotator';
import { ImageModal } from '../components/ImageModal';
import { resolveImageUrls, resolveImageUrl, invalidateImageUrl, parseStoragePath } from '../utils/imageUrl';
import { useLanguage } from '../contexts/LanguageContext';
import { getTranslation } from '../utils/translations';
import { translateError } from '../utils/errorI18n';

export const SessionDetailPage: React.FC = () => {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const { language } = useLanguage();
  const t = getTranslation(language);
  const [data, setData] = useState<ProblemItem[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [imageUrls, setImageUrls] = useState<string[]>([]);
  const originalImageUrlsRef = React.useRef<string[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedImageIndex, setSelectedImageIndex] = useState<number>(0);

  useEffect(() => {
    if (!sessionId) {
      navigate('/stats');
      return;
    }

    // sessionId 변경 시 이전 데이터 초기화
    setData(null);
    setError(null);
    setImageUrls([]);
    originalImageUrlsRef.current = [];

    (async () => {
      try {
        setLoading(true);

        // 세션 상태 확인
        const status = await getSessionStatus(sessionId);

        if (status === 'processing') {
          // 분석 중이면 analyzing 페이지로 리다이렉트
          navigate(`/analyzing/${sessionId}`);
          return;
        }

        if (status === 'failed') {
          setError(t.session.analysisError);
          return;
        }

        if (status === 'completed' || status === 'labeled') {
          // 분석 완료된 경우에만 문제 데이터 로드
          const items = await fetchSessionProblems(sessionId);
          setData(items);

          // 세션의 이미지 URL 가져오기 (image_urls 배열 사용)
          const { data: sessionData, error: sessionError } = await supabase
            .from('sessions')
            .select('image_urls')
            .eq('id', sessionId)
            .single();

          if (!sessionError && sessionData) {
            // raw 값(storage path 또는 legacy URL)을 originalImageUrlsRef에 보관 (DB 영속화/회전용)
            // 표시용은 resolveImageUrls로 매번 signed URL 발급 (CRITICAL #4 회귀 방지)
            let rawPaths: string[] = [];
            const raw = (sessionData as any).image_urls;

            if (raw && Array.isArray(raw)) {
              rawPaths = raw.filter((u: any) => typeof u === 'string' && u.trim().length > 0).map((u: string) => u.trim());
            } else if (typeof raw === 'string') {
              try {
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed)) {
                  rawPaths = parsed.filter((u: any) => typeof u === 'string' && u.trim().length > 0).map((u: string) => u.trim());
                }
              } catch {
                // ignore
              }
            } else if (raw && typeof raw === 'object') {
              const keys = Object.keys(raw)
                .map(k => parseInt(k, 10))
                .filter(n => !Number.isNaN(n))
                .sort((a, b) => a - b);
              if (keys.length > 0) {
                rawPaths = keys
                  .map(k => raw[k])
                  .filter((u: any) => typeof u === 'string' && u.trim().length > 0)
                  .map((u: string) => u.trim());
              }
            }
            originalImageUrlsRef.current = [...rawPaths];
            const resolved = await resolveImageUrls(rawPaths);
            setImageUrls(resolved);
          }
        }
      } catch (e) {
        setError(translateError(e, language, t, t.session.loadError));
      } finally {
        setLoading(false);
      }
    })();
  }, [sessionId, navigate]);

  const handleSubmit = async (items: ProblemItem[]) => {
    if (!sessionId) return;
    try {
      // 모든 문제에 정답/오답이 선택되었는지 확인
      const allLabeled = items.every(item => {
        const mark = item.사용자가_직접_채점한_정오답;
        return mark === 'O' || mark === 'X';
      });

      if (!allLabeled) {
        alert(t.session.markAllPrompt);
        return;
      }

      await updateProblemLabels(sessionId, items);
      alert(t.session.saveSuccess);
      navigate('/stats');
    } catch (e) {
      alert(translateError(e, language, t, t.session.saveError));
    }
  };

  const handleImageClick = (index: number) => {
    setSelectedImageIndex(index);
    setIsModalOpen(true);
  };

  const handleRotate = async (rotatedBlob: Blob, imageIndex: number) => {
    if (!sessionId) return;

    try {
      // rawPaths(originalImageUrlsRef)에는 storage path 또는 legacy absolute URL이 보관됨.
      // parseStoragePath로 bucket/path 추출 → 동일 위치 upsert → invalidate cache → 새 signed URL 발급.
      // DB의 image_urls는 path만 유지 (signed URL 영속화 회귀 방지: CRITICAL #4)
      const rawPaths = originalImageUrlsRef.current;
      if (imageIndex < 0 || imageIndex >= rawPaths.length) {
        throw new Error(t.session.invalidImageIndex);
      }
      const rawPath = rawPaths[imageIndex];
      if (!rawPath) throw new Error(t.session.imagePathNotFound);

      const parsed = parseStoragePath(rawPath);
      if (!parsed) throw new Error('스토리지 경로를 파싱할 수 없습니다.');
      const { bucket, path } = parsed;

      const rotatedFile = new File([rotatedBlob], path.split('/').pop() || `rotated_${Date.now()}.jpg`, {
        type: rotatedBlob.type,
        lastModified: Date.now(),
      });

      // 업로드: 일시 오류 대비 재시도(최대 2회)
      let uploadError: any = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        const { error } = await supabase.storage
          .from(bucket)
          .upload(path, rotatedFile, {
            contentType: rotatedBlob.type,
            cacheControl: '0',
            upsert: true,
          });
        if (!error) { uploadError = null; break; }
        uploadError = error;
        await new Promise(r => setTimeout(r, 200 * (attempt + 1)));
      }
      if (uploadError) throw uploadError;

      // cache 무효화 → 신선한 signed URL 재발급
      invalidateImageUrl(rawPath);
      const refreshedUrl = await resolveImageUrl(rawPath);

      // 표시용 imageUrls만 갱신. DB의 image_urls는 path 유지 (재저장 불필요)
      const updatedDisplay = [...imageUrls];
      updatedDisplay[imageIndex] = refreshedUrl;
      setImageUrls(updatedDisplay);
    } catch (error) {
      console.error('Image rotation failed:', error);
      alert(t.session.rotateError);
    }
  };

  if (loading) {
    return (
      <div className="mx-auto bg-white dark:bg-slate-800 rounded-2xl shadow-lg p-4 sm:p-6 md:p-8 border border-slate-200 dark:border-slate-700 max-w-full lg:max-w-6xl">
        <p className="text-center text-slate-600 dark:text-slate-400">{t.common.loading}</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="max-w-6xl mx-auto bg-white dark:bg-slate-800 rounded-2xl shadow-lg p-6 md:p-8 border border-slate-200 dark:border-slate-700">
        <p className="text-center text-red-600">{error || t.session.notFound}</p>
        <div className="text-center mt-4">
          <button
            onClick={() => navigate('/stats')}
            className="px-6 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
          >
            {t.session.backToStats}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto bg-white dark:bg-slate-800 rounded-2xl shadow-lg p-6 md:p-8 border border-slate-200 dark:border-slate-700">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-slate-900 dark:text-white">{t.session.title}</h2>
        <button
          onClick={() => navigate('/stats')}
          className="px-4 py-2 text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 underline"
        >
          {t.session.backToStats}
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* 좌측: 이미지 영역 */}
        <div className="space-y-4">
          <h3 className="text-lg font-semibold text-slate-900 dark:text-white">
            {t.session.uploadedImages}{imageUrls.length > 0 ? ` (${imageUrls.length})` : ''}
          </h3>

          {imageUrls.length > 0 ? (
            <div className="space-y-4">
              {imageUrls.map((url, index) => (
                <div key={`${index}-${url}`} className="border border-slate-200 dark:border-slate-700 rounded-lg p-4 bg-slate-50 dark:bg-slate-900">
                  <div className="mb-2 flex items-center justify-between">
                    <div className="text-sm font-medium text-slate-600 dark:text-slate-400">
                      {t.session.imageNofM.replace('{current}', String(index + 1)).replace('{total}', String(imageUrls.length))}
                    </div>
                    <button
                      type="button"
                      onClick={() => handleImageClick(index)}
                      className="text-xs px-3 py-1 bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-300 rounded"
                    >
                      {t.session.zoom}
                    </button>
                  </div>
                  <div className="max-h-[600px] overflow-auto flex items-start justify-center">
                    <ImageRotator
                      imageUrl={url || '/placeholder-image.jpg'}
                      onRotate={(blob) => handleRotate(blob, index)}
                      className="max-w-full max-h-[600px] object-contain"
                    />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="border border-slate-200 dark:border-slate-700 rounded-lg p-4 bg-slate-50 dark:bg-slate-900 flex items-center justify-center min-h-[200px]">
              <p className="text-slate-500 dark:text-slate-400">{t.session.noImages}</p>
            </div>
          )}

          {imageUrls.length > 0 && (
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-2">
              {t.upload.rotateHint}
            </p>
          )}
        </div>

        {/* 우측: 분석 결과 */}
        <div className="space-y-4">
          <h3 className="text-lg font-semibold text-slate-900 dark:text-white">{t.session.aiAnalysisResult}</h3>
          <div className="border border-slate-200 dark:border-slate-700 rounded-lg p-4">
            <MultiProblemEditor
              initial={{ items: data }}
              onSubmit={handleSubmit}
              onChange={(items) => setData(items)}
            />
          </div>
        </div>
      </div>

      {/* 이미지 모달 */}
      <ImageModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        imageUrl={imageUrls[selectedImageIndex] || ''}
        sessionId={sessionId}
      />
    </div>
  );
};
