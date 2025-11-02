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
  const originalImageUrlRef = React.useRef<string>('');
  const [isModalOpen, setIsModalOpen] = useState(false);

  useEffect(() => {
    if (!sessionId) {
      navigate('/stats');
      return;
    }

    // sessionId 변경 시 이전 데이터 초기화
    setData(null);
    setError(null);
    setImageUrl('');

    (async () => {
      try {
        setLoading(true);
        
        // 세션 상태 확인
        const status = await getSessionStatus(sessionId);
        setSessionStatus(status);
        
        if (status === 'processing') {
          // 분석 중이면 analyzing 페이지로 리다이렉트
          navigate(`/analyzing/${sessionId}`);
          return;
        }
        
        if (status === 'failed') {
          setError('분석 중 오류가 발생했습니다.');
          return;
        }
        
        if (status === 'completed') {
          // 분석 완료된 경우에만 문제 데이터 로드
          const items = await fetchSessionProblems(sessionId);
          setData(items);
          
          // 세션의 이미지 URL 가져오기
          const { data: sessionData, error: sessionError } = await supabase
            .from('sessions')
            .select('image_url')
            .eq('id', sessionId)
            .single();
          
          if (!sessionError && sessionData) {
            setImageUrl(sessionData.image_url);
            originalImageUrlRef.current = sessionData.image_url;
          }
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : '문제를 불러오는데 실패했습니다.');
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

  const handleImageClick = () => {
    setIsModalOpen(true);
  };

  const handleRotate = async (rotatedBlob: Blob) => {
    if (!sessionId) return;
    
    try {
      // 기존 public URL에서 스토리지 경로 추출 후 동일 경로로 덮어쓰기(upsert)
      // 주의: blob: 미리보기 URL이 아닌 원본 서버 URL을 사용해야 함
      const currentUrl = originalImageUrlRef.current || imageUrl;
      if (!currentUrl) throw new Error('이미지 URL을 찾을 수 없습니다.');

      const match = currentUrl.match(/\/object\/public\/problem-images\/(.*)$/);
      if (!match || !match[1]) throw new Error('스토리지 경로를 파싱할 수 없습니다.');
      const storagePath = match[1];

      const rotatedFile = new File([rotatedBlob], storagePath.split('/').pop() || `rotated_${Date.now()}.jpg`, {
        type: rotatedBlob.type,
        lastModified: Date.now(),
      });

      // 업로드: 일시 오류 대비 재시도(최대 2회)
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

      // DB 업데이트(재시도 포함)
      let updateError: any = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        const { error } = await supabase
          .from('sessions')
          .update({ image_url: cacheBustedUrl })
          .eq('id', sessionId);
        if (!error) { updateError = null; break; }
        updateError = error;
        await new Promise(r => setTimeout(r, 200 * (attempt + 1)));
      }
      if (updateError) throw updateError;

      setImageUrl(cacheBustedUrl);
      originalImageUrlRef.current = cacheBustedUrl;
      
    } catch (error) {
      console.error('Image rotation failed:', error);
      alert('이미지 회전 중 오류가 발생했습니다.');
    }
  };

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
          <h3 className="text-lg font-semibold">업로드된 이미지</h3>
          <div className="border border-slate-200 rounded-lg p-4 max-h-[800px] overflow-auto bg-slate-50 flex items-start justify-center">
            <ImageRotator
              imageUrl={imageUrl || '/placeholder-image.jpg'}
              onRotate={handleRotate}
              className="max-w-full max-h-[800px] object-contain"
            />
          </div>
          <p className="text-sm text-slate-500 mt-2">
            회전 버튼을 사용하여 이미지 방향을 조정할 수 있습니다
          </p>
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
      <ImageModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        imageUrl={imageUrl}
        sessionId={sessionId}
      />
    </div>
  );
};
