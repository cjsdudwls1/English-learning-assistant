import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import type { ProblemItem } from '../types';
import { MultiProblemEditor } from '../components/MultiProblemEditor';
import { fetchSessionProblems, updateProblemLabels, getSessionStatus } from '../services/db';
import { supabase } from '../services/supabaseClient';
import { ImageRotator } from '../components/ImageRotator';
import { ImageModal } from '../components/ImageModal';

export const SessionDetailPage: React.FC = () => {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<ProblemItem[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sessionStatus, setSessionStatus] = useState<string>('pending');
  const [imageUrl, setImageUrl] = useState<string>('');
  const [imageUrls, setImageUrls] = useState<string[]>([]);
  const originalImageUrlRef = React.useRef<string>('');
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
    setImageUrl('');
    setImageUrls([]);

    let isMounted = true; // 컴포넌트 마운트 상태 추적

    (async () => {
      try {
        setLoading(true);
        
        // 세션 상태 확인
        const status = await getSessionStatus(sessionId);
        if (!isMounted) return;
        setSessionStatus(status);
        
        if (status === 'processing') {
          // 분석 중이면 analyzing 페이지로 리다이렉트
          navigate(`/analyzing/${sessionId}`);
          return;
        }
        
        if (status === 'failed') {
          if (isMounted) setError('분석 중 오류가 발생했습니다.');
          return;
        }
        
        if (status === 'completed') {
          // 분석 완료된 경우에만 문제 데이터 로드
          const items = await fetchSessionProblems(sessionId);
          if (!isMounted) return;
          setData(items);
          
          // 세션의 이미지 URL 가져오기 (image_urls 배열 우선, 없으면 image_url 사용)
          console.log('🔵 [SessionDetailPage] Fetching session image data for sessionId:', sessionId);
          const { data: sessionData, error: sessionError } = await supabase
            .from('sessions')
            .select('image_url, image_urls')
            .eq('id', sessionId)
            .single();
          
          if (sessionError) {
            console.error('❌ [SessionDetailPage] Failed to fetch session data:', sessionError);
            // 에러가 발생해도 계속 진행 (imageUrl이 없을 수도 있음)
          }
          
          if (sessionData) {
            console.log('🔵 [SessionDetailPage] Session data retrieved:', {
              sessionId,
              hasImageUrl: !!sessionData.image_url,
              hasImageUrls: !!sessionData.image_urls,
              imageUrlsType: typeof sessionData.image_urls,
              imageUrlsIsArray: Array.isArray(sessionData.image_urls),
              imageUrlsLength: Array.isArray(sessionData.image_urls) ? sessionData.image_urls.length : 0,
              imageUrlsRaw: sessionData.image_urls,
              imageUrlsStringified: JSON.stringify(sessionData.image_urls),
            });
            
            // image_urls 배열을 우선 사용, 없으면 image_url을 배열로 변환해 하위 호환성 유지
            let urls: string[] = [];
            
            // 1. image_urls 배열이 있으면 우선 사용
            if (sessionData.image_urls !== null && sessionData.image_urls !== undefined) {
              console.log('🔵 [SessionDetailPage] Processing image_urls, type:', typeof sessionData.image_urls, 'isArray:', Array.isArray(sessionData.image_urls));
              
              // image_urls가 배열인지 확인
              if (Array.isArray(sessionData.image_urls)) {
                console.log('🔵 [SessionDetailPage] image_urls is array, length:', sessionData.image_urls.length);
                urls = sessionData.image_urls
                  .filter((url: any) => {
                    const isValid = url && typeof url === 'string' && url.trim().length > 0;
                    if (!isValid) {
                      console.warn('🔵 [SessionDetailPage] Filtered out invalid URL:', url);
                    }
                    return isValid;
                  })
                  .map((url: string) => url.trim());
                console.log('🔵 [SessionDetailPage] image_urls filtered URLs:', urls, 'count:', urls.length);
              } else if (typeof sessionData.image_urls === 'string') {
                // 문자열로 저장된 경우 JSON 파싱 시도
                try {
                  const parsed = JSON.parse(sessionData.image_urls);
                  console.log('🔵 [SessionDetailPage] Parsed image_urls string:', parsed);
                  if (Array.isArray(parsed)) {
                    urls = parsed
                      .filter((url: any) => url && typeof url === 'string' && url.trim().length > 0)
                      .map((url: string) => url.trim());
                  } else if (parsed && typeof parsed === 'object' && parsed !== null) {
                    // 객체 형태로 반환된 경우: 숫자 키를 기준으로 정렬하여 배열로 변환
                    const keys = Object.keys(parsed)
                      .map(k => parseInt(k, 10))
                      .filter(k => !isNaN(k))
                      .sort((a, b) => a - b);
                    urls = keys
                      .map(key => parsed[key])
                      .filter((url: any) => url && typeof url === 'string' && url.trim().length > 0)
                      .map((url: string) => url.trim());
                    console.log('🔵 [SessionDetailPage] Converted object to array (sorted by numeric keys):', urls);
                  }
                } catch (e) {
                  console.warn('🔵 [SessionDetailPage] Failed to parse image_urls as JSON:', e);
                }
              } else if (sessionData.image_urls && typeof sessionData.image_urls === 'object' && !Array.isArray(sessionData.image_urls)) {
                // 객체 형태로 반환된 경우 (예: {0: "url1", 1: "url2"} 또는 {0: "url1", 1: "url2"})
                console.log('🔵 [SessionDetailPage] image_urls is object (not array), converting to array:', sessionData.image_urls);
                
                // 숫자 키를 기준으로 정렬하여 배열로 변환
                const keys = Object.keys(sessionData.image_urls)
                  .map(k => parseInt(k, 10))
                  .filter(k => !isNaN(k))
                  .sort((a, b) => a - b);
                
                // 숫자 키가 있으면 그대로 사용, 없으면 Object.values 사용
                if (keys.length > 0) {
                  urls = keys
                    .map(key => sessionData.image_urls[key])
                    .filter((url: any) => url && typeof url === 'string' && url.trim().length > 0)
                    .map((url: string) => url.trim());
                  console.log('🔵 [SessionDetailPage] Converted object to array using numeric keys:', urls);
                } else {
                  // 숫자 키가 없으면 Object.values 사용 (순서 보장 안됨)
                  urls = Object.values(sessionData.image_urls)
                    .filter((url: any) => url && typeof url === 'string' && url.trim().length > 0)
                    .map((url: string) => url.trim()) as string[];
                  console.log('🔵 [SessionDetailPage] Converted object to array using Object.values:', urls);
                }
              }
            }
            
            // 2. image_urls가 없거나 빈 배열이면 image_url을 배열로 변환 (하위 호환성)
            if (urls.length === 0 && sessionData.image_url) {
              console.log('🔵 [SessionDetailPage] No image_urls found, using image_url:', sessionData.image_url);
              urls = [sessionData.image_url]
                .filter((url: string) => url && typeof url === 'string' && url.trim().length > 0)
                .map((url: string) => url.trim());
            }
            
            console.log('🔵 [SessionDetailPage] Final processed image URLs:', { 
              urls, 
              count: urls.length,
              urlsDetail: urls.map((url, idx) => ({ index: idx, url: url.substring(0, 50) + '...' }))
            });
            
            // 컴포넌트가 마운트되어 있는 경우에만 상태 업데이트
            if (isMounted) {
              // 유효한 URL 배열이 있는 경우에만 업데이트
              if (Array.isArray(urls) && urls.length > 0) {
                console.log('✅ [SessionDetailPage] Updating imageUrls state with', urls.length, 'URLs:', urls);
                const urlsCopy = [...urls]; // 새 배열로 복사하여 상태 업데이트 보장
                setImageUrls(urlsCopy);
                // originalImageUrlsRef로 원본 URL 배열 추적
                originalImageUrlsRef.current = [...urlsCopy];
            
                // 첫 번째 이미지를 메인 이미지로 설정 (하위 호환성)
                const firstUrl = urlsCopy[0];
                setImageUrl(firstUrl);
                originalImageUrlRef.current = firstUrl;
                console.log('✅ [SessionDetailPage] State updated - imageUrls:', urlsCopy.length, 'imageUrl:', firstUrl?.substring(0, 50) + '...');
              } else {
                console.warn('⚠️ [SessionDetailPage] No valid URLs found, urls:', urls, 'type:', typeof urls, 'isArray:', Array.isArray(urls));
                // 빈 배열로 설정
                setImageUrls([]);
                originalImageUrlsRef.current = [];
                setImageUrl('');
              }
            } else {
              console.warn('⚠️ [SessionDetailPage] Component unmounted, skipping state update');
            }
          } else {
            console.warn('⚠️ [SessionDetailPage] No session data found, sessionError:', sessionError);
            // sessionData가 없어도 계속 진행 (이미지가 없을 수도 있음)
            if (isMounted) {
              setImageUrls([]);
              setImageUrl('');
            }
          }
        }
      } catch (e) {
        console.error('❌ [SessionDetailPage] Error in useEffect:', e);
        if (isMounted) {
        setError(e instanceof Error ? e.message : '문제를 불러오는데 실패했습니다.');
        }
      } finally {
        if (isMounted) {
        setLoading(false);
        }
      }
    })();

    // cleanup 함수: 컴포넌트 언마운트 시 플래그 설정
    return () => {
      isMounted = false;
    };
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
        alert('모든 문제에 정답 또는 오답을 선택해주세요.');
        return;
      }
      
      await updateProblemLabels(sessionId, items);
      alert('저장 완료! 통계에 반영되었습니다.');
      navigate('/stats');
    } catch (e) {
      alert(e instanceof Error ? e.message : '저장 중 오류가 발생했습니다.');
    }
  };

  const handleImageClick = (index: number) => {
    setSelectedImageIndex(index);
    setIsModalOpen(true);
  };

  const handleRotate = async (rotatedBlob: Blob, imageIndex: number) => {
    if (!sessionId) return;
    
    try {
      // 각 이미지별 회전 지원: 해당 인덱스의 이미지 URL 가져오기
      const currentUrls = originalImageUrlsRef.current.length > 0 
        ? originalImageUrlsRef.current 
        : imageUrls.length > 0 
          ? imageUrls 
          : imageUrl 
            ? [imageUrl] 
            : [];
      
      if (imageIndex < 0 || imageIndex >= currentUrls.length) {
        throw new Error('이미지 인덱스가 유효하지 않습니다.');
      }
      
      const currentUrl = currentUrls[imageIndex];
      if (!currentUrl) throw new Error('이미지 URL을 찾을 수 없습니다.');

      const match = currentUrl.match(/\/object\/public\/problem-images\/(.*)$/);
      if (!match || !match[1]) throw new Error('스토리지 경로를 파싱할 수 없습니다.');
      const storagePath = match[1];

      const rotatedFile = new File([rotatedBlob], storagePath.split('/').pop() || `rotated_${Date.now()}.jpg`, {
        type: rotatedBlob.type,
        lastModified: Date.now(),
      });

      // 업로드: 일시 오류 대비 재시도(최대 3회)
      let uploadError: any = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        const { error } = await supabase.storage
          .from('problem-images')
          .upload(storagePath, rotatedFile, {
            contentType: rotatedBlob.type,
            cacheControl: '0',
            upsert: true,
          });
        if (!error) { uploadError = null; break; }
        uploadError = error;
        await new Promise(r => setTimeout(r, 200 * (attempt + 1)));
      }
      if (uploadError) throw uploadError;

      // 캐시 무효화를 위해 쿼리스트링 버전 부여
      const cacheBustedUrl = `${currentUrl.split('?')[0]}?v=${Date.now()}`;

      // 회전 시 image_urls 배열도 업데이트
      const updatedUrls = [...currentUrls];
      updatedUrls[imageIndex] = cacheBustedUrl;
      
      // image_url도 첫 번째 이미지로 업데이트 (하위 호환성)
      const updatedImageUrl = updatedUrls[0];

      // DB에 image_url과 image_urls 모두 업데이트 (재시도 포함)
      let updateError: any = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        const { error } = await supabase
          .from('sessions')
          .update({ 
            image_url: updatedImageUrl,  // 첫 번째 이미지 URL
            image_urls: updatedUrls       // 전체 이미지 URL 배열
          })
          .eq('id', sessionId);
        if (!error) { updateError = null; break; }
        updateError = error;
        await new Promise(r => setTimeout(r, 200 * (attempt + 1)));
      }
      if (updateError) throw updateError;

      // 상태 업데이트
      setImageUrls(updatedUrls);
      originalImageUrlsRef.current = updatedUrls;
      if (imageIndex === 0) {
        setImageUrl(updatedImageUrl);
        originalImageUrlRef.current = updatedImageUrl;
      }
      
    } catch (error) {
      console.error('Image rotation failed:', error);
      alert('이미지 회전 중 오류가 발생했습니다.');
    }
  };

  // 렌더링 전 상태 확인
  console.log('🟡 [SessionDetailPage] Component render state:', {
    loading,
    error,
    hasData: !!data,
    dataLength: data?.length || 0,
    imageUrl,
    imageUrls: imageUrls,
    imageUrlsLength: imageUrls?.length || 0,
    imageUrlsIsArray: Array.isArray(imageUrls),
    sessionId
  });

  if (loading) {
    return (
      <div className="mx-auto bg-white rounded-2xl shadow-lg p-4 sm:p-6 md:p-8 border border-slate-200 max-w-full lg:max-w-6xl">
        <p className="text-center text-slate-600">불러오는 중...</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="max-w-6xl mx-auto bg-white rounded-2xl shadow-lg p-6 md:p-8 border border-slate-200">
        <p className="text-center text-red-600">{error || '문제를 찾을 수 없습니다.'}</p>
        <div className="text-center mt-4">
          <button
            onClick={() => navigate('/stats')}
            className="px-6 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
          >
            통계로 돌아가기
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto bg-white rounded-2xl shadow-lg p-6 md:p-8 border border-slate-200">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold">세션 상세</h2>
        <button
          onClick={() => navigate('/stats')}
          className="px-4 py-2 text-slate-600 hover:text-slate-800 underline"
        >
          통계로 돌아가기
        </button>
      </div>
      
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* 좌측: 이미지 영역 */}
        <div className="space-y-4">
          <h3 className="text-lg font-semibold">
            업로드된 이미지 {Array.isArray(imageUrls) && imageUrls.length > 0 ? `(${imageUrls.length}장)` : ''}
          </h3>
          
          {/* 디버그 정보 표시 (개발 환경) */}
          {process.env.NODE_ENV === 'development' && (
            <div className="text-xs text-gray-500 bg-gray-100 p-2 rounded mb-2">
              <div>imageUrls.length: {Array.isArray(imageUrls) ? imageUrls.length : 'N/A'}</div>
              <div>imageUrl: {imageUrl ? '있음' : '없음'}</div>
              <div>imageUrls type: {typeof imageUrls}</div>
              <div>imageUrls isArray: {Array.isArray(imageUrls) ? 'true' : 'false'}</div>
            </div>
          )}
          
          {(() => {
            console.log('🟢 [SessionDetailPage] Render - Image URLs state:', {
              imageUrlsLength: imageUrls?.length || 0,
              imageUrls: imageUrls,
              imageUrl: imageUrl,
              hasImageUrls: Array.isArray(imageUrls) && imageUrls.length > 0,
              hasImageUrl: !!imageUrl,
              willRenderMultiple: Array.isArray(imageUrls) && imageUrls.length > 0,
              willRenderSingle: !(Array.isArray(imageUrls) && imageUrls.length > 0) && !!imageUrl,
              imageUrlsIsArray: Array.isArray(imageUrls),
              imageUrlsType: typeof imageUrls
            });
            return null;
          })()}
          {(() => {
            const hasMultipleImages = Array.isArray(imageUrls) && imageUrls.length > 0;
            const hasSingleImage = !hasMultipleImages && !!imageUrl && typeof imageUrl === 'string' && imageUrl.trim().length > 0;
            
            console.log('🟢 [SessionDetailPage] Rendering decision:', {
              hasMultipleImages,
              hasSingleImage,
              imageUrlsCount: Array.isArray(imageUrls) ? imageUrls.length : 0,
              imageUrlExists: !!imageUrl,
              imageUrlLength: imageUrl?.length || 0,
              imageUrlType: typeof imageUrl
            });
            
            if (hasMultipleImages) {
              console.log('🟢 [SessionDetailPage] Will render multiple images:', imageUrls);
              return (
            <div className="space-y-4">
              {/* 여러 이미지를 각각 ImageRotator로 표시 */}
                  {imageUrls.map((url, index) => {
                    console.log(`🟢 [SessionDetailPage] Rendering image ${index + 1}/${imageUrls.length}:`, url?.substring(0, 50) + '...');
                    return (
                      <div key={`image-${index}-${url?.substring(0, 20)}`} className="border border-slate-200 rounded-lg p-4 bg-slate-50">
                  {/* 각 이미지에 번호 표시 (예: "이미지 1/2") */}
                  <div className="mb-2 text-sm font-medium text-slate-600">
                    이미지 {index + 1}/{imageUrls.length}
                  </div>
                  <div className="max-h-[600px] overflow-auto flex items-start justify-center">
                    <ImageRotator
                      imageUrl={url || '/placeholder-image.jpg'}
                      onRotate={(blob) => handleRotate(blob, index)}
                      className="max-w-full max-h-[600px] object-contain"
                    />
                  </div>
                </div>
                    );
                  })}
            </div>
              );
            } else if (hasSingleImage) {
              console.log('🟢 [SessionDetailPage] Will render single image:', imageUrl);
              return (
            <div className="border border-slate-200 rounded-lg p-4 max-h-[800px] overflow-auto bg-slate-50 flex items-start justify-center">
              <ImageRotator
                imageUrl={imageUrl || '/placeholder-image.jpg'}
                onRotate={(blob) => handleRotate(blob, 0)}
                className="max-w-full max-h-[800px] object-contain"
              />
            </div>
              );
            } else {
              console.log('🟢 [SessionDetailPage] No images to render', {
                imageUrlsLength: Array.isArray(imageUrls) ? imageUrls.length : 'N/A',
                imageUrl: imageUrl,
                hasImageUrl: !!imageUrl
              });
              return (
                <div className="border border-slate-200 rounded-lg p-4 bg-slate-50 flex flex-col items-center justify-center min-h-[200px]">
                  <p className="text-slate-500 mb-2">이미지가 없습니다</p>
                  {process.env.NODE_ENV === 'development' && (
                    <div className="text-xs text-gray-400 text-center">
                      <div>디버그: imageUrls = {JSON.stringify(imageUrls)}</div>
                      <div>디버그: imageUrl = {imageUrl || '(없음)'}</div>
            </div>
          )}
                </div>
              );
            }
          })()}
          {Array.isArray(imageUrls) && imageUrls.length > 0 && (
            <p className="text-sm text-slate-500 mt-2">
              회전 버튼을 사용하여 각 이미지의 방향을 조정할 수 있습니다
            </p>
          )}
        </div>
        
        {/* 우측: 분석 결과 */}
        <div className="space-y-4">
          <h3 className="text-lg font-semibold">AI 분석 결과</h3>
          <div className="border border-slate-200 rounded-lg p-4">
            <MultiProblemEditor 
              initial={{ items: data }} 
              onSubmit={handleSubmit} 
              onChange={(items) => setData(items)} 
            />
          </div>
        </div>
      </div>
      
      {/* 이미지 모달 */}
      {Array.isArray(imageUrls) && imageUrls.length > 0 && (
      <ImageModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
          imageUrl={imageUrls[selectedImageIndex] || imageUrl}
        sessionId={sessionId}
      />
      )}
    </div>
  );
};
