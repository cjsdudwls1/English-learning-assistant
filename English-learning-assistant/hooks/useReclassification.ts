import { useState, useCallback } from 'react';
import { supabase } from '../services/supabaseClient';

interface UseReclassificationParams {
  language: 'ko' | 'en';
  loadData: (showLoading?: boolean) => Promise<void>;
  setError: (error: string | null) => void;
}

interface UseReclassificationReturn {
  isReclassifying: boolean;
  reclassificationStatus: string | null;
  handleReclassifyAll: () => Promise<void>;
}

export function useReclassification({
  language,
  loadData,
  setError,
}: UseReclassificationParams): UseReclassificationReturn {
  const [isReclassifying, setIsReclassifying] = useState(false);
  const [reclassificationStatus, setReclassificationStatus] = useState<string | null>(null);

  const handleReclassifyAll = useCallback(async () => {
    if (!confirm('전체 문제를 새로운 분류 체계로 재분류하시겠습니까?\n이 작업은 시간이 걸릴 수 있으며, 백그라운드에서 진행됩니다.')) {
      return;
    }

    try {
      setIsReclassifying(true);
      setReclassificationStatus('재분류 작업을 시작합니다...');
      setError(null);

      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) {
        setError('로그인이 필요합니다.');
        return;
      }

      const functionUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/reclassify-problems`;
      const { data: { session } } = await supabase.auth.getSession();
      
      const response = await fetch(functionUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({
          userId: userData.user.id,
          batchSize: 100, // 배치 크기
          language: language
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP error! status: ${response.status}, ${errorText}`);
      }

      const result = await response.json();
      
      if (result.success) {
        setReclassificationStatus(
          `재분류 작업이 시작되었습니다. 처리된 문제: ${result.processed || 0}개 / 전체: ${result.total || 0}개. ` +
          `성공: ${result.successCount || 0}개, 실패: ${result.failCount || 0}개. ` +
          `새로고침하여 최신 통계를 확인하세요.`
        );
        
        // 3초 후 자동 새로고침
        setTimeout(() => {
          loadData(true);
          setReclassificationStatus(null);
        }, 3000);
      } else {
        throw new Error(result.error || '재분류 작업에 실패했습니다.');
      }
    } catch (error) {
      console.error('Error reclassifying problems:', error);
      setError(error instanceof Error ? error.message : '재분류 중 오류가 발생했습니다.');
      setReclassificationStatus(null);
    } finally {
      setIsReclassifying(false);
    }
  }, [language, loadData, setError]);

  return {
    isReclassifying,
    reclassificationStatus,
    handleReclassifyAll,
  };
}

