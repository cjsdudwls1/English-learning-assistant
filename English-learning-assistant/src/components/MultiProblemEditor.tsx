import React, { useMemo, useState, useEffect } from 'react';
import type { AnalysisResults, ProblemItem, ProblemClassification } from '../types';
import { ReportModal } from './ReportModal';
import { TaxonomyDetailPopup } from './TaxonomyDetailPopup';
import { supabase } from '../services/supabaseClient';
import { useLanguage } from '../contexts/LanguageContext';
import { getTranslation } from '../utils/translations';
import { translateError } from '../utils/errorI18n';
import { getManualReviewReason, eqSet } from '../utils/gradingSafety';

/** 사용자 답안과 정답을 비교하여 자동 판정 */
/**
 * 채점 비교용 정규화 — 백엔드 computeIsCorrect(dbOperations.js)·QuickLabelingCard와 정합.
 * 대소문자·구두점(.,?!;:"/)·공백(한글 띄어쓰기 포함) 무시, 어포스트로피(')·하이픈(-)은 보존.
 */
function normalizeForCompare(s: string): string {
  return s
    .toLowerCase()
    .replace(/[.,?!;:"/]/g, '')
    .replace(/\s+/g, '');
}

function autoJudge(userAnswer: string, correctAnswer: string): '정답' | '오답' | null {
  const ua = normalizeForCompare(userAnswer);
  const ca = normalizeForCompare(correctAnswer);
  if (!ua || !ca) return null;
  return ua === ca ? '정답' : '오답';
}

interface MultiProblemEditorProps {
  initial: AnalysisResults;
  onChange?: (items: ProblemItem[]) => void;
  onSubmit?: (items: ProblemItem[]) => Promise<void>;
  hideMarking?: boolean;
  hideClassification?: boolean;
  hideReport?: boolean;
  hideSubmit?: boolean;
}

export const MultiProblemEditor: React.FC<MultiProblemEditorProps> = ({ initial, onChange, onSubmit, hideMarking, hideClassification, hideReport, hideSubmit }) => {
  const [items, setItems] = useState<ProblemItem[]>(initial.items);
  const { language } = useLanguage();
  const t = getTranslation(language);

  // 사용자 답안 및 정답 편집 상태 (QuickLabelingCard 패턴)
  const [editableAnswers, setEditableAnswers] = useState<Record<string, string>>({});
  const [editableCorrectAnswers, setEditableCorrectAnswers] = useState<Record<string, string>>({});
  // 다중정답 객관식(multi_answer_contract v1) — 정답/사용자답을 번호 집합으로 편집
  const [multiUserAnswers, setMultiUserAnswers] = useState<Record<string, number[]>>({});
  const [multiCorrectAnswers, setMultiCorrectAnswers] = useState<Record<string, number[]>>({});

  // initial prop이 변경될 때 내부 state를 동기화
  useEffect(() => {
    setItems(initial.items);
    // 편집 상태도 초기화
    const initAnswers: Record<string, string> = {};
    const initCorrectAnswers: Record<string, string> = {};
    const initMultiUser: Record<string, number[]> = {};
    const initMultiCorrect: Record<string, number[]> = {};
    initial.items.forEach((p, idx) => {
      initAnswers[`${idx}`] = p.사용자가_기술한_정답?.text || '';
      initCorrectAnswers[`${idx}`] = p.correct_answer || '';
      if (p.answerFormat === 'multi') {
        initMultiUser[`${idx}`] = p.userAnswers ?? [];
        initMultiCorrect[`${idx}`] = p.correctAnswers ?? [];
      }
    });
    setEditableAnswers(initAnswers);
    setEditableCorrectAnswers(initCorrectAnswers);
    setMultiUserAnswers(initMultiUser);
    setMultiCorrectAnswers(initMultiCorrect);
  }, [initial.items]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reportModalOpen, setReportModalOpen] = useState(false);
  const [reportingProblemIndex, setReportingProblemIndex] = useState<number | null>(null);
  const [taxonomyPopupOpen, setTaxonomyPopupOpen] = useState(false);
  const [selectedTaxonomyCode, setSelectedTaxonomyCode] = useState<string | null>(null);
  const [generatingExampleIndex, setGeneratingExampleIndex] = useState<number | null>(null);
  const [exampleResults, setExampleResults] = useState<Record<number, { wrong_example: string; correct_example: string; explanation: string }>>({});

  const marks = ['정답', '오답'];

  const updateItem = (idx: number, partial: Partial<ProblemItem>) => {
    setItems(prev => {
      const next = [...prev];
      next[idx] = { ...next[idx], ...partial } as ProblemItem;
      onChange?.(next);
      return next;
    });
  };

  const updateMark = (idx: number, mark: string) => {
    updateItem(idx, { 사용자가_직접_채점한_정오답: mark });
  };

  const updateClassification = (idx: number, partial: Partial<ProblemClassification>) => {
    const current = items[idx];
    updateItem(idx, { 문제_유형_분류: { ...current.문제_유형_분류, ...partial } as ProblemClassification });
  };

  // 다중정답 객관식 — 정답/사용자답 번호 칩 토글 + 집합 완전일치로 자동 재판정
  const handleMultiToggle = (idx: number, kind: 'user' | 'correct', num: number) => {
    const key = `${idx}`;
    const source = kind === 'user' ? multiUserAnswers : multiCorrectAnswers;
    const setSource = kind === 'user' ? setMultiUserAnswers : setMultiCorrectAnswers;
    const cur = new Set(source[key] ?? []);
    if (cur.has(num)) cur.delete(num); else cur.add(num);
    const nextArr = Array.from(cur).sort((a, b) => a - b);
    setSource(prev => ({ ...prev, [key]: nextArr }));

    const otherArr = kind === 'user' ? (multiCorrectAnswers[key] ?? []) : (multiUserAnswers[key] ?? []);
    const userArr = kind === 'user' ? nextArr : otherArr;
    const correctArr = kind === 'correct' ? nextArr : otherArr;
    // 양쪽 다 비어있지 않을 때만 자동 재판정(백엔드 computeIsCorrect 조건과 동일)
    if (userArr.length > 0 && correctArr.length > 0) {
      const result = eqSet(new Set(userArr), new Set(correctArr)) ? '정답' : '오답';
      updateItem(idx, { AI가_판단한_정오답: result });
    }
  };

  const handleSubmit = async () => {
    try {
      setSaving(true);
      setError(null);
      // 편집된 답안/정답을 items에 반영
      const updatedItems = items.map((item, idx) => {
        const isMulti = item.answerFormat === 'multi';
        const userArr = multiUserAnswers[`${idx}`] ?? item.userAnswers ?? [];
        const correctArr = multiCorrectAnswers[`${idx}`] ?? item.correctAnswers ?? [];
        return {
          ...item,
          사용자가_기술한_정답: {
            ...item.사용자가_기술한_정답,
            text: isMulti ? userArr.join(', ') : (editableAnswers[`${idx}`] ?? item.사용자가_기술한_정답?.text ?? ''),
          },
          correct_answer: isMulti ? correctArr.join(', ') : (editableCorrectAnswers[`${idx}`] ?? item.correct_answer ?? ''),
          userAnswers: isMulti ? userArr : item.userAnswers,
          correctAnswers: isMulti ? correctArr : item.correctAnswers,
        };
      });
      await onSubmit?.(updatedItems);
    } catch (e) {
      setError(translateError(e, language, t, t.errors.saveError));
    } finally {
      setSaving(false);
    }
  };

  const handleReportClick = (problemIndex: number) => {
    setReportingProblemIndex(problemIndex);
    setReportModalOpen(true);
  };

  const handleReportSubmit = (reason: string) => {
    console.log(`Problem ${reportingProblemIndex} reported:`, reason);
    // 실제 데이터 저장은 하지 않음 (개발용)
    alert(t.report.submitted);
  };

  const handleGenerateExample = async (problemIndex: number) => {
    const problem = items[problemIndex];
    const classification = problem?.문제_유형_분류;
    const code = classification?.code;

    if (!code) {
      alert(t.edit.noClassificationCode);
      return;
    }

    try {
      setGeneratingExampleIndex(problemIndex);

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        throw new Error(t.errors.loginRequired);
      }

      const functionUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-example`;
      const { data: { session } } = await supabase.auth.getSession();

      const response = await fetch(functionUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({
          code,
          userId: user.id,
          language,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(t.errors.generateExampleFailed.replace('{detail}', errorText));
      }

      const result = await response.json();

      if (result.success && result.example) {
        // result.example이 문자열이거나 객체일 수 있음
        let exampleData;
        if (typeof result.example === 'string') {
          try {
            exampleData = JSON.parse(result.example);
          } catch {
            // JSON이 아니면 그냥 텍스트로 처리
            exampleData = { wrong_example: '', correct_example: result.example, explanation: '' };
          }
        } else {
          exampleData = result.example;
        }

        setExampleResults(prev => ({
          ...prev,
          [problemIndex]: exampleData,
        }));
      } else {
        throw new Error(t.errors.generateExampleFailedGeneric);
      }
    } catch (error) {
      console.error('Error generating example:', error);
      alert(translateError(error, language, t, t.errors.generateExampleError));
    } finally {
      setGeneratingExampleIndex(null);
    }
  };

  return (
    <div className="space-y-6">
      {items.map((it, i) => {
        // 복수답안·형식불일치 감지(편집 중 값 반영) → AI 강조 숨기고 '수동 확인' 안내
        // multi는 correctAnswers/userAnswers가 확신 추출된 경우 null(자동채점 신뢰)
        const isMulti = it.answerFormat === 'multi';
        // 다중빈칸 서술형(multi_blank): 빈칸별 자유텍스트 N행 분리(읽기전용). 채점은 항상 기권.
        const isMultiBlank = it.answerFormat === 'multi_blank';
        const blankUser = it.blankUserAnswers ?? [];
        const blankCorrect = it.blankCorrectAnswers ?? [];
        const blankCount = Math.max(blankUser.length, blankCorrect.length);
        const currentCorrectAnswers = multiCorrectAnswers[`${i}`] ?? it.correctAnswers;
        const currentUserAnswers = multiUserAnswers[`${i}`] ?? it.userAnswers;
        const reviewReason = getManualReviewReason({
          instruction: it.instruction,
          correctAnswer: editableCorrectAnswers[`${i}`] ?? it.correct_answer,
          userAnswer: editableAnswers[`${i}`] ?? it.사용자가_기술한_정답?.text,
          hasChoices: (it.문제_보기?.length ?? 0) > 0,
          answerFormat: it.answerFormat,
          correctAnswers: currentCorrectAnswers,
          userAnswers: currentUserAnswers,
        });
        return (
        <div key={i} className="border border-slate-200 dark:border-slate-700 rounded-lg p-3 sm:p-4 bg-white dark:bg-slate-800">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-bold text-slate-900 dark:text-white">{t.edit.problemNumber.replace('{number}', String(i + 1))}</h3>
              {isMulti && !reviewReason && (
                <span className="mt-1 inline-block text-xs px-2 py-1 rounded bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-700">
                  {t.labeling.multiAnswerAuto}
                </span>
              )}
              {reviewReason && (
                <span
                  className="mt-1 inline-block text-xs px-2 py-1 rounded bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 border border-amber-300 dark:border-amber-700"
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
            </div>
            {!hideMarking && (
              <div className="flex gap-2">
                {marks.map(m => {
                  const isUserSelected = it.사용자가_직접_채점한_정오답 === m;
                  // 수동 확인 문항은 저장된 AI 판정을 강조하지 않음(confident-wrong 방지)
                  const isAISelected = !reviewReason && it.AI가_판단한_정오답 === m;

                  return (
                    <button
                      key={m}
                      type="button"
                      className={`px-4 py-2 rounded font-medium transition-colors ${isUserSelected
                        ? 'bg-blue-600 text-white'
                        : isAISelected
                          ? 'bg-gray-200 text-gray-700 hover:bg-gray-300 ring-2 ring-blue-500'
                          : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                        }`}
                      onClick={() => updateMark(i, m)}
                    >
                      {m === '정답' ? t.labeling.correct : t.labeling.incorrect}
                    </button>
                  );
                })}
                {!hideReport && (
                  <button
                    onClick={() => handleReportClick(i)}
                    className="px-3 py-2 text-sm bg-red-100 text-red-700 rounded hover:bg-red-200 transition-colors"
                    title={t.report.titleTooltip}
                  >
                    {t.report.report}
                  </button>
                )}
              </div>
            )}
          </div>

          <div className="mt-3">
            <label className="text-sm text-slate-600 dark:text-slate-400">{t.labeling.questionBody}</label>
            <div className="w-full border dark:border-slate-600 rounded px-3 py-2 mt-1 min-h-[100px] max-h-[40vh] sm:max-h-[300px] overflow-auto bg-slate-50 dark:bg-slate-900 text-slate-700 dark:text-slate-300">
              {it.문제내용.text}
              {it.문제_보기 && it.문제_보기.length > 0 && (
                <div className="mt-2 space-y-1">
                  {it.문제_보기.map((choice, idx) => (
                    <div key={idx} className="text-sm">
                      {t.edit.choiceNumber.replace('{number}', String(idx + 1)).replace('{text}', choice.text)}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* 사용자 답안 + 정답 편집 영역 */}
          {isMultiBlank ? (
            // 다중빈칸 서술형 — (1)(2)(3) 빈칸을 행별로 분리 표시(읽기전용). 자동 채점 대신 수동 확인.
            <div className="mt-3 space-y-2">
              <div className="text-sm text-slate-500 dark:text-slate-400">
                {language === 'ko' ? `빈칸 ${blankCount}개 (빈칸별 답안)` : `${blankCount} blanks (per-blank answers)`}
              </div>
              <div className="space-y-1.5">
                {Array.from({ length: blankCount }).map((_, bi) => {
                  const ua = blankUser[bi];
                  const ca = blankCorrect[bi];
                  const uaEmpty = ua == null || String(ua).trim() === '';
                  const uaText = uaEmpty ? (language === 'ko' ? '미작성' : 'blank') : String(ua);
                  return (
                    <div key={bi} className="flex items-start gap-2 text-sm">
                      <span className="mt-0.5 inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-slate-200 dark:bg-slate-700 px-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300 flex-shrink-0">
                        {bi + 1}
                      </span>
                      <div className="flex-1 min-w-0 space-y-0.5">
                        <div className="flex gap-1.5">
                          <span className="text-slate-500 dark:text-slate-400 whitespace-nowrap">{language === 'ko' ? '사용자:' : 'User:'}</span>
                          <span className={uaEmpty ? 'text-slate-400 dark:text-slate-500 italic' : 'text-slate-800 dark:text-slate-200 break-words'}>{uaText}</span>
                        </div>
                        <div className="flex gap-1.5">
                          <span className="text-slate-500 dark:text-slate-400 whitespace-nowrap">{language === 'ko' ? '정답:' : 'Answer:'}</span>
                          <span className="text-green-700 dark:text-green-400 font-medium break-words">{ca == null ? '—' : String(ca)}</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="text-xs text-amber-600 dark:text-amber-400">
                {language === 'ko' ? '※ 빈칸별 서술형 — 자동 채점 대신 수동 확인' : '※ Per-blank essay — manual review (no auto-grading)'}
              </div>
            </div>
          ) : isMulti ? (
            <div className="mt-3 space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm text-slate-500 dark:text-slate-400 whitespace-nowrap min-w-[70px]">
                  {t.labeling.multiUserPicks}
                </span>
                {it.문제_보기.map((_, idx) => {
                  const num = idx + 1;
                  const picked = (currentUserAnswers ?? []).includes(num);
                  const isWrongPick = picked && !(currentCorrectAnswers ?? []).includes(num);
                  return (
                    <button
                      key={num}
                      type="button"
                      onClick={() => handleMultiToggle(i, 'user', num)}
                      className={`w-8 h-8 rounded-full text-sm font-medium border transition-colors ${picked
                          ? (isWrongPick
                            ? 'bg-red-500 text-white border-red-500'
                            : 'bg-blue-500 text-white border-blue-500')
                          : 'bg-white dark:bg-slate-700 text-slate-600 dark:text-slate-300 border-slate-300 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-600'
                        }`}
                    >
                      {num}
                    </button>
                  );
                })}
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm text-slate-500 dark:text-slate-400 whitespace-nowrap min-w-[70px]">
                  {t.labeling.multiCorrectPicks}
                </span>
                {it.문제_보기.map((_, idx) => {
                  const num = idx + 1;
                  const picked = (currentCorrectAnswers ?? []).includes(num);
                  return (
                    <button
                      key={num}
                      type="button"
                      onClick={() => handleMultiToggle(i, 'correct', num)}
                      className={`w-8 h-8 rounded-full text-sm font-medium border transition-colors ${picked
                          ? 'bg-emerald-500 text-white border-emerald-500'
                          : 'bg-white dark:bg-slate-700 text-slate-600 dark:text-slate-300 border-slate-300 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-600'
                        }`}
                    >
                      {num}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="mt-3 space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-sm text-slate-500 dark:text-slate-400 whitespace-nowrap min-w-[70px]">
                  {language === 'ko' ? '사용자 답안:' : 'User answer:'}
                </span>
                <input
                  type="text"
                  value={editableAnswers[`${i}`] ?? ''}
                  onChange={(e) => {
                    const newValue = e.target.value;
                    setEditableAnswers(prev => ({ ...prev, [`${i}`]: newValue }));
                    // 사용자 답안 변경 시 자동 재판정 (복수답안·형식불일치면 스킵 — 수동 O/X만)
                    const correctAnswer = editableCorrectAnswers[`${i}`] ?? '';
                    const skip = getManualReviewReason({ instruction: it.instruction, correctAnswer, userAnswer: newValue, hasChoices: (it.문제_보기?.length ?? 0) > 0 }) !== null;
                    const result = skip ? null : autoJudge(newValue, correctAnswer);
                    if (result !== null) {
                      updateItem(i, { AI가_판단한_정오답: result });
                    }
                  }}
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
                  value={editableCorrectAnswers[`${i}`] ?? ''}
                  onChange={(e) => {
                    const newValue = e.target.value;
                    setEditableCorrectAnswers(prev => ({ ...prev, [`${i}`]: newValue }));
                    // 정답 변경 시 자동 재판정 (복수답안·형식불일치면 스킵 — 수동 O/X만)
                    const userAnswer = editableAnswers[`${i}`] ?? '';
                    const skip = getManualReviewReason({ instruction: it.instruction, correctAnswer: newValue, userAnswer, hasChoices: (it.문제_보기?.length ?? 0) > 0 }) !== null;
                    const result = skip ? null : autoJudge(userAnswer, newValue);
                    if (result !== null) {
                      updateItem(i, { AI가_판단한_정오답: result });
                    }
                  }}
                  placeholder={language === 'ko' ? '정답 입력' : 'Enter correct answer'}
                  className="flex-1 px-2 py-1 text-sm border border-slate-300 dark:border-slate-600 rounded bg-white dark:bg-slate-700 text-green-700 dark:text-green-400 font-medium focus:ring-1 focus:ring-green-500"
                />
              </div>
            </div>
          )}

          {/* 문제 유형 분류 */}
          {!hideClassification && (
            <div className="mt-3 grid grid-cols-1 md:grid-cols-4 gap-3">
              <div>
                <label className="block text-sm text-slate-600 dark:text-slate-400">depth1</label>
                <input className="w-full border dark:border-slate-600 rounded px-2 py-1 bg-white dark:bg-slate-700 text-slate-900 dark:text-white" value={it.문제_유형_분류.depth1 || ''}
                  onChange={(e) => updateClassification(i, { depth1: e.target.value })} />
              </div>
              <div>
                <label className="block text-sm text-slate-600 dark:text-slate-400">depth2</label>
                <input className="w-full border dark:border-slate-600 rounded px-2 py-1 bg-white dark:bg-slate-700 text-slate-900 dark:text-white" value={it.문제_유형_분류.depth2 || ''}
                  onChange={(e) => updateClassification(i, { depth2: e.target.value })} />
              </div>
              <div>
                <label className="block text-sm text-slate-600 dark:text-slate-400">depth3</label>
                <input className="w-full border dark:border-slate-600 rounded px-2 py-1 bg-white dark:bg-slate-700 text-slate-900 dark:text-white" value={it.문제_유형_분류.depth3 || ''}
                  onChange={(e) => updateClassification(i, { depth3: e.target.value })} />
              </div>
              <div>
                <label className="block text-sm text-slate-600 dark:text-slate-400 flex items-center gap-2">
                  depth4
                  {it.문제_유형_분류.depth4 && it.문제_유형_분류.code && (
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedTaxonomyCode(it.문제_유형_분류.code || null);
                        setTaxonomyPopupOpen(true);
                      }}
                      className="text-xs text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-300 font-normal"
                      title={t.taxonomy.classificationDetails}
                    >
                      ?
                    </button>
                  )}
                </label>
                <input className="w-full border dark:border-slate-600 rounded px-2 py-1 bg-white dark:bg-slate-700 text-slate-900 dark:text-white" value={it.문제_유형_분류.depth4 || ''}
                  onChange={(e) => updateClassification(i, { depth4: e.target.value })} />
              </div>
            </div>
          )}

          {/* 예시 문장 생성 버튼 및 결과 */}
          {!hideClassification && it.문제_유형_분류.code && (
            <div className="mt-3">
              <button
                type="button"
                onClick={() => handleGenerateExample(i)}
                disabled={generatingExampleIndex === i}
                className="px-4 py-2 bg-indigo-100 dark:bg-indigo-900/50 text-indigo-700 dark:text-indigo-300 rounded-lg hover:bg-indigo-200 dark:hover:bg-indigo-900/70 disabled:bg-slate-200 dark:disabled:bg-slate-700 disabled:cursor-not-allowed transition-colors text-sm font-medium"
              >
                {generatingExampleIndex === i ? t.example.generating : `📝 ${t.example.generate}`}
              </button>

              {exampleResults[i] && (
                <div className="mt-3 p-4 bg-slate-50 dark:bg-slate-900/50 rounded-lg border border-slate-200 dark:border-slate-700">
                  <h4 className="font-semibold text-slate-800 dark:text-slate-200 mb-2">{t.example.exampleSentence}</h4>
                  {exampleResults[i].wrong_example && (
                    <div className="mb-2">
                      <span className="text-red-600 dark:text-red-400 font-medium">❌ {t.example.wrongExample}:</span>
                      <p className="text-slate-700 dark:text-slate-300 ml-2">{exampleResults[i].wrong_example}</p>
                    </div>
                  )}
                  {exampleResults[i].correct_example && (
                    <div className="mb-2">
                      <span className="text-green-600 dark:text-green-400 font-medium">✅ {t.example.correctExample}:</span>
                      <p className="text-slate-700 dark:text-slate-300 ml-2">{exampleResults[i].correct_example}</p>
                    </div>
                  )}
                  {exampleResults[i].explanation && (
                    <div className="mt-2 text-sm text-slate-600 dark:text-slate-400">
                      <span className="font-medium">{t.example.explanation}:</span> {exampleResults[i].explanation}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
        );
      })}

      {error && <div className="p-3 bg-red-100 border text-red-800 rounded">{error}</div>}
      {!hideSubmit && (
        <div className="text-right">
          <button disabled={saving} onClick={handleSubmit} className="px-6 py-3 bg-indigo-600 text-white rounded-lg font-semibold disabled:bg-slate-400">
            {saving ? t.labeling.saving : t.common.save}
          </button>
        </div>
      )}

      {!hideReport && (
        <ReportModal
          isOpen={reportModalOpen}
          onClose={() => setReportModalOpen(false)}
          onSubmit={handleReportSubmit}
        />
      )}

      {taxonomyPopupOpen && (
        <TaxonomyDetailPopup
          code={selectedTaxonomyCode}
          onClose={() => {
            setTaxonomyPopupOpen(false);
            setSelectedTaxonomyCode(null);
          }}
        />
      )}
    </div>
  );
};


