import { useState, useCallback } from 'react';
import { supabase } from '../services/supabaseClient';
import { findTaxonomyByDepth } from '../services/db';
import type { StatsNode } from '../services/stats';

interface UseExampleGenerationParams {
  language: 'ko' | 'en';
  hierarchicalData: StatsNode[];
  selectedNodes: Set<string>;
  getLeafNodes: (nodes: StatsNode[]) => StatsNode[];
  getNodeKey: (node: StatsNode) => string;
  setError: (error: string | null) => void;
}

interface UseExampleGenerationReturn {
  isGeneratingExamples: boolean;
  exampleSentences: string[];
  showExampleModal: boolean;
  setShowExampleModal: (show: boolean) => void;
  handleGenerateExampleSentences: () => Promise<void>;
}

export function useExampleGeneration({
  language,
  hierarchicalData,
  selectedNodes,
  getLeafNodes,
  getNodeKey,
  setError,
}: UseExampleGenerationParams): UseExampleGenerationReturn {
  const [isGeneratingExamples, setIsGeneratingExamples] = useState(false);
  const [exampleSentences, setExampleSentences] = useState<string[]>([]);
  const [showExampleModal, setShowExampleModal] = useState(false);

  const handleGenerateExampleSentences = useCallback(async () => {
    if (selectedNodes.size === 0) {
      return;
    }

    try {
      setIsGeneratingExamples(true);

      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) {
        throw new Error(language === 'ko' ? '로그인이 필요합니다.' : 'Login required.');
      }

      // 선택된 노드들 중 최하위 depth만 필터링
      const allLeafNodes = getLeafNodes(hierarchicalData);
      const selectedLeafNodes = allLeafNodes.filter(node => {
        const key = getNodeKey(node);
        return selectedNodes.has(key);
      });

      if (selectedLeafNodes.length === 0) {
        setIsGeneratingExamples(false);
        return;
      }

      // 각 선택된 depth에 대해 예시 문장 생성
      const examplePromises = selectedLeafNodes.map(async (node) => {
        try {
          const taxonomy = await findTaxonomyByDepth(
            node.depth1 || '',
            node.depth2 || '',
            node.depth3 || '',
            node.depth4 || '',
            language
          );

          if (!taxonomy?.code) {
            return null;
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
              code: taxonomy.code,
              userId: userData.user.id,
              language: language
            })
          });

          if (!response.ok) {
            const errorText = await response.text();
            let errorData;
            try {
              errorData = JSON.parse(errorText);
            } catch {
              errorData = { error: errorText };
            }
            throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
          }

          const result = await response.json();
          
          if (!result.success) {
            console.error('Error from generate-example:', result.error || result.details);
            throw new Error(result.error || result.details || 'Failed to generate example');
          }
          
          if (result.success && result.example) {
            const example = result.example;
            // 필수 필드 확인
            if (!example.wrong_example && !example.correct_example) {
              console.warn('Example missing required fields:', example);
              return null;
            }
            return `❌ ${example.wrong_example || ''}\n✅ ${example.correct_example || ''}\n\n${example.explanation || ''}`;
          }
          
          return null;
        } catch (error) {
          console.error('Error generating example for node:', error);
          return null;
        }
      });

      const examples = (await Promise.all(examplePromises)).filter(Boolean) as string[];
      
      if (examples.length === 0) {
        setError(language === 'ko' 
          ? '예시 문장을 생성할 수 없습니다. 선택한 카테고리에 대한 taxonomy 정보가 없거나 AI 응답에 문제가 있을 수 있습니다.'
          : 'Unable to generate example sentences. The selected category may not have taxonomy information or there may be an issue with the AI response.');
        setIsGeneratingExamples(false);
        return;
      }
      
      setExampleSentences(examples);
      setShowExampleModal(true);
    } catch (e) {
      console.error('Error generating examples:', e);
      setError(e instanceof Error ? e.message : (language === 'ko' ? '예시 문장 생성 실패' : 'Failed to generate example sentences'));
    } finally {
      setIsGeneratingExamples(false);
    }
  }, [selectedNodes, hierarchicalData, getLeafNodes, getNodeKey, language, setError]);

  return {
    isGeneratingExamples,
    exampleSentences,
    showExampleModal,
    setShowExampleModal,
    handleGenerateExampleSentences,
  };
}

