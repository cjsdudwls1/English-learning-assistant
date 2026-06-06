import { useState, useRef, useEffect, useCallback } from 'react';
import { supabase } from '../services/supabaseClient';
import { getTranslation } from '../utils/translations';
import { translateError } from '../utils/errorI18n';
import type { GeneratedProblem, RealtimeSubscription } from '../types';
import type { AIGenerationOptions } from '../services/problemLoader';

type ProblemType = 'multiple_choice' | 'short_answer' | 'essay' | 'ox';

interface ProblemCount {
  multiple_choice: number;
  short_answer: number;
  essay: number;
  ox: number;
}

interface Classification {
  depth1: string;
  depth2?: string;
  depth3?: string;
  depth4?: string;
}

interface UseProblemGenerationParams {
  userId: string;
  language: 'ko' | 'en';
  problemCounts: ProblemCount;
  classifications: Classification[];
  onComplete: (problems: GeneratedProblem[]) => void;
  onError: (error: string) => void;
  aiOptions?: AIGenerationOptions;
}

interface UseProblemGenerationReturn {
  isGenerating: boolean;
  generatedProblems: GeneratedProblem[];
  error: string | null;
  handleGenerateProblems: () => Promise<void>;
  reset: () => void;
}

export function useProblemGeneration({
  userId,
  language,
  problemCounts,
  classifications,
  onComplete,
  onError,
  aiOptions,
}: UseProblemGenerationParams): UseProblemGenerationReturn {
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedProblems, setGeneratedProblems] = useState<GeneratedProblem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [realtimeSubscription, setRealtimeSubscription] = useState<RealtimeSubscription | null>(null);
  const [expectedProblemCounts, setExpectedProblemCounts] = useState<{ [key: string]: number }>({});
  const [receivedProblems, setReceivedProblems] = useState<GeneratedProblem[]>([]);

  const generationStartTimeRef = useRef<number | null>(null);
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const pollingActiveRef = useRef<boolean>(false);
  const receivedProblemsCountRef = useRef<number>(0);
  const expectedProblemCountsRef = useRef<{ [key: string]: number }>({});
  // aiOptions의 최신 값을 항상 참조하기 위한 ref (클로저 stale 문제 방지)
  const aiOptionsRef = useRef(aiOptions);
  aiOptionsRef.current = aiOptions;

  // expectedProblemCounts가 변경될 때마다 ref 업데이트
  useEffect(() => {
    expectedProblemCountsRef.current = expectedProblemCounts;
  }, [expectedProblemCounts]);

  // 에러 설정 헬퍼
  const setErrorAndNotify = useCallback((errorMessage: string) => {
    setError(errorMessage);
    onError(errorMessage);
  }, [onError]);

  // 문제 정렬 헬퍼
  const sortProblems = useCallback((problems: GeneratedProblem[]): GeneratedProblem[] => {
    return problems.sort((a, b) => {
      const typeOrder: { [key: string]: number } = {
        multiple_choice: 0,
        short_answer: 1,
        essay: 2,
        ox: 3,
      };
      return (typeOrder[a.problem_type] || 99) - (typeOrder[b.problem_type] || 99);
    });
  }, []);

  // 생성 완료 처리
  const handleGenerationComplete = useCallback((problems: GeneratedProblem[]) => {
    const sortedProblems = sortProblems(problems);
    setGeneratedProblems(sortedProblems);
    setIsGenerating(false);
    setExpectedProblemCounts({});
    setReceivedProblems([]);
    receivedProblemsCountRef.current = 0;
    generationStartTimeRef.current = null;

    // 폴링 중단
    pollingActiveRef.current = false;
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }

    // Realtime 구독 정리
    if (realtimeSubscription) {
      supabase.removeChannel(realtimeSubscription);
      setRealtimeSubscription(null);
    }

    onComplete(sortedProblems);
  }, [sortProblems, realtimeSubscription, onComplete]);

  // Realtime 구독 정리
  useEffect(() => {
    return () => {
      if (realtimeSubscription) {
        supabase.removeChannel(realtimeSubscription);
      }
    };
  }, [realtimeSubscription]);

  // 문제 생성 타임아웃 및 폴링 처리 (Realtime 실패 시 폴백)
  useEffect(() => {
    if (!isGenerating) {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
      pollingActiveRef.current = false;
      return;
    }

    // totalExpected 계산 (의존성 배열에서 객체 제거)
    const totalExpected = Object.values(expectedProblemCounts).reduce((sum, count) => sum + count, 0);
    if (totalExpected === 0) return;

    // 10초 후 예상된 문제 수를 받지 못하면 폴링 시작 (Realtime 실패 시 폴백)
    const pollingTimeout = setTimeout(async () => {
      if (receivedProblemsCountRef.current >= totalExpected || !isGenerating) {
        console.log('[Polling] Skipping polling - problems already received or generation stopped');
        return;
      }

      // Realtime으로 일부 문제를 받았어도, 예상된 수에 못 미치면 폴링 시작
      if (receivedProblems.length < totalExpected && realtimeSubscription) {
        console.warn(`[Polling] Only received ${receivedProblems.length}/${totalExpected} problems via Realtime after 10 seconds - switching to polling mode`);

        const startPolling = async () => {
          const startTime = generationStartTimeRef.current || Date.now();
          pollingActiveRef.current = true;

          pollIntervalRef.current = setInterval(async () => {
            if (!pollingActiveRef.current || !isGenerating) {
              if (pollIntervalRef.current) {
                clearInterval(pollIntervalRef.current);
                pollIntervalRef.current = null;
              }
              return;
            }

            // ref를 사용하여 최신 expectedProblemCounts 값 가져오기
            const currentTotalExpected = Object.values(expectedProblemCountsRef.current).reduce((sum, count) => sum + count, 0);
            if (receivedProblemsCountRef.current >= currentTotalExpected) {
              console.log(`[Polling] All ${currentTotalExpected} problems already received (ref: ${receivedProblemsCountRef.current}) - stopping polling`);
              pollingActiveRef.current = false;
              if (pollIntervalRef.current) {
                clearInterval(pollIntervalRef.current);
                pollIntervalRef.current = null;
              }
              return;
            }

            try {
              // 생성 시작 시간보다 약간 이전부터 조회 (Edge Function이 백그라운드에서 실행되므로)
              const queryStartTime = new Date(startTime - 2000).toISOString();
              const { data: problems, error: pollError } = await supabase
                .from('generated_problems')
                .select('id, stem, choices, correct_answer_index, problem_type, classification, correct_answer, guidelines, is_correct, explanation, is_editable, created_at')
                .eq('user_id', userId)
                .gte('created_at', queryStartTime)
                .order('created_at', { ascending: true });

              if (pollError) {
                console.error('[Polling] Error:', pollError);
                return;
              }

              if (problems && problems.length > 0) {
                const errorMarker = problems.find(p => p.stem === '__GENERATION_ERROR__' || p.stem === '__TIMEOUT_ERROR__');
                if (errorMarker) {
                  pollingActiveRef.current = false;
                  if (pollIntervalRef.current) {
                    clearInterval(pollIntervalRef.current);
                    pollIntervalRef.current = null;
                  }
                  if (realtimeSubscription) {
                    supabase.removeChannel(realtimeSubscription);
                    setRealtimeSubscription(null);
                  }
                  setIsGenerating(false);
                  const errorMessage = errorMarker.explanation || (language === 'ko' ? '문제 생성 중 오류가 발생했습니다.' : 'An error occurred while generating problems.');
                  setErrorAndNotify(errorMessage);
                  generationStartTimeRef.current = null;
                  return;
                }

                const validProblems = problems.filter(p => p.stem !== '__GENERATION_ERROR__' && p.stem !== '__TIMEOUT_ERROR__') as GeneratedProblem[];

                if (validProblems.length > 0) {
                  setReceivedProblems((prev) => {
                    // ref를 사용하여 최신 expectedProblemCounts 값 가져오기
                    const currentTotalExpected = Object.values(expectedProblemCountsRef.current).reduce((sum, count) => sum + count, 0);
                    if (prev.length >= currentTotalExpected) {
                      pollingActiveRef.current = false;
                      receivedProblemsCountRef.current = prev.length;
                      if (pollIntervalRef.current) {
                        clearInterval(pollIntervalRef.current);
                        pollIntervalRef.current = null;
                      }
                      console.log('[Polling] All problems already received - stopping polling');
                      return prev;
                    }

                    // 중복 제거 (Set 사용으로 Realtime과 폴링 동시 작동 시 경쟁 조건 방지)
                    const existingIds = new Set(prev.map(p => p.id));
                    const newProblems = validProblems.filter(p => !existingIds.has(p.id));

                    if (newProblems.length === 0) {
                      return prev;
                    }

                    console.log(`[Polling] Adding ${newProblems.length} new problems (${validProblems.length - newProblems.length} duplicates filtered)`);

                    const allProblems = [...prev, ...newProblems];
                    receivedProblemsCountRef.current = allProblems.length;

                    if (allProblems.length >= currentTotalExpected) {
                      handleGenerationComplete(allProblems);
                      return allProblems;
                    }

                    return allProblems;
                  });
                }
              }
            } catch (pollError) {
              console.error('[Polling] Error:', pollError);
            }
          }, 2000);
        };

        startPolling();
      }
    }, 10 * 1000);

    const finalTimeout = setTimeout(() => {
      if (isGenerating) {
        pollingActiveRef.current = false;
        if (pollIntervalRef.current) {
          clearInterval(pollIntervalRef.current);
          pollIntervalRef.current = null;
        }
        console.warn('[Timeout] Problem generation final timeout - cleaning up');
        if (realtimeSubscription) {
          supabase.removeChannel(realtimeSubscription);
          setRealtimeSubscription(null);
        }
        setIsGenerating(false);
        const timeoutMessage = language === 'ko'
          ? '문제 생성 시간이 초과되었습니다. 잠시 후 다시 시도해주세요.'
          : 'Problem generation timed out. Please try again later.';
        setErrorAndNotify(timeoutMessage);
        generationStartTimeRef.current = null;
      }
    }, 10 * 60 * 1000); // 10분으로 증가 (여러 문제 유형 순차 생성 + Edge Function 실행 시간 고려)

    return () => {
      pollingActiveRef.current = false;
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
      clearTimeout(pollingTimeout);
      clearTimeout(finalTimeout);
    };
  }, [isGenerating, realtimeSubscription, language, expectedProblemCounts, userId, handleGenerationComplete, setErrorAndNotify]);

  // 문제 생성 핸들러
  const handleGenerateProblems = useCallback(async () => {
    const totalCount = Object.values(problemCounts).reduce((sum, count) => sum + count, 0);
    if (totalCount < 1) {
      const errorMessage = language === 'ko'
        ? '최소 하나의 문제 유형에서 1개 이상의 문제를 생성해야 합니다.'
        : 'At least one problem type must have 1 or more problems.';
      setErrorAndNotify(errorMessage);
      return;
    }

    setIsGenerating(true);
    setError(null);
    setReceivedProblems([]);
    receivedProblemsCountRef.current = 0;
    generationStartTimeRef.current = Date.now();

    try {
      const functionUrl = import.meta.env.VITE_ANALYZE_GCF_URL;
      if (!functionUrl) {
        throw new Error(language === 'ko'
          ? 'VITE_ANALYZE_GCF_URL 환경변수가 설정되지 않았습니다.'
          : 'VITE_ANALYZE_GCF_URL environment variable is not set.');
      }
      const problemTypes: ProblemType[] = ['multiple_choice', 'short_answer', 'essay', 'ox'];
      const classificationToUse = classifications.length > 0 ? classifications[0] : null;

      const expectedCounts: { [key: string]: number } = {};
      for (const problemType of problemTypes) {
        const count = problemCounts[problemType];
        if (count > 0) {
          expectedCounts[problemType] = count;
        }
      }
      setExpectedProblemCounts(expectedCounts);
      expectedProblemCountsRef.current = expectedCounts; // ref도 업데이트

      // Realtime 구독 시작
      if (realtimeSubscription) {
        await supabase.removeChannel(realtimeSubscription);
      }

      const channel = supabase
        .channel('generated-problems')
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'generated_problems',
            filter: `user_id=eq.${userId}`,
          },
          (payload) => {
            const newProblem = payload.new as GeneratedProblem;
            console.log('[Realtime] Received new problem via Realtime:', newProblem);

            // 에러 마커 체크
            if (newProblem.stem === '__GENERATION_ERROR__' || newProblem.stem === '__TIMEOUT_ERROR__') {
              console.error('Received error marker from background task:', newProblem.explanation);
              const errorMessage = newProblem.explanation || (language === 'ko' ? '문제 생성 중 오류가 발생했습니다.' : 'An error occurred while generating problems.');
              setErrorAndNotify(errorMessage);
              setIsGenerating(false);
              supabase.removeChannel(channel);
              setRealtimeSubscription(null);
              setExpectedProblemCounts({});
              setReceivedProblems([]);
              generationStartTimeRef.current = null;
              return;
            }

            // 생성 시작 시간 이후의 문제만 수신
            const problemCreatedAt = new Date(newProblem.created_at || new Date()).getTime();
            const startTime = generationStartTimeRef.current || Date.now();

            if (problemCreatedAt < startTime - 1000) {
              console.log('Ignoring problem created before generation start:', newProblem.id);
              return;
            }

            setReceivedProblems((prev) => {
              // ref를 사용하여 최신 expectedProblemCounts 값 가져오기
              const currentTotal = Object.values(expectedProblemCountsRef.current).reduce((sum, count) => sum + count, 0);
              if (prev.length >= currentTotal) {
                console.log('[Realtime] All problems already received - ignoring new problem');
                return prev;
              }

              // 중복 체크 (Set 사용으로 더 효율적이고 경쟁 조건 방지)
              const existingIds = new Set(prev.map(p => p.id));
              if (existingIds.has(newProblem.id)) {
                console.log('[Realtime] Duplicate problem ignored:', newProblem.id);
                return prev;
              }

              const newProblems = [...prev, newProblem];
              receivedProblemsCountRef.current = newProblems.length;

              if (newProblems.length >= currentTotal) {
                console.log(`[Realtime] All ${currentTotal} problems received via Realtime`);

                pollingActiveRef.current = false;
                if (pollIntervalRef.current) {
                  clearInterval(pollIntervalRef.current);
                  pollIntervalRef.current = null;
                }

                handleGenerationComplete(newProblems);

                supabase.removeChannel(channel);
                setRealtimeSubscription(null);
                setExpectedProblemCounts({});
                setReceivedProblems([]);
                receivedProblemsCountRef.current = 0;
                generationStartTimeRef.current = null;
              }

              return newProblems;
            });
          }
        )
        .subscribe();

      setRealtimeSubscription(channel);

      // 구독이 연결될 때까지 대기
      let subscriptionReady = false;
      const maxWaitTime = 2000;
      const startWait = Date.now();

      while (!subscriptionReady && Date.now() - startWait < maxWaitTime) {
        const channelState = (channel as any).state;
        console.log(`[Realtime] Channel state: ${channelState}`);
        if (channelState === 'joined') {
          subscriptionReady = true;
          break;
        }
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      if (!subscriptionReady) {
        console.warn('[Realtime] Subscription not ready after 2 seconds, proceeding anyway');
        console.warn('[Realtime] Will use polling fallback if Realtime fails');
      } else {
        console.log('[Realtime] Subscription confirmed - starting API calls');
      }

      await new Promise(resolve => setTimeout(resolve, 500));

      // 통합 GCF 호출 (1번): fire-and-forget으로 즉시 sessionId 반환
      // 백그라운드에서 1+3 패턴으로 모든 유형 생성 → Realtime/폴링으로 수신
      const currentAiOptions = aiOptionsRef.current;
      const typesPayload = problemTypes
        .filter((pt) => problemCounts[pt] > 0)
        .map((pt) => ({ problemType: pt, problemCount: problemCounts[pt] }));

      try {
        const { data: { session } } = await supabase.auth.getSession();

        const requestBody: any = {
          mode: 'generate-all',
          types: typesPayload,
          userId: userId,
          language: language,
          classification: classificationToUse,
          ...(currentAiOptions || {}),
        };

        const response = await fetch(functionUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session?.access_token}`,
          },
          body: JSON.stringify(requestBody),
        });

        if (!response.ok) {
          const errorText = await response.text();
          console.error('[generate-all] Error response:', errorText);
          let errorMessage = errorText || `HTTP ${response.status} error`;
          try {
            const errorJson = JSON.parse(errorText);
            errorMessage = errorJson.error || errorJson.message || errorMessage;
          } catch { /* keep errorText */ }

          if (response.status === 401) {
            throw new Error(language === 'ko'
              ? '인증이 만료되었습니다. 다시 로그인해주세요.'
              : 'Authentication expired. Please log in again.');
          }
          if (response.status === 503 || errorMessage.toLowerCase().includes('overloaded')) {
            throw new Error(language === 'ko'
              ? 'AI 서버가 일시적으로 과부하 상태입니다. 잠시 후 다시 시도해주세요.'
              : 'AI server is temporarily overloaded. Please try again later.');
          }
          throw new Error(language === 'ko'
            ? `문제 생성 요청 실패: ${errorMessage}`
            : `Failed to request problem generation: ${errorMessage}`);
        }

        const result = await response.json();
        if (!result.success) {
          throw new Error(result.error || (language === 'ko' ? '문제 생성 요청에 실패했습니다.' : 'Failed to request problem generation.'));
        }

        console.log(`[generate-all] 백그라운드 생성 시작: sessionId=${result.sessionId}, types=${typesPayload.map(t => t.problemType).join(',')}`);
        // 이후 문제 수신은 Realtime 구독 + 폴링 fallback이 처리
      } catch (callError) {
        console.error('[generate-all] 호출 실패:', callError);
        // 서비스/네트워크 한글 메시지가 en 모드에 누출되지 않도록 번역/차단(fallback=원시 메시지)
        const rawMsg = callError instanceof Error ? callError.message : String(callError);
        const errorMsg = translateError(callError, language, getTranslation(language), rawMsg);
        setErrorAndNotify(errorMsg);

        if (realtimeSubscription) {
          await supabase.removeChannel(realtimeSubscription);
          setRealtimeSubscription(null);
        }
        setIsGenerating(false);
        generationStartTimeRef.current = null;
        return;
      }
    } catch (e) {
      const errorMessage = translateError(e, language, getTranslation(language), language === 'ko' ? '문제 생성 중 오류가 발생했습니다.' : 'An error occurred while generating problems.');
      setErrorAndNotify(errorMessage);
      setIsGenerating(false);

      if (realtimeSubscription) {
        await supabase.removeChannel(realtimeSubscription);
        setRealtimeSubscription(null);
      }
      generationStartTimeRef.current = null;
    }
  }, [userId, language, problemCounts, classifications, realtimeSubscription, expectedProblemCounts, handleGenerationComplete, setErrorAndNotify, aiOptions]);

  // 리셋 함수
  const reset = useCallback(() => {
    setIsGenerating(false);
    setGeneratedProblems([]);
    setError(null);
    setReceivedProblems([]);
    setExpectedProblemCounts({});
    receivedProblemsCountRef.current = 0;
    generationStartTimeRef.current = null;
    pollingActiveRef.current = false;
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
    if (realtimeSubscription) {
      supabase.removeChannel(realtimeSubscription);
      setRealtimeSubscription(null);
    }
  }, [realtimeSubscription]);

  return {
    isGenerating,
    generatedProblems,
    error,
    handleGenerateProblems,
    reset,
  };
}

