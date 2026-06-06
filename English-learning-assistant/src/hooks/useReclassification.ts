import { useState, useCallback } from 'react';
import { supabase } from '../services/supabaseClient';
import { getTranslation } from '../utils/translations';
import { translateError } from '../utils/errorI18n';

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
    const t = getTranslation(language);
    if (!confirm(t.stats.reclassifyConfirm)) {
      return;
    }

    try {
      setIsReclassifying(true);
      setReclassificationStatus(t.stats.reclassifyStarting);
      setError(null);

      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) {
        setError(t.errors.loginRequired);
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
          t.stats.reclassifyResult
            .replace('{processed}', String(result.processed || 0))
            .replace('{total}', String(result.total || 0))
            .replace('{successCount}', String(result.successCount || 0))
            .replace('{failCount}', String(result.failCount || 0))
        );

        // 3초 후 자동 새로고침
        setTimeout(() => {
          loadData(true);
          setReclassificationStatus(null);
        }, 3000);
      } else {
        throw new Error(result.error || t.stats.reclassifyFailed);
      }
    } catch (error) {
      console.error('Error reclassifying problems:', error);
      setError(translateError(error, language, t, t.stats.reclassifyError));
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

