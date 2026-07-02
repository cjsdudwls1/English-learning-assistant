import React, { useState, useEffect } from 'react';
import { ImageLightbox } from './ImageLightbox';
import { useNavigate } from 'react-router-dom';
import { fetchSessionProblems, updateProblemLabels, deleteProblems } from '../services/db';
import type { ProblemItem, QuestionType } from '../types';
import { useLanguage } from '../contexts/LanguageContext';
import { getTranslation } from '../utils/translations';
import { getManualReviewReason } from '../utils/gradingSafety';

interface QuickLabelingCardProps {
  sessionId: string;
  imageUrl: string;
  imageUrls?: string[];
  analysisModel?: string | null;
  modelsUsed?: { ocr?: string; analysis?: string } | null;
  onSave?: () => void;
  onDelete?: (sessionId: string) => void;
}

/**
 * 채점 비교용 정규화 — 백엔드 computeIsCorrect(dbOperations.js)의 서술형 정규화와 정합.
 * 대소문자·구두점(.,?!;:"/)·공백(한글 띄어쓰기 포함) 무시, 어포스트로피(')·하이픈(-)은 보존(can't≠cant).
 * 기존 autoJudge는 trim+소문자만 해서 "학교 미술" vs "학교미술" 같은 표면차이를 오답 처리 → 정답을 오답으로(confident-wrong) 표시하던 문제.
 */
function normalizeForCompare(s: string): string {
  return s
    .toLowerCase()
    .replace(/[.,?!;:"/]/g, '')
    .replace(/\s+/g, '');
}

/** 사용자 답안과 정답을 비교하여 자동 판정 */
function autoJudge(userAnswer: string, correctAnswer: string): 'O' | 'X' | null {
  const ua = normalizeForCompare(userAnswer);
  const ca = normalizeForCompare(correctAnswer);
  if (!ua || !ca) return null; // 둘 중 하나라도 (정규화 후) 비어있으면 자동 판정 불가
  return ua === ca ? 'O' : 'X';
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
  imageUrls,
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
  const [lightboxImageUrl, setLightboxImageUrl] = useState<string | null>(null);

  // 실제 표시할 이미지 목록 결정
  const displayImageUrls = (imageUrls && imageUrls.length > 0) ? imageUrls : (imageUrl ? [imageUrl] : []);

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
        // 복수답안·형식불일치는 저장된 구(舊) AI 판정을 신뢰하지 않음 — O/X 시드 안 함(수동 확인 유도)
        const reviewReason = getManualReviewReason({
          instruction: p.instruction,
          correctAnswer: p.correct_answer,
          userAnswer: p.사용자가_기술한_정답?.text,
          hasChoices: (p.문제_보기?.length ?? 0) > 0,
        });
        if (mark === 'O' || mark === 'X') {
          initialLabels[`${p.index}`] = mark; // 사용자 수동 채점은 항상 우선
        } else if (!reviewReason && p.AI가_판단한_정오답 === '정답') {
          initialLabels[`${p.index}`] = 'O';
        } else if (!reviewReason && p.AI가_판단한_정오답 === '오답') {
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

  // 복수답안·형식불일치 문항은 단일값 비교로 채점 불가 → 편집 시 자동판정 스킵(수동 O/X만 허용)
  const shouldSkipAutoJudge = (index: number, userAnswer: string, correctAnswer: string): boolean => {
    const problem = problems.find(p => p.index === index);
    return getManualReviewReason({
      instruction: problem?.instruction,
      correctAnswer,
      userAnswer,
      hasChoices: (problem?.문제_보기?.length ?? 0) > 0,
    }) !== null;
  };

  const handleAnswerChange = (index: number, value: string) => {
    setEditableAnswers(prev => ({ ...prev, [`${index}`]: value }));
    // 사용자 답안 변경 시 자동 재판정
    const correctAnswer = editableCorrectAnswers[`${index}`] ?? '';
    if (shouldSkipAutoJudge(index, value, correctAnswer)) return;
    const result = autoJudge(value, correctAnswer);
    if (result !== null) {
      setLabels(prev => ({ ...prev, [`${index}`]: result }));
    }
  };

  const handleCorrectAnswerChange = (index: number, value: string) => {
    setEditableCorrectAnswers(prev => ({ ...prev, [`${index}`]: value }));
    // 정답 변경 시 자동 재판정
    const userAnswer = editableAnswers[`${index}`] ?? '';
    if (shouldSkipAutoJudge(index, userAnswer, value)) return;
    const result = autoJudge(userAnswer, value);
    if (result !== null) {
      setLabels(prev => ({ ...prev, [`${index}`]: result }));
    }
  };

  const handleDeleteProblem = async (problem: ProblemItem) => {
    if (!problem.id) return;
    try {
      await deleteProblems([problem.id]);
      const key = `${problem.index}`;
      setProblems(prev => prev.filter(p => p.index !== problem.index));
      setLabels(prev => { const next = { ...prev }; delete next[key]; return next; });
      setEditableAnswers(prev => { const next = { ...prev }; delete next[key]; return next; });
      setEditableCorrectAnswers(prev => { const next = { ...prev }; delete next[key]; return next; });
    } catch (err) {
      console.error('Failed to delete problem:', err);
      alert(language === 'ko' ? '문제 삭제 중 오류가 발생했습니다.' : 'Error deleting problem.');
    }
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

  const isMany = displayImageUrls.length > 4;

  const thumbnails = (
    <div className={`flex flex-wrap gap-2 ${isMany ? 'w-full mb-4' : 'flex-shrink-0'}`}>
      {displayImageUrls.map((url, idx) => (
        <img
          key={`${idx}-${url}`}
          src={url}
          alt={language === 'ko' ? `문제 이미지 ${idx + 1}` : `Problem Image ${idx + 1}`}
          className={`${isMany ? 'w-16 h-16' : 'w-24 h-24'} object-cover rounded border border-slate-300 dark:border-slate-600 cursor-pointer hover:opacity-80 hover:ring-2 hover:ring-indigo-400 transition-all`}
          onClick={() => setLightboxImageUrl(url)}
          title={language === 'ko' ? '클릭하여 원본 보기' : 'Click to view original'}
        />
      ))}
    </div>
  );

  const headerContent = (
    <div className="flex-1 min-w-0">
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
      {displayImageUrls.length > 1 && (
        <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">
          {language === 'ko'
            ? `이미지 ${displayImageUrls.length}장 (클릭하여 확대)`
            : `${displayImageUrls.length} images (click to enlarge)`}
        </p>
      )}
    </div>
  );

  return (
    <div className="relative bg-white dark:bg-slate-800 rounded-2xl shadow-lg p-6 md:p-8 border border-slate-200 dark:border-slate-700 mb-6 overflow-hidden">
      {onDelete && (
        <button
          type="button"
          onClick={() => onDelete(sessionId)}
          aria-label={language === 'ko' ? '세션 삭제' : 'Delete session'}
          title={language === 'ko' ? '삭제' : 'Delete'}
          className="absolute right-3 top-3 z-10 inline-flex h-9 w-9 items-center justify-center rounded-full bg-red-50 text-red-700 hover:bg-red-100 dark:bg-red-900/20 dark:text-red-200 dark:hover:bg-red-900/40"
        >
          <span className="text-xl leading-none">&times;</span>
        </button>
      )}
      {isMany ? (
        <div className="mb-6">
          {thumbnails}
          {headerContent}
        </div>
      ) : (
        <div className="flex items-start gap-6 mb-6">
          {thumbnails}
          {headerContent}
        </div>
      )}

      {/* 문제 목록 */}
      <div className="space-y-4 mb-6">
        {problems.map((problem) => {
          // 라벨 없으면 undefined 유지 — O/X 어느 버튼도 강조 안 함. (기존 `|| 'O'`는 미채점/빈답 문항의 O 버튼을 파랗게 켜서 '정답'처럼 보이게 하던 문제)
          const currentMark = labels[`${problem.index}`];
          // 복수답안·형식불일치 감지(편집 중 값 반영) → AI 판정 배지 숨기고 '수동 확인' 안내
          const reviewReason = getManualReviewReason({
            instruction: problem.instruction,
            correctAnswer: editableCorrectAnswers[`${problem.index}`] ?? problem.correct_answer,
            userAnswer: editableAnswers[`${problem.index}`] ?? problem.사용자가_기술한_정답?.text,
            hasChoices: (problem.문제_보기?.length ?? 0) > 0,
          });
          const aiMark = reviewReason ? undefined : problem.AI가_판단한_정오답;
          const qType = inferQuestionType(problem);

          return (
            <div key={problem.index} className="relative border border-slate-200 dark:border-slate-700 rounded-lg p-4 bg-slate-50 dark:bg-slate-900/50">
              <div className="flex flex-col xl:flex-row items-start justify-between gap-4">
                <div className="flex-1 w-full">
                  <div className="flex flex-wrap items-center gap-3 mb-2">
                    <span className="font-bold text-lg text-slate-700 dark:text-slate-300">Q{problem.index + 1}</span>
                    <span className="text-xs px-2 py-0.5 rounded bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-700">
                      {getTypeLabel(qType)}
                    </span>
                    {aiMark && (
                      <span className="text-xs px-2 py-1 rounded bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300">
                        AI: {aiMark}
                      </span>
                    )}
                    {reviewReason && (
                      <span
                        className="text-xs px-2 py-1 rounded bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 border border-amber-300 dark:border-amber-700"
                        title={language === 'ko'
                          ? (reviewReason === '복수정답'
                              ? '정답이 여러 개인 문항입니다. 답안을 구분해 확인 후 직접 채점하세요.'
                              : '숫자/단어 형식이 맞지 않아 자동 채점을 보류했습니다. 직접 확인하세요.')
                          : 'Auto-grading withheld — please review manually.'}
                      >
                        {language === 'ko'
                          ? (reviewReason === '복수정답' ? '복수 정답 · 수동 확인' : '형식 확인 · 수동 확인')
                          : (reviewReason === '복수정답' ? 'Multiple answers · review' : 'Check format · review')}
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => handleDeleteProblem(problem)}
                      aria-label={language === 'ko' ? '문제 삭제' : 'Delete problem'}
                      title={language === 'ko' ? '이 문제 삭제' : 'Delete this problem'}
                      className="ml-auto inline-flex h-7 w-7 items-center justify-center rounded-full bg-slate-200 text-slate-600 hover:bg-red-100 hover:text-red-600 dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-red-900/40 dark:hover:text-red-400 transition-colors shadow-sm"
                    >
                      <span className="text-lg leading-none">&times;</span>
                    </button>
                  </div>

                  {/* 문제 내용 — 분리 표시 (지문/시각자료/지시문/본문/보기) */}
                  <div className="mb-3 space-y-2">
                    {problem.passage && (
                      <div className="rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/40 p-2">
                        <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500 mb-1">
                          {language === 'ko' ? '지문' : 'Passage'}
                        </div>
                        <p className="text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap leading-relaxed">{problem.passage}</p>
                      </div>
                    )}
                    {problem.visual_context && (problem.visual_context.title || problem.visual_context.content) && (
                      <div className="rounded border border-amber-200 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 p-2">
                        <div className="text-[10px] font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-400 mb-1">
                          {problem.visual_context.type || (language === 'ko' ? '자료' : 'Visual')}
                          {problem.visual_context.title ? ` — ${problem.visual_context.title}` : ''}
                        </div>
                        {problem.visual_context.content && (
                          <p className="text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap">{problem.visual_context.content}</p>
                        )}
                      </div>
                    )}
                    {problem.instruction && (
                      <div>
                        <div className="text-[10px] font-semibold uppercase tracking-wide text-indigo-500 dark:text-indigo-400 mb-1">
                          {language === 'ko' ? '지시문' : 'Instruction'}
                        </div>
                        <p className="text-slate-800 dark:text-slate-200 font-semibold">{problem.instruction}</p>
                      </div>
                    )}
                    {problem.question_body && (
                      <div>
                        <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500 mb-1">
                          {language === 'ko' ? '문제 본문' : 'Question'}
                        </div>
                        <p className="text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap">{problem.question_body}</p>
                      </div>
                    )}
                    {/* 분리 필드가 하나도 없을 때만 stem 폴백 표시 */}
                    {!problem.passage && !problem.instruction && !problem.question_body && !problem.visual_context && (
                      <p className="text-slate-700 dark:text-slate-300 font-medium whitespace-pre-wrap">{problem.문제내용.text}</p>
                    )}
                    {qType === 'multiple_choice' && problem.문제_보기 && problem.문제_보기.length > 0 && (
                      <div>
                        <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500 mb-1">
                          {language === 'ko' ? '보기' : 'Choices'}
                        </div>
                        <ol className="list-decimal list-inside text-sm text-slate-600 dark:text-slate-400 space-y-1">
                          {problem.문제_보기.map((choice, idx) => (
                            <li key={idx}>{choice.text}</li>
                          ))}
                        </ol>
                      </div>
                    )}
                    {qType === 'ox' && (
                      <p className="text-sm text-slate-500 dark:text-slate-400 italic">
                        {language === 'ko' ? 'O/X 판별 문제' : 'True/False question'}
                      </p>
                    )}
                    {(qType === 'essay' || qType === 'short_answer') && (!problem.문제_보기 || problem.문제_보기.length === 0) && (
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
      {lightboxImageUrl && (
        <ImageLightbox
          imageUrl={lightboxImageUrl}
          alt={language === 'ko' ? '문제 이미지' : 'Problem Image'}
          onClose={() => setLightboxImageUrl(null)}
        />
      )}
    </div>
  );
};
