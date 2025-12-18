import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchSessionProblems, updateProblemLabels } from '../services/db';
import type { ProblemItem } from '../types';
import { useLanguage } from '../contexts/LanguageContext';
import { getTranslation } from '../utils/translations';

interface QuickLabelingCardProps {
  sessionId: string;
  imageUrl: string;
  analysisModel?: string | null;
  onSave?: () => void;
}

export const QuickLabelingCard: React.FC<QuickLabelingCardProps> = ({ 
  sessionId, 
  imageUrl, 
  analysisModel,
  onSave 
}) => {
  const { language } = useLanguage();
  const t = getTranslation(language);
  const navigate = useNavigate();
  const [problems, setProblems] = useState<ProblemItem[]>([]);
  const [labels, setLabels] = useState<Record<string, 'O' | 'X'>>({});
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadProblems();
  }, [sessionId]);

  const loadProblems = async () => {
    try {
      setLoading(true);
      const data = await fetchSessionProblems(sessionId);
      setProblems(data);
      
      // AI 분석 결과를 초기값으로 설정 (user_mark가 null이면 AI 분석 결과 사용)
      const initialLabels: Record<string, 'O' | 'X'> = {};
      data.forEach(p => {
        // user_mark가 이미 있는 경우 그대로 사용, 없으면 AI 분석 결과 사용
        const mark = p.사용자가_직접_채점한_정오답;
        if (mark === 'O' || mark === 'X') {
          initialLabels[`${p.index}`] = mark;
        } else {
          // AI 분석 결과 사용
          initialLabels[`${p.index}`] = p.AI가_판단한_정오답 === '정답' ? 'O' : 'X';
        }
      });
      setLabels(initialLabels);
    } catch (error) {
      console.error('Failed to load problems:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleMarkChange = (index: number, mark: 'O' | 'X') => {
    setLabels(prev => ({
      ...prev,
      [`${index}`]: mark
    }));
  };

  const handleSave = async () => {
    // 모든 문제에 라벨이 있는지 확인
    if (problems.length === 0) {
      alert('저장할 문제가 없습니다.');
      return;
    }

    // labels를 ProblemItem 형식으로 변환
    const itemsToSave: ProblemItem[] = problems.map(p => ({
      ...p,
      사용자가_직접_채점한_정오답: labels[`${p.index}`] || p.사용자가_직접_채점한_정오답,
    }));

    try {
      setSaving(true);
      await updateProblemLabels(sessionId, itemsToSave);
      alert('저장 완료! 통계에 반영되었습니다.');
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
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-lg p-6 md:p-8 border border-slate-200 dark:border-slate-700 mb-6">
        <div className="text-center py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600 dark:border-indigo-400 mx-auto"></div>
          <p className="mt-4 text-slate-600 dark:text-slate-400">문제 불러오는 중...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-lg p-6 md:p-8 border border-slate-200 dark:border-slate-700 mb-6">
      <div className="flex items-start gap-6 mb-6">
        {/* 이미지 썸네일 */}
        <img 
          src={imageUrl} 
          alt={language === 'ko' ? '문제 이미지' : 'Problem Image'} 
          className="w-24 h-24 object-cover rounded border border-slate-300 dark:border-slate-600 flex-shrink-0"
        />
        
        {/* 헤더 */}
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-2">
            <h3 className="text-xl font-bold text-slate-800 dark:text-slate-200">
              {language === 'ko' ? 'AI 분석 완료' : 'AI Analysis Complete'}
            </h3>
            {analysisModel ? (
              <span className="text-xs px-2 py-1 rounded bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-600">
                Model: {analysisModel}
              </span>
            ) : null}
          </div>
          <p className="text-slate-600 dark:text-slate-400">
            {language === 'ko' 
              ? `AI가 분석한 문제 ${problems.length}개를 확인하고 검수해주세요.`
              : `Please review and verify ${problems.length} problem(s) analyzed by AI.`}
          </p>
        </div>
      </div>

      {/* 문제 목록 */}
      <div className="space-y-4 mb-6">
        {problems.map((problem) => {
          const currentMark = labels[`${problem.index}`] || 'O';
          const aiMark = problem.AI가_판단한_정오답;
          
          return (
            <div key={problem.index} className="border border-slate-200 dark:border-slate-700 rounded-lg p-4 bg-slate-50 dark:bg-slate-900/50">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-2">
                    <span className="font-bold text-lg text-slate-700 dark:text-slate-300">Q{problem.index + 1}</span>
                    {aiMark && (
                      <span className="text-xs px-2 py-1 rounded bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300">
                        AI: {aiMark}
                      </span>
                    )}
                  </div>
                  
                  {/* 문제 내용 */}
                  <div className="mb-3">
                    <p className="text-slate-700 dark:text-slate-300 font-medium mb-2">{problem.문제내용.text}</p>
                    {problem.문제_보기 && problem.문제_보기.length > 0 && (
                      <ul className="list-disc list-inside text-sm text-slate-600 dark:text-slate-400 space-y-1">
                        {problem.문제_보기.map((choice, idx) => (
                          <li key={idx}>{choice.text}</li>
                        ))}
                      </ul>
                    )}
                  </div>

                  {/* 사용자 답안 */}
                  {problem.사용자가_기술한_정답?.text && (
                    <div className="mb-3">
                      <span className="text-sm text-slate-500 dark:text-slate-400">사용자 답안: </span>
                      <span className="text-sm font-medium text-slate-700 dark:text-slate-300">{problem.사용자가_기술한_정답.text}</span>
                    </div>
                  )}

                  {/* 문제 유형 */}
                  {problem.문제_유형_분류 && (
                    <div className="text-xs text-slate-500 dark:text-slate-400">
                      {[
                        problem.문제_유형_분류['1Depth'],
                        problem.문제_유형_분류['2Depth'],
                        problem.문제_유형_분류['3Depth'],
                        problem.문제_유형_분류['4Depth'],
                      ].filter(Boolean).join(' > ')}
                    </div>
                  )}
                </div>

                {/* 정답/오답 버튼 */}
                <div className="flex gap-2 flex-shrink-0">
                  <button
                    onClick={() => handleMarkChange(problem.index, 'O')}
                    className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                      currentMark === 'O'
                        ? 'bg-blue-600 dark:bg-blue-500 text-white'
                        : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600'
                    }`}
                  >
                    {t.labeling.correct}
                  </button>
                  <button
                    onClick={() => handleMarkChange(problem.index, 'X')}
                    className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                      currentMark === 'X'
                        ? 'bg-red-600 dark:bg-red-500 text-white'
                        : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600'
                    }`}
                  >
                    {t.labeling.incorrect}
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* 저장 및 상세보기 버튼 */}
      <div className="flex gap-3 justify-end">
        <button
          onClick={() => navigate(`/session/${sessionId}`)}
          className="px-6 py-2 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg font-semibold hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
        >
          {t.labeling.viewDetails}
        </button>
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-6 py-2 bg-indigo-600 dark:bg-indigo-500 text-white rounded-lg font-semibold hover:bg-indigo-700 dark:hover:bg-indigo-600 disabled:bg-gray-400 dark:disabled:bg-gray-600 disabled:cursor-not-allowed transition-colors"
        >
          {saving ? t.labeling.saving : t.labeling.finalSave}
        </button>
      </div>
    </div>
  );
};
