import { useState, useCallback } from 'react';
import { supabase } from '../services/supabaseClient';
import { fetchProblemsMetadataByCorrectness, type ProblemMetadataItem } from '../services/db';
import { getTranslation } from '../utils/translations';
import { translateError } from '../utils/errorI18n';
import type { StatsNode } from '../services/stats';

/** Edge generate-consulting로 보낼 오답 표본(절삭본). */
interface WrongSample {
  stem?: string;
  choices?: string[];
  user_answer?: string;
  correct_answer?: string;
  analysis?: string;
  classification?: string;
  problem_type?: string;
  difficulty?: string;
}

interface UseConsultingParams {
  language: 'ko' | 'en';
  hierarchicalData: StatsNode[];
  selectedNodes: Set<string>;
  getLeafNodes: (nodes: StatsNode[]) => StatsNode[];
  getNodeKey: (node: StatsNode) => string;
  overallTotals: { total: number; correct: number; incorrect: number };
  setError: (error: string | null) => void;
}

interface UseConsultingReturn {
  isConsulting: boolean;
  reportText: string;
  showConsultModal: boolean;
  setShowConsultModal: (show: boolean) => void;
  handleGenerateConsulting: () => Promise<void>;
}

const MAX_SAMPLES = 40;       // LLM 토큰·60s 제한 균형
const MAX_SELECTED_NODES = 12; // 선택 노드 과다 시 fetch 호출 상한

function nodeLabel(node: StatsNode): string {
  return [node.depth1, node.depth2, node.depth3, node.depth4].filter(Boolean).join(' > ');
}

function trunc(s: unknown, n: number): string {
  const x = String(s ?? '').trim();
  return x.length > n ? x.slice(0, n) + '…' : x;
}

function toSample(it: ProblemMetadataItem): WrongSample {
  const c = it.classification || {};
  const cls = [c.depth1, c.depth2, c.depth3, c.depth4].filter(Boolean).join(' > ');
  const rawChoices = it.content?.choices;
  const choices = Array.isArray(rawChoices)
    ? rawChoices
        .map((ch) => (typeof ch === 'string' ? ch : (ch?.text || ch?.label || '')))
        .filter(Boolean)
        .map((s) => trunc(s, 60))
    : undefined;
  return {
    stem: trunc(it.content?.stem, 220) || undefined,
    choices: choices && choices.length ? choices : undefined,
    user_answer: it.user_answer ?? undefined,
    correct_answer: it.correct_answer ?? undefined,
    analysis: trunc(it.metadata?.analysis, 220) || undefined,
    classification: cls || undefined,
    problem_type: it.metadata?.problem_type,
    difficulty: it.metadata?.difficulty ? String(it.metadata.difficulty) : undefined,
  };
}

export function useConsulting({
  language,
  hierarchicalData,
  selectedNodes,
  getLeafNodes,
  getNodeKey,
  overallTotals,
  setError,
}: UseConsultingParams): UseConsultingReturn {
  const [isConsulting, setIsConsulting] = useState(false);
  const [reportText, setReportText] = useState('');
  const [showConsultModal, setShowConsultModal] = useState(false);

  const handleGenerateConsulting = useCallback(async () => {
    try {
      setIsConsulting(true);
      setError(null);

      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) {
        throw new Error(language === 'ko' ? '로그인이 필요합니다.' : 'Login required.');
      }
      const userId = userData.user.id;

      // 범위 결정: 선택된 leaf 노드 있으면 해당 범위, 없으면 전체
      const allLeafNodes = getLeafNodes(hierarchicalData);
      const selectedLeafNodes = selectedNodes.size > 0
        ? allLeafNodes.filter((node) => selectedNodes.has(getNodeKey(node)))
        : [];

      let scopeLabel: string;
      let stats: { total: number; correct: number; incorrect: number };
      let byCategory: Array<{ label: string; total: number; correct: number; incorrect: number }>;
      let wrongItems: ProblemMetadataItem[] = [];

      if (selectedLeafNodes.length > 0) {
        // 선택 범위: handleNodeClick과 동일한 검증된 fetch 패턴을 노드별로 사용
        const nodes = selectedLeafNodes.slice(0, MAX_SELECTED_NODES);
        scopeLabel = nodes.map(nodeLabel).join(', ') + (selectedLeafNodes.length > MAX_SELECTED_NODES ? ' …' : '');
        byCategory = nodes.map((n) => ({
          label: nodeLabel(n),
          total: n.total_count || 0,
          correct: n.correct_count || 0,
          incorrect: n.incorrect_count || 0,
        }));
        stats = byCategory.reduce(
          (acc, r) => ({ total: acc.total + r.total, correct: acc.correct + r.correct, incorrect: acc.incorrect + r.incorrect }),
          { total: 0, correct: 0, incorrect: 0 }
        );
        const perNode = await Promise.all(nodes.map(async (n) => {
          const d1 = n.depth1 || undefined;
          const d2 = n.depth2 || undefined;
          const d3 = n.depth3 || undefined;
          const d4 = n.depth4 || undefined;
          const isUnclassified = !d2 && !d3 && !d4 && (d1 === '미분류' || d1 === 'Unclassified');
          try {
            return await fetchProblemsMetadataByCorrectness(
              isUnclassified ? undefined : d1,
              isUnclassified ? undefined : d2,
              isUnclassified ? undefined : d3,
              isUnclassified ? undefined : d4,
              false,
              isUnclassified
            );
          } catch (e) {
            console.error('Consulting fetch failed for node', nodeLabel(n), e);
            return [] as ProblemMetadataItem[];
          }
        }));
        wrongItems = perNode.flat();
      } else {
        // 전체 범위: 오답 라벨 전량 조회(1회) + depth1 상위 카테고리 집계
        scopeLabel = language === 'ko' ? '전체 카테고리' : 'All categories';
        stats = { ...overallTotals };
        byCategory = hierarchicalData
          .map((n) => ({
            label: n.depth1 || (language === 'ko' ? '미분류' : 'Unclassified'),
            total: n.total_count || 0,
            correct: n.correct_count || 0,
            incorrect: n.incorrect_count || 0,
          }))
          .filter((r) => r.total > 0)
          .sort((a, b) => (a.correct / (a.total || 1)) - (b.correct / (b.total || 1)));
        try {
          wrongItems = await fetchProblemsMetadataByCorrectness(undefined, undefined, undefined, undefined, false, false);
        } catch (e) {
          console.error('Consulting overall fetch failed', e);
          wrongItems = [];
        }
      }

      // 최근순 정렬은 fetch가 이미 수행. 여기선 상한만 적용(전체 범위는 이미 최근순).
      const wrongSamples = wrongItems.slice(0, MAX_SAMPLES).map(toSample);

      const functionUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-consulting`;
      const { data: { session } } = await supabase.auth.getSession();
      const response = await fetch(functionUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({ userId, language, scopeLabel, stats, byCategory, wrongSamples }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        let errorData: any;
        try { errorData = JSON.parse(errorText); } catch { errorData = { error: errorText }; }
        throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
      }

      const result = await response.json();
      if (!result.success || !result.report) {
        throw new Error(result.error || result.details || (language === 'ko' ? '보고서 생성에 실패했습니다.' : 'Failed to generate report.'));
      }

      setReportText(result.report);
      setShowConsultModal(true);
    } catch (e) {
      console.error('Error generating consulting report:', e);
      setError(translateError(e, language, getTranslation(language), language === 'ko' ? '학습 컨설팅 생성 실패' : 'Failed to generate consulting report'));
    } finally {
      setIsConsulting(false);
    }
  }, [language, hierarchicalData, selectedNodes, getLeafNodes, getNodeKey, overallTotals, setError]);

  return {
    isConsulting,
    reportText,
    showConsultModal,
    setShowConsultModal,
    handleGenerateConsulting,
  };
}
