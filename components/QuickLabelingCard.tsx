import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchSessionProblems } from '../services/db';

interface QuickLabelingCardProps {
  sessionId: string;
  imageUrl: string;
  onSave?: () => void;
}

export const QuickLabelingCard: React.FC<QuickLabelingCardProps> = ({ 
  sessionId, 
  imageUrl, 
  onSave 
}) => {
  const navigate = useNavigate();
  const [problemCount, setProblemCount] = useState<number>(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadProblemCount();
  }, [sessionId]);

  const loadProblemCount = async () => {
    try {
      setLoading(true);
      const data = await fetchSessionProblems(sessionId);
      setProblemCount(data.length);
    } catch (error) {
      console.error('Failed to load problems:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="bg-white rounded-2xl shadow-lg p-6 md:p-8 border border-slate-200">
        <div className="text-center py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600 mx-auto"></div>
          <p className="mt-4 text-slate-600">문제 불러오는 중...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl shadow-lg p-6 md:p-8 border border-slate-200 mb-6">
      <div className="flex items-start gap-6">
        {/* 이미지 썸네일 */}
        <img 
          src={imageUrl} 
          alt="문제 이미지" 
          className="w-24 h-24 object-cover rounded border flex-shrink-0"
        />
        
        {/* 안내 메시지 */}
        <div className="flex-1">
          <h3 className="text-xl font-bold text-slate-800 mb-2">AI 분석 완료</h3>
          <p className="text-slate-600 mb-4">
            AI가 분석한 문제 {problemCount}개를 확인하고 검수해주세요.
          </p>
          <p className="text-sm text-slate-500">
            상세보기에서 문제 유형, 정오답 등을 확인하고 수정할 수 있습니다.
          </p>
        </div>
        
        {/* 상세보기 버튼 */}
        <div className="self-start">
          <button
            onClick={() => navigate(`/session/${sessionId}`)}
            className="px-6 py-3 bg-indigo-600 text-white rounded-lg font-semibold hover:bg-indigo-700 shadow-md"
          >
            상세보기 및 검수
          </button>
        </div>
      </div>
    </div>
  );
};
