import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchSessionProblems, updateProblemLabels } from '../services/db';
import type { ProblemItem, QuestionType } from '../types';
import { useLanguage } from '../contexts/LanguageContext';
import { getTranslation } from '../utils/translations';

interface QuickLabelingCardProps {
  sessionId: string;
  imageUrl: string;
  analysisModel?: string | null;
  modelsUsed?: { ocr?: string; analysis?: string } | null;
  onSave?: () => void;
  onDelete?: (sessionId: string) => void;
}

/** 문제 유형 판별 헬퍼 */
function inferQuestionType(problem: ProblemItem): QuestionType {
  if (problem.question_type && problem.question_type !== 'unknown') {
    return problem.question_type;
  }
  if (problem.문제_보기 && problem.문제_보기.length > 0) {
    return 'multiple_choice';
  }
  const ca = problem.correct_answer?.trim()?.toUpperCase();
  if (ca === 'O' || ca === 'X' || ca === 'TRUE' || ca === 'FALSE') {
    return 'ox';
  }
  return 'short_answer';
}

export const QuickLabelingCard: React.FC<QuickLabelingCardProps> = ({
  sessionId,
  imageUrl,
  analysisModel,
  modelsUsed,
  onSave,
  onDelete,
}) => {
  const { language } = useLanguage();
  const t = getTranslation(language);
  const navigate = useNavigate();
  const [problems, setProblems] = useState<ProblemItem[]>([]);
  const [labels, setLabels] = useState<Record<string, 'O' | 'X'>>({});
  const [editableAnswers, setEditableAnswers] = useState<Record<string, string>>({});
  const [editableCorrectAnswers, setEditableCorrectAnswers] = useState<Record<string, string>>({});
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

      const initialLabels: Record<string, 'O' | 'X'> = {};
      const initialAnswers: Record<string, string> = {};
      const initialCorrectAnswers: Record<string, string> = {};
      data.forEach(p => {
        const mark = p.사용자가_직접_채점한_정오답;
        if (mark === 'O' || mark === 'X') {
          initialLabels[`${p.index}`] = mark;
        } else if (p.AI가_판단한_정오답 === '정답') {
          initialLabels[`${p.index}`] = 'O';
        } else if (p.AI가_판단한_정오답 === '오답') {
          initialLabels[`${p.index}`] = 'X';
        }
        initialAnswers[`${p.index}`] = p.사용자가_기술한_정답?.text || '';
        initialCorrectAnswers[`${p.index}`] = p.correct_answer || '';
      });
      setLabels(initialLabels);
      setEditableAnswers(initialAnswers);
      setEditableCorrectAnswers(initialCorrectAnswers);
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

  const handleAnswerChange = (index: number, value: string) => {
    setEditableAnswers(prev => ({ ...prev, [`${index}`]: value }));
  };

  const handleCorrectAnswerChange = (index: number, value: string) => {
    setEditableCorrectAnswers(prev => ({ ...prev, [`${index}`]: value }));
  };

  const handleSave = async () => {
    if (problems.length === 0) {
      alert(language === 'ko' ? '저장할 문제가 없습니다.' : 'No problems to save.');
      return;
    }

    const itemsToSave: ProblemItem[] = problems.map(p => ({
      ...p,
      사용자가_직접_채점한_정오답: labels[`${p.index}`] || p.사용자가_직접_채점한_정오답,
      사용자가_기술한_정답: {
        ...p.사용자가_기술한_정답,
        text: editableAnswers[`${p.index}`] ?? p.사용자가_기술한_정답?.text ?? '',
      },
      correct_answer: editableCorrectAnswers[`${p.index}`] ?? p.correct_answer ?? '',
    }));

    try {
      setSaving(true);
      await updateProblemLabels(sessionId, itemsToSave);
      alert(language === 'ko' ? '저장 완료! 통계에 반영되었습니다.' : 'Saved! Stats updated.');
      onSave?.();
    } catch (error) {
      console.error('Failed to save labels:', error);
      alert(language === 'ko' ? '저장 중 오류가 발생했습니다.' : 'Error while saving.');
    } finally {
      setSaving(false);
    }
  };

  const getTypeLabel = (type: QuestionType): string => {
    const map: Record<QuestionType, { ko: string; en: string }> = {
      multiple_choice: { ko: '객관식', en: 'Multiple Choice' },
      short_answer: { ko: '주관식', en: 'Short Answer' },
      essay: { ko: '서술형', en: 'Essay' },
      ox: { ko: 'O/X', en: 'True/False' },
      unknown: { ko: '기타', en: 'Other' },
    };
    return language === 'ko' ? map[type].ko : map[type].en;
  };

  if (loading) {
    return (
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-lg p-6 md:p-8 border border-slate-200 dark:border-slate-700 mb-6">
        <div className="text-center py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600 dark:border-indigo-400 mx-auto"></div>
          <p className="mt-4 text-slate-600 dark:text-slate-400">
            {language === 'ko' ? '문제 불러오는 중...' : 'Loading problems...'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative bg-white dark:bg-slate-800 rounded-2xl shadow-lg p-6 md:p-8 border border-slate-200 dark:border-slate-700 mb-6">
      {onDelete && (
        <button
          type="button"
          onClick={() => onDelete(sessionId)}
          aria-label={language === 'ko' ? '세션 삭제' : 'Delete session'}
          title={language === 'ko' ? '삭제' : 'Delete'}
          className="absolute right-3 top-3 inline-flex h-9 w-9 items-center justify-center rounded-full bg-red-50 text-red-700 hover:bg-red-100 dark:bg-red-900/20 dark:text-red-200 dark:hover:bg-red-900/40"
        >
          <span className="text-xl leading-none">&times;</span>
        </button>
      )}
      <div className="flex items-start gap-6 mb-6">
        <img
          src={imageUrl}
          alt={language === 'ko' ? '문제 이미지' : 'Problem Image'}
          className="w-24 h-24 object-cover rounded border border-slate-300 dark:border-slate-600 flex-shrink-0"
        />
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-2">
            <h3 className="text-xl font-bold text-slate-800 dark:text-slate-200">
              {language === 'ko' ? 'AI 분석 완료' : 'AI Analysis Complete'}
            </h3>
            {modelsUsed ? (
              <div className="flex flex-wrap gap-1">
                <span className="text-xs px-2 py-0.5 rounded bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-700">
                  OCR: {modelsUsed.ocr || '?'}
                </span>
                <span className="text-xs px-2 py-0.5 rounded bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-700">
                  {language === 'ko' ? '분석' : 'Analysis'}: {modelsUsed.analysis || '?'}
                </span>
              </div>
            ) : analysisModel ? (
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
          const qType = inferQuestionType(problem);

          return (
            <div key={problem.index} className="border border-slate-200 dark:border-slate-700 rounded-lg p-4 bg-slate-50 dark:bg-slate-900/50">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-2">
                    <span className="font-bold text-lg text-slate-700 dark:text-slate-300">Q{problem.index + 1}</span>
                    <span className="text-xs px-2 py-0.5 rounded bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-700">
                      {getTypeLabel(qType)}
                    </span>
                    {aiMark && (
                      <span className="text-xs px-2 py-1 rounded bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300">
                        AI: {aiMark}
                      </span>
                    )}
                  </div>

                  {/* 문제 내용 */}
                  <div className="mb-3">
                    <p className="text-slate-700 dark:text-slate-300 font-medium mb-2">{problem.문제내용.text}</p>
                    {qType === 'multiple_choice' && problem.문제_보기 && problem.문제_보기.length > 0 && (
                      <ul className="list-disc list-inside text-sm text-slate-600 dark:text-slate-400 space-y-1">
                        {problem.문제_보기.map((choice, idx) => (
                          <li key={idx}>{choice.text}</li>
                        ))}
                      </ul>
                    )}
                    {qType === 'ox' && (
                      <p className="text-sm text-slate-500 dark:text-slate-400 italic">
                        {language === 'ko' ? 'O/X 판별 문제' : 'True/False question'}
                      </p>
                    )}
                    {(qType === 'essay' || qType === 'short_answer') && (
                      <p className="text-sm text-slate-500 dark:text-slate-400 italic">
                        {qType === 'essay'
                          ? (language === 'ko' ? '서술형 문제' : 'Essay question')
                          : (language === 'ko' ? '주관식 문제' : 'Short answer question')}
                      </p>
                    )}
                  </div>

                  {/* 사용자 답안 + 정답 (편집 가능 텍스트 입력) */}
                  <div className="mb-3 space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-slate-500 dark:text-slate-400 whitespace-nowrap min-w-[70px]">
                        {language === 'ko' ? '사용자 답안:' : 'User answer:'}
                      </span>
                      <input
                        type="text"
                        value={editableAnswers[`${problem.index}`] ?? ''}
                        onChange={(e) => handleAnswerChange(problem.index, e.target.value)}
                        placeholder={language === 'ko' ? '답안 입력' : 'Enter answer'}
                        className="flex-1 px-2 py-1 text-sm border border-slate-300 dark:border-slate-600 rounded bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-200 focus:ring-1 focus:ring-indigo-500"
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-slate-500 dark:text-slate-400 whitespace-nowrap min-w-[70px]">
                        {language === 'ko' ? '실제 정답:' : 'Correct answer:'}
                      </span>
                      <input
                        type="text"
                        value={editableCorrectAnswers[`${problem.index}`] ?? ''}
                        onChange={(e) => handleCorrectAnswerChange(problem.index, e.target.value)}
                        placeholder={language === 'ko' ? '정답 입력' : 'Enter correct answer'}
                        className="flex-1 px-2 py-1 text-sm border border-slate-300 dark:border-slate-600 rounded bg-white dark:bg-slate-700 text-green-700 dark:text-green-400 font-medium focus:ring-1 focus:ring-green-500"
                      />
                    </div>
                  </div>

                  {/* 문제 유형 분류 */}
                  {problem.문제_유형_분류 && (
                    <div className="text-xs text-slate-500 dark:text-slate-400">
                      {[
                        problem.문제_유형_분류.depth1,
                        problem.문제_유형_분류.depth2,
                        problem.문제_유형_분류.depth3,
                        problem.문제_유형_분류.depth4,
                      ].filter(Boolean).join(' > ')}
                    </div>
                  )}
                </div>

                {/* 정답/오답 버튼 */}
                <div className="flex gap-2 flex-shrink-0">
                  <button
                    onClick={() => handleMarkChange(problem.index, 'O')}
                    className={`px-4 py-2 rounded-lg font-medium transition-colors ${currentMark === 'O'
                      ? 'bg-blue-600 dark:bg-blue-500 text-white'
                      : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600'
                      }`}
                  >
                    {t.labeling.correct}
                  </button>
                  <button
                    onClick={() => handleMarkChange(problem.index, 'X')}
                    className={`px-4 py-2 rounded-lg font-medium transition-colors ${currentMark === 'X'
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
