/**
 * 학습 컨설팅 — 에이전트 경로 + 단발 폴백
 *
 * 예전엔 프론트가 오답 상위 40개를 잘라 보내고 Edge Function이 한 번에 보고서를 썼다.
 * 무엇을 잘라냈는지는 아무도 몰랐고, 잘린 쪽에 진짜 약점이 있어도 방법이 없었다.
 *
 * 지금은 **전역 통계만 넘기고 어디를 더 팔지는 에이전트가 정한다**. 표본 절단이 사라진 대신
 * 지연이 늘어, 진행 상황은 AgentTrace가 실시간으로 보여준다.
 *
 * 전역 숫자를 서버에서 다시 계산하지 않는 건 의도다 — 화면의 숫자와 보고서의 숫자가
 * 갈라지는 순간 둘 다 못 믿게 된다. 에이전트 도구는 드릴다운·표적 표본·추세만 조회한다.
 *
 * 폴백은 안전망이다. BYOK 어댑터·GCF 배포·Realtime 어디가 깨져도 기존 단발 경로로 떨어져
 * 사용자는 여전히 보고서를 받는다(대신 그 사실을 화면에 알린다).
 */
import { useState, useCallback } from 'react';
import { supabase } from '../services/supabaseClient';
import { fetchProblemsMetadataByCorrectness, saveConsultingReport, type ProblemMetadataItem } from '../services/db';
import { getTranslation } from '../utils/translations';
import { translateError } from '../utils/errorI18n';
import type { StatsNode } from '../services/stats';
import { useAgentRun, type AgentRunState } from './useAgentRun';
import type { AgentStepRow, AgentStopReason } from '../services/db';
import { buildAgentScope, nodeLabel, type AgentScope as Scope, type Totals } from './agentScope';

/** Edge generate-consulting로 보낼 오답 표본(절삭본). 폴백 경로에서만 쓴다. */
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

/** consultant 에이전트의 final 스키마. */
interface ConsultantResult {
  report: string;
  weakNodes: Array<{ path?: string; accuracy?: number; evidence?: string }>;
}

interface UseConsultingParams {
  language: 'ko' | 'en';
  hierarchicalData: StatsNode[];
  selectedNodes: Set<string>;
  getLeafNodes: (nodes: StatsNode[]) => StatsNode[];
  getNodeKey: (node: StatsNode) => string;
  overallTotals: Totals;
  setError: (error: string | null) => void;
}

interface UseConsultingReturn {
  isConsulting: boolean;
  reportText: string;
  showConsultModal: boolean;
  setShowConsultModal: (show: boolean) => void;
  handleGenerateConsulting: () => Promise<void>;
  // 진행 상황(AgentTrace)
  agentState: AgentRunState;
  agentSteps: AgentStepRow[];
  agentStopReason: AgentStopReason | null;
  agentError: string | null;
  /** 에이전트가 실패해 단발 경로로 떨어졌음 — 결과는 나오되 근거 추적은 없다. */
  usedFallback: boolean;
}

const MAX_SAMPLES = 40; // 폴백 전용: LLM 토큰·Edge 60s 제한 균형

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
  const [usedFallback, setUsedFallback] = useState(false);

  const agent = useAgentRun<ConsultantResult>({ language });
  // 훅 반환 객체는 매 렌더 새로 만들어진다. 콜백 의존성엔 useCallback으로 고정된 함수만 넣는다.
  const { start: startAgent, reset: resetAgent } = agent;

  /** 범위·통계 계산. 두 경로(에이전트/폴백)와 플래너가 **같은 숫자**를 쓰게 하려고 공용 모듈에 있다. */
  const buildScope = useCallback((): Scope => buildAgentScope({
    language, hierarchicalData, selectedNodes, getLeafNodes, getNodeKey, overallTotals,
  }), [hierarchicalData, selectedNodes, getLeafNodes, getNodeKey, overallTotals, language]);

  /** 폴백: 기존 단발 Edge Function 경로 그대로. 오답 표본을 여기서만 긁는다. */
  const runFallback = useCallback(async (scope: Scope, userId: string): Promise<string> => {
    let wrongItems: ProblemMetadataItem[] = [];

    if (scope.nodes.length > 0) {
      const perNode = await Promise.all(scope.nodes.map(async (n) => {
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
      try {
        wrongItems = await fetchProblemsMetadataByCorrectness(undefined, undefined, undefined, undefined, false, false);
      } catch (e) {
        console.error('Consulting overall fetch failed', e);
        wrongItems = [];
      }
    }

    // fetch가 이미 최근순. 여기선 상한만 적용한다(이 절단이 에이전트 경로엔 없다).
    const wrongSamples = wrongItems.slice(0, MAX_SAMPLES).map(toSample);

    const functionUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-consulting`;
    const { data: { session } } = await supabase.auth.getSession();
    const response = await fetch(functionUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session?.access_token}`,
      },
      body: JSON.stringify({
        userId,
        language,
        scopeLabel: scope.scopeLabel,
        stats: scope.stats,
        byCategory: scope.byCategory,
        wrongSamples,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      let errorData: any;
      try { errorData = JSON.parse(errorText); } catch { errorData = { error: errorText }; }
      throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
    }

    const result = await response.json();
    if (!result.success || !result.report) {
      throw new Error(result.error || result.details
        || (language === 'ko' ? '보고서 생성에 실패했습니다.' : 'Failed to generate report.'));
    }
    return result.report as string;
  }, [language]);

  const handleGenerateConsulting = useCallback(async () => {
    try {
      setIsConsulting(true);
      setError(null);
      setUsedFallback(false);
      resetAgent();

      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) {
        throw new Error(language === 'ko' ? '로그인이 필요합니다.' : 'Login required.');
      }
      const userId = userData.user.id;

      const scope = buildScope();

      let report: string;
      let agentRunId: string | null = null;

      try {
        const outcome = await startAgent('consultant', {
          language,
          scopeLabel: scope.scopeLabel,
          stats: scope.stats,
          byCategory: scope.byCategory,
        });
        report = outcome.result.report;
        agentRunId = outcome.runId;
      } catch (agentErr) {
        // 에이전트가 죽어도 사용자는 보고서를 받아야 한다. 대신 어느 경로였는지는 숨기지 않는다.
        console.error('에이전트 컨설팅 실패 → 단발 경로로 폴백:', agentErr);
        setUsedFallback(true);
        report = await runFallback(scope, userId);
      }

      setReportText(report);
      setShowConsultModal(true);

      // 히스토리 저장 (실패해도 보고서 표시엔 영향 없음)
      try {
        await saveConsultingReport({
          scopeLabel: scope.scopeLabel,
          language,
          report,
          stats: scope.stats,
          agentRunId,
        });
      } catch (saveErr) {
        console.error('컨설팅 보고서 저장 실패(무시):', saveErr);
      }
    } catch (e) {
      console.error('Error generating consulting report:', e);
      setError(translateError(e, language, getTranslation(language), language === 'ko' ? '학습 컨설팅 생성 실패' : 'Failed to generate consulting report'));
    } finally {
      setIsConsulting(false);
    }
  }, [language, buildScope, runFallback, startAgent, resetAgent, setError]);

  return {
    isConsulting,
    reportText,
    showConsultModal,
    setShowConsultModal,
    handleGenerateConsulting,
    agentState: agent.state,
    agentSteps: agent.steps,
    agentStopReason: agent.stopReason,
    agentError: agent.error,
    usedFallback,
  };
}
