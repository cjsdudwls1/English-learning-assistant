import React, { useMemo, useState, useEffect } from 'react';
import type { AnalysisResults, ProblemItem, ProblemClassification } from '../types';
import { ReportModal } from './ReportModal';
import { TaxonomyDetailPopup } from './TaxonomyDetailPopup';
import { supabase } from '../services/supabaseClient';
import { useLanguage } from '../contexts/LanguageContext';

/** 사용자 답안과 정답을 비교하여 자동 판정 */
function autoJudge(userAnswer: string, correctAnswer: string): '정답' | '오답' | null {
  const ua = userAnswer.trim().toLowerCase();
  const ca = correctAnswer.trim().toLowerCase();
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

  // 사용자 답안 및 정답 편집 상태 (QuickLabelingCard 패턴)
  const [editableAnswers, setEditableAnswers] = useState<Record<string, string>>({});
  const [editableCorrectAnswers, setEditableCorrectAnswers] = useState<Record<string, string>>({});

  // initial prop이 변경될 때 내부 state를 동기화
  useEffect(() => {
    setItems(initial.items);
    // 편집 상태도 초기화
    const initAnswers: Record<string, string> = {};
    const initCorrectAnswers: Record<string, string> = {};
    initial.items.forEach((p, idx) => {
      initAnswers[`${idx}`] = p.사용자가_기술한_정답?.text || '';
      initCorrectAnswers[`${idx}`] = p.correct_answer || '';
    });
    setEditableAnswers(initAnswers);
    setEditableCorrectAnswers(initCorrectAnswers);
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

  const handleSubmit = async () => {
    try {
      setSaving(true);
      setError(null);
      // 편집된 답안/정답을 items에 반영
      const updatedItems = items.map((item, idx) => ({
        ...item,
        사용자가_기술한_정답: {
          ...item.사용자가_기술한_정답,
          text: editableAnswers[`${idx}`] ?? item.사용자가_기술한_정답?.text ?? '',
        },
        correct_answer: editableCorrectAnswers[`${idx}`] ?? item.correct_answer ?? '',
      }));
      await onSubmit?.(updatedItems);
    } catch (e) {
      setError(e instanceof Error ? e.message : '저장 중 오류가 발생했습니다.');
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
    alert('신고가 접수되었습니다. 감사합니다.');
  };

  const handleGenerateExample = async (problemIndex: number) => {
    const problem = items[problemIndex];
    const classification = problem?.문제_유형_분류;
    const code = classification?.code;

    if (!code) {
      alert('분류 코드가 없습니다. 먼저 문제를 분류해주세요.');
      return;
    }

    try {
      setGeneratingExampleIndex(problemIndex);

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        throw new Error('로그인이 필요합니다.');
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
        throw new Error(`예시 문장 생성 실패: ${errorText}`);
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
        throw new Error('예시 문장 생성에 실패했습니다.');
      }
    } catch (error) {
      console.error('Error generating example:', error);
      alert(error instanceof Error ? error.message : '예시 문장 생성 중 오류가 발생했습니다.');
    } finally {
      setGeneratingExampleIndex(null);
    }
  };

  return (
    <div className="space-y-6">
      {items.map((it, i) => (
        <div key={i} className="border border-slate-200 dark:border-slate-700 rounded-lg p-3 sm:p-4 bg-white dark:bg-slate-800">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-bold text-slate-900 dark:text-white">문항 #{i + 1}</h3>
            </div>
            {!hideMarking && (
              <div className="flex gap-2">
                {marks.map(m => {
                  const isUserSelected = it.사용자가_직접_채점한_정오답 === m;
                  const isAISelected = it.AI가_판단한_정오답 === m;

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
                      {m}
                    </button>
                  );
                })}
                {!hideReport && (
                  <button
                    onClick={() => handleReportClick(i)}
                    className="px-3 py-2 text-sm bg-red-100 text-red-700 rounded hover:bg-red-200 transition-colors"
                    title="AI 분석이 잘못되었다고 생각되시나요?"
                  >
                    신고
                  </button>
                )}
              </div>
            )}
          </div>

          <div className="mt-3">
            <label className="text-sm text-slate-600 dark:text-slate-400">문제 본문</label>
            <div className="w-full border dark:border-slate-600 rounded px-3 py-2 mt-1 min-h-[100px] max-h-[40vh] sm:max-h-[300px] overflow-auto bg-slate-50 dark:bg-slate-900 text-slate-700 dark:text-slate-300">
              {it.문제내용.text}
              {it.문제_보기 && it.문제_보기.length > 0 && (
                <div className="mt-2 space-y-1">
                  {it.문제_보기.map((choice, idx) => (
                    <div key={idx} className="text-sm">
                      {idx + 1}차: {choice.text}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* 사용자 답안 + 정답 편집 영역 */}
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
                  // 사용자 답안 변경 시 자동 재판정
                  const correctAnswer = editableCorrectAnswers[`${i}`] ?? '';
                  const result = autoJudge(newValue, correctAnswer);
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
                  // 정답 변경 시 자동 재판정
                  const userAnswer = editableAnswers[`${i}`] ?? '';
                  const result = autoJudge(userAnswer, newValue);
                  if (result !== null) {
                    updateItem(i, { AI가_판단한_정오답: result });
                  }
                }}
                placeholder={language === 'ko' ? '정답 입력' : 'Enter correct answer'}
                className="flex-1 px-2 py-1 text-sm border border-slate-300 dark:border-slate-600 rounded bg-white dark:bg-slate-700 text-green-700 dark:text-green-400 font-medium focus:ring-1 focus:ring-green-500"
              />
            </div>
          </div>

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
                      title="분류 상세 정보 보기"
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
                {generatingExampleIndex === i ? '생성 중...' : '📝 예시 문장 생성'}
              </button>

              {exampleResults[i] && (
                <div className="mt-3 p-4 bg-slate-50 dark:bg-slate-900/50 rounded-lg border border-slate-200 dark:border-slate-700">
                  <h4 className="font-semibold text-slate-800 dark:text-slate-200 mb-2">예시 문장</h4>
                  {exampleResults[i].wrong_example && (
                    <div className="mb-2">
                      <span className="text-red-600 dark:text-red-400 font-medium">❌ 틀린 예시:</span>
                      <p className="text-slate-700 dark:text-slate-300 ml-2">{exampleResults[i].wrong_example}</p>
                    </div>
                  )}
                  {exampleResults[i].correct_example && (
                    <div className="mb-2">
                      <span className="text-green-600 dark:text-green-400 font-medium">✅ 맞는 예시:</span>
                      <p className="text-slate-700 dark:text-slate-300 ml-2">{exampleResults[i].correct_example}</p>
                    </div>
                  )}
                  {exampleResults[i].explanation && (
                    <div className="mt-2 text-sm text-slate-600 dark:text-slate-400">
                      <span className="font-medium">설명:</span> {exampleResults[i].explanation}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      ))}

      {error && <div className="p-3 bg-red-100 border text-red-800 rounded">{error}</div>}
      {!hideSubmit && (
        <div className="text-right">
          <button disabled={saving} onClick={handleSubmit} className="px-6 py-3 bg-indigo-600 text-white rounded-lg font-semibold disabled:bg-slate-400">
            {saving ? '저장 중...' : '저장'}
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


