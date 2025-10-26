import React, { useState, useEffect } from 'react';
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
  const [problems, setProblems] = useState<{ id: string; index_in_image: number }[]>([]);
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
      // 초기 라벨 상태 초기화
      const initialLabels: Record<string, '정답' | '오답' | null> = {};
      data.forEach(p => {
        initialLabels[p.id] = null;
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
        
        {/* 저장 버튼 */}
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-6 py-2 bg-indigo-600 text-white rounded-lg font-semibold hover:bg-indigo-700 disabled:bg-gray-400 disabled:cursor-not-allowed self-start"
        >
          {saving ? '저장 중...' : '저장'}
        </button>
      </div>
    </div>
  );
};
