import React, { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../../services/supabaseClient';
import { useProblemGeneration } from '../../hooks/useProblemGeneration';
import { ProblemGeneratorUI } from '../ProblemGeneratorUI';
import type { AIGenerationOptions } from '../../services/problemLoader';
import type { GeneratedProblem } from '../../types';

type ProblemType = 'multiple_choice' | 'short_answer' | 'essay' | 'ox';

interface Props {
  selectedIds: string[];
  onSelect: (ids: string[]) => void;
}

const DEFAULT_COUNTS = { multiple_choice: 5, short_answer: 0, essay: 0, ox: 0 };

export const ProblemSelector: React.FC<Props> = ({ selectedIds, onSelect }) => {
  const [problems, setProblems] = useState<GeneratedProblem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showGenerator, setShowGenerator] = useState(false);
  const [userId, setUserId] = useState('');
  const [problemCounts, setProblemCounts] = useState(DEFAULT_COUNTS);
  const [aiOptions, setAiOptions] = useState<AIGenerationOptions | undefined>(undefined);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const aiOptionsRef = useRef<AIGenerationOptions | undefined>(undefined);
  aiOptionsRef.current = aiOptions;

  // 현재 사용자 ID 획득
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) setUserId(data.user.id);
    });
  }, []);

  const load = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    const { data } = await supabase
      .from('generated_problems')
      .select('id, stem, choices, correct_answer_index, problem_type, classification, created_at')
      .eq('user_id', userId)
      .neq('stem', '__GENERATION_ERROR__')
      .neq('stem', '__TIMEOUT_ERROR__')
      .order('created_at', { ascending: false })
      .limit(50);
    setProblems((data || []) as GeneratedProblem[]);
    setLoading(false);
  }, [userId]);

  useEffect(() => { load(); }, [load]);

  const { isGenerating, handleGenerateProblems } = useProblemGeneration({
    userId,
    language: 'ko',
    problemCounts,
    classifications: [],
    aiOptions,
    onComplete: (newProblems: GeneratedProblem[]) => {
      // 목록 새로고침 후 새 문제 자동 선택
      load().then(() => {
        const newIds = newProblems.map((p) => p.id);
        onSelect([...new Set([...selectedIds, ...newIds])]);
      });
      setShowGenerator(false);
      setAiOptions(undefined);
      setGenerationError(null);
    },
    onError: (err: string) => setGenerationError(err),
  });

  const handleCountChange = useCallback((type: ProblemType, value: number) => {
    setProblemCounts((prev) => ({ ...prev, [type]: value }));
  }, []);

  const handleGenerateWithOptions = useCallback((options: AIGenerationOptions) => {
    setAiOptions(options);
    setTimeout(() => { handleGenerateProblems(); }, 100);
  }, [handleGenerateProblems]);

  const toggle = (id: string) => {
    onSelect(
      selectedIds.includes(id)
        ? selectedIds.filter((i) => i !== id)
        : [...selectedIds, id]
    );
  };

  const selectAll = () => {
    onSelect(selectedIds.length === problems.length ? [] : problems.map((p) => p.id));
  };

  if (loading) return <div className="text-center py-4 text-slate-500 text-sm">문제 불러오는 중...</div>;

  return (
    <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-5 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-bold text-slate-800 dark:text-slate-200">문제 선택 ({selectedIds.length}/{problems.length})</h3>
        <div className="flex items-center gap-3">
          <button
            onClick={() => { setShowGenerator((v) => !v); setGenerationError(null); }}
            className="text-xs px-3 py-1.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors"
          >
            {showGenerator ? '닫기' : 'AI로 새 문제 생성'}
          </button>
          <button onClick={selectAll} className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline">
            {selectedIds.length === problems.length ? '전체 해제' : '전체 선택'}
          </button>
        </div>
      </div>

      {showGenerator && (
        <ProblemGeneratorUI
          problemCounts={problemCounts}
          onCountChange={handleCountChange}
          onGenerate={handleGenerateProblems}
          onGenerateWithOptions={handleGenerateWithOptions}
          isGenerating={isGenerating}
          error={generationError}
          selectedNodesCount={0}
          language="ko"
          onClose={() => { setShowGenerator(false); setGenerationError(null); }}
        />
      )}

      {problems.length === 0 ? (
        <p className="text-slate-400 text-sm py-4 text-center">생성된 문제가 없습니다. AI로 문제를 생성해주세요.</p>
      ) : (
        <div className="max-h-60 overflow-y-auto space-y-1">
          {problems.map((p) => (
            <label key={p.id} className={`flex items-start gap-3 p-3 rounded-xl cursor-pointer transition-colors ${selectedIds.includes(p.id) ? 'bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-700' : 'hover:bg-slate-50 dark:hover:bg-slate-700/50'}`}>
              <input type="checkbox" checked={selectedIds.includes(p.id)} onChange={() => toggle(p.id)} className="mt-1 rounded border-slate-300" />
              <div className="flex-1 min-w-0">
                <p className="text-sm text-slate-800 dark:text-slate-200 line-clamp-2">{p.stem}</p>
                <span className="text-xs text-slate-500">{p.problem_type} · {new Date(p.created_at).toLocaleDateString('ko-KR')}</span>
              </div>
            </label>
          ))}
        </div>
      )}
    </div>
  );
};
