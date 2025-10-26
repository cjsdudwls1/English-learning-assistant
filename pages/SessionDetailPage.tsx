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
      await updateProblemLabels(sessionId, items);
      navigate('/stats');
    } catch (e) {
      alert(e instanceof Error ? e.message : '저장 중 오류가 발생했습니다.');
    }
  };

  const handleImageClick = () => {
    setIsModalOpen(true);
  };

  const handleRotate = async (rotationAngle: any) => {
    // CSS transform으로만 처리 - 서버 저장 불필요
    // 실제로는 rotation 상태만 변경되어 이미지가 회전됨
    console.log('Image rotation angle:', rotationAngle);
  };

  if (loading) {
    return (
      <div className="max-w-6xl mx-auto bg-white rounded-2xl shadow-lg p-6 md:p-8 border border-slate-200">
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
