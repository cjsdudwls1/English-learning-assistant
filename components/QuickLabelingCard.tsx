import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchProblemsForLabeling, quickUpdateLabels } from '../services/db';

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
  const [problems, setProblems] = useState<{ id: string; index_in_image: number; ai_is_correct: boolean | null }[]>([]);
  const [labels, setLabels] = useState<Record<string, '정답' | '오답' | null>>({});
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadProblems();
  }, [sessionId]);

  const loadProblems = async () => {
    try {
      setLoading(true);
      const data = await fetchProblemsForLabeling(sessionId);
      setProblems(data);
      // AI 분석 결과를 초기값으로 설정
      const initialLabels: Record<string, '정답' | '오답' | null> = {};
      data.forEach(p => {
        // AI가 분석한 결과를 초기값으로 설정
        if (p.ai_is_correct !== null) {
          initialLabels[p.id] = p.ai_is_correct ? '정답' : '오답';
        } else {
          initialLabels[p.id] = null;
        }
      });
      setLabels(initialLabels);
    } catch (error) {
      console.error('Failed to load problems:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleMarkChange = (problemId: string, mark: '정답' | '오답') => {
    setLabels(prev => ({
      ...prev,
      [problemId]: mark
    }));
  };

  const handleSave = async () => {
    // 모든 문제에 라벨이 있는지 확인
    const allLabeled = Object.values(labels).every(label => label !== null);
    if (!allLabeled) {
      alert('모든 문제에 정답 또는 오답을 선택해주세요.');
      return;
    }

    try {
      setSaving(true);
      
      // 모든 문제의 라벨 저장
      await Promise.all(
        Object.entries(labels).map(([problemId, mark]) => {
          if (mark) {
            return quickUpdateLabels(sessionId, problemId, mark);
          }
        })
      );
      
      // 저장 완료 후 콜백 호출
      onSave?.();
      
      // 저장 완료 후 상세보기 페이지로 이동 옵션 제공 (선택사항)
      // navigate(`/session/${sessionId}`);
    } catch (error) {
      console.error('Failed to save labels:', error);
      alert('저장 중 오류가 발생했습니다.');
    } finally {
      setSaving(false);
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
        
        {/* 문제 목록 - 세로 레이아웃 */}
        <div className="flex-1">
          <div className="space-y-3">
            {problems.map((problem) => (
              <div key={problem.id} className="flex items-center gap-3">
                <span className="font-semibold text-lg min-w-[50px]">Q{problem.index_in_image}</span>
                <button
                  onClick={() => handleMarkChange(problem.id, '정답')}
                  className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                    labels[problem.id] === '정답'
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                  }`}
                >
                  정답
                </button>
                <button
                  onClick={() => handleMarkChange(problem.id, '오답')}
                  className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                    labels[problem.id] === '오답'
                      ? 'bg-red-600 text-white'
                      : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                  }`}
                >
                  오답
                </button>
              </div>
            ))}
          </div>
        </div>
        
        {/* 저장 및 상세보기 버튼 */}
        <div className="flex flex-col gap-2 self-start">
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-6 py-2 bg-indigo-600 text-white rounded-lg font-semibold hover:bg-indigo-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
          >
            {saving ? '저장 중...' : '저장'}
          </button>
          <button
            onClick={() => navigate(`/session/${sessionId}`)}
            className="px-6 py-2 bg-gray-200 text-gray-700 rounded-lg font-semibold hover:bg-gray-300"
          >
            상세보기
          </button>
        </div>
      </div>
    </div>
  );
};
