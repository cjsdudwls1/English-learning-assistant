import React, { useMemo, useState, useEffect } from 'react';
import type { AnalysisResults, ProblemItem, ProblemClassification } from '../types';

interface MultiProblemEditorProps {
  initial: AnalysisResults;
  onChange?: (items: ProblemItem[]) => void;
  onSubmit?: (items: ProblemItem[]) => Promise<void>;
}

export const MultiProblemEditor: React.FC<MultiProblemEditorProps> = ({ initial, onChange, onSubmit }) => {
  const [items, setItems] = useState<ProblemItem[]>(initial.items);

  // initial prop이 변경될 때 내부 state를 동기화
  useEffect(() => {
    setItems(initial.items);
  }, [initial.items]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      await onSubmit?.(items);
    } catch (e) {
      setError(e instanceof Error ? e.message : '저장 중 오류가 발생했습니다.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      {items.map((it, i) => (
        <div key={i} className="border border-slate-200 rounded-lg p-4 bg-white">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-bold">문항 #{i + 1}</h3>
              {it.AI가_판단한_정오답 && (
                <span className={`text-sm px-2 py-1 rounded ${
                  it.AI가_판단한_정오답 === '정답' 
                    ? 'bg-green-100 text-green-700' 
                    : 'bg-red-100 text-red-700'
                }`}>
                  AI: {it.AI가_판단한_정오답}
                </span>
              )}
            </div>
            <div className="flex gap-2">
              {marks.map(m => (
                <button
                  key={m}
                  type="button"
                  className={`px-4 py-2 rounded font-medium transition-colors ${
                    it.사용자가_직접_채점한_정오답 === m
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                  }`}
                  onClick={() => updateMark(i, m)}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-3">
            <label className="text-sm text-slate-600">문제 본문</label>
            <div className="w-full border rounded px-3 py-2 mt-1 min-h-[100px] max-h-[300px] overflow-auto bg-slate-50 text-slate-700">
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

          <div className="mt-3 grid grid-cols-1 md:grid-cols-4 gap-3">
            <div>
              <label className="block text-sm text-slate-600">1Depth</label>
              <input className="w-full border rounded px-2 py-1" value={it.문제_유형_분류['1Depth']}
                onChange={(e) => updateClassification(i, { '1Depth': e.target.value })} />
            </div>
            <div>
              <label className="block text-sm text-slate-600">2Depth</label>
              <input className="w-full border rounded px-2 py-1" value={it.문제_유형_분류['2Depth']}
                onChange={(e) => updateClassification(i, { '2Depth': e.target.value })} />
            </div>
            <div>
              <label className="block text-sm text-slate-600">3Depth</label>
              <input className="w-full border rounded px-2 py-1" value={it.문제_유형_분류['3Depth']}
                onChange={(e) => updateClassification(i, { '3Depth': e.target.value })} />
            </div>
            <div>
              <label className="block text-sm text-slate-600">4Depth</label>
              <input className="w-full border rounded px-2 py-1" value={it.문제_유형_분류['4Depth']}
                onChange={(e) => updateClassification(i, { '4Depth': e.target.value })} />
            </div>
          </div>
        </div>
      ))}

      {error && <div className="p-3 bg-red-100 border text-red-800 rounded">{error}</div>}
      <div className="text-right">
        <button disabled={saving} onClick={handleSubmit} className="px-6 py-3 bg-indigo-600 text-white rounded-lg font-semibold disabled:bg-slate-400">
          {saving ? '저장 중...' : '저장'}
        </button>
      </div>
    </div>
  );
};


