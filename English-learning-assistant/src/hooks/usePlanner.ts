/**
 * 맞춤 학습플랜 — 플래너 에이전트 실행
 *
 * 컨설턴트와 겉모습은 같지만 성격이 다르다. 컨설턴트는 읽기만 하므로 실패해도 단발 Edge
 * 경로로 떨어지면 그만이다. **플래너에는 폴백이 없다** — 단발로 대신할 경로가 애초에 없고,
 * 있는 척 만들면 "문제를 모아 준다"는 약속만 지키지 못한 결과가 나온다. 실패는 실패로 알린다.
 *
 * 범위·통계는 컨설턴트와 **같은 buildAgentScope**를 쓴다. 두 기능이 서로 다른 숫자를 보면
 * 사용자에겐 앱이 자기 데이터를 모르는 것으로 보인다.
 *
 * 이 훅은 과제를 배포하지 않는다. assignmentDraft는 화면에 초안으로만 보여주고, 실제
 * shared_assignments 생성은 기존 과제 화면에서 사용자가 직접 한다(에세이 채점의
 * "AI 판정은 제안일 뿐" 선례와 같다).
 */
import { useCallback, useState } from 'react';
import { supabase } from '../services/supabaseClient';
import { fetchGeneratedProblemsByIds } from '../services/db/generatedProblems';
import { getTranslation } from '../utils/translations';
import { translateError } from '../utils/errorI18n';
import type { GeneratedProblem } from '../types';
import type { StatsNode } from '../services/stats';
import type { AgentStepRow, AgentStopReason } from '../services/db';
import { useAgentRun, type AgentRunState } from './useAgentRun';
import { buildAgentScope, type Totals } from './agentScope';

/** planner 에이전트의 final 스키마 (shared/agent/agents/planner.js normalizePlan과 짝) */
export interface PlanDay {
  day: number;
  focus: string;
  nodePath: string;
  activity: string;
  problemIds: string[];
}

export interface PlannerResult {
  summary: string;
  weeklyPlan: PlanDay[];
  problemIds: string[];
  /** 이번 런에서 **새로 만든** 문항 수. 예산 카운터가 원본이라 모델이 부풀릴 수 없다. */
  generatedCount: number;
  createdProblemIds: string[];
  assignmentDraft: { title: string; description: string } | null;
}

interface UsePlannerParams {
  language: 'ko' | 'en';
  hierarchicalData: StatsNode[];
  selectedNodes: Set<string>;
  getLeafNodes: (nodes: StatsNode[]) => StatsNode[];
  getNodeKey: (node: StatsNode) => string;
  overallTotals: Totals;
  setError: (error: string | null) => void;
  /** 계획의 문제를 시험지로 띄운다. 기존 생성 문제 UI를 그대로 재사용한다. */
  onOpenProblems: (problems: GeneratedProblem[]) => void;
}

interface UsePlannerReturn {
  isPlanning: boolean;
  plan: PlannerResult | null;
  /** 계획을 만들 때의 범위. 나중에 선택을 바꿔도 결과 화면의 라벨은 그대로여야 한다. */
  planScopeLabel: string;
  showPlanModal: boolean;
  setShowPlanModal: (show: boolean) => void;
  handleGeneratePlan: () => Promise<void>;
  /** 계획 전체 또는 하루치를 시험지로 연다. 없는 id는 빠지고 그 수를 돌려준다. */
  openPlanProblems: (problemIds: string[]) => Promise<number>;
  agentState: AgentRunState;
  agentSteps: AgentStepRow[];
  agentStopReason: AgentStopReason | null;
  agentError: string | null;
}

/** 계획 기간. 서버가 1~14로 다시 조이므로 여기 값은 기본값일 뿐이다. */
const PLAN_DAYS = 7;

export function usePlanner({
  language,
  hierarchicalData,
  selectedNodes,
  getLeafNodes,
  getNodeKey,
  overallTotals,
  setError,
  onOpenProblems,
}: UsePlannerParams): UsePlannerReturn {
  const [isPlanning, setIsPlanning] = useState(false);
  const [plan, setPlan] = useState<PlannerResult | null>(null);
  const [planScopeLabel, setPlanScopeLabel] = useState('');
  const [showPlanModal, setShowPlanModal] = useState(false);

  const agent = useAgentRun<PlannerResult>({ language });
  // 훅 반환 객체는 매 렌더 새로 만들어진다. 의존성엔 useCallback으로 고정된 함수만 넣는다.
  const { start: startAgent, reset: resetAgent } = agent;

  const handleGeneratePlan = useCallback(async () => {
    try {
      setIsPlanning(true);
      setError(null);
      setPlan(null);
      resetAgent();

      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) {
        throw new Error(language === 'ko' ? '로그인이 필요합니다.' : 'Login required.');
      }

      const scope = buildAgentScope({
        language, hierarchicalData, selectedNodes, getLeafNodes, getNodeKey, overallTotals,
      });
      setPlanScopeLabel(scope.scopeLabel);

      const outcome = await startAgent('planner', {
        language,
        scopeLabel: scope.scopeLabel,
        stats: scope.stats,
        byCategory: scope.byCategory,
        days: PLAN_DAYS,
      });

      setPlan(outcome.result);
      setShowPlanModal(true);
    } catch (e) {
      console.error('Error generating study plan:', e);
      setError(translateError(
        e, language, getTranslation(language),
        language === 'ko' ? '학습 플랜 생성 실패' : 'Failed to generate the study plan',
      ));
    } finally {
      setIsPlanning(false);
    }
  }, [language, hierarchicalData, selectedNodes, getLeafNodes, getNodeKey, overallTotals,
    startAgent, resetAgent, setError]);

  const openPlanProblems = useCallback(async (problemIds: string[]): Promise<number> => {
    try {
      const problems = await fetchGeneratedProblemsByIds(problemIds);
      if (problems.length === 0) {
        setError(language === 'ko'
          ? '계획에 담긴 문제를 불러오지 못했습니다.'
          : 'Could not load the problems in this plan.');
        return 0;
      }
      onOpenProblems(problems);
      setShowPlanModal(false);
      return problems.length;
    } catch (e) {
      console.error('Error loading plan problems:', e);
      setError(translateError(
        e, language, getTranslation(language),
        language === 'ko' ? '계획 문제 불러오기 실패' : 'Failed to load the plan problems',
      ));
      return 0;
    }
  }, [language, onOpenProblems, setError]);

  return {
    isPlanning,
    plan,
    planScopeLabel,
    showPlanModal,
    setShowPlanModal,
    handleGeneratePlan,
    openPlanProblems,
    agentState: agent.state,
    agentSteps: agent.steps,
    agentStopReason: agent.stopReason,
    agentError: agent.error,
  };
}
