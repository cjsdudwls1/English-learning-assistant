import { useState, useRef, useEffect, useCallback } from 'react';
import { supabase } from '../services/supabaseClient';
import type { GeneratedProblem, RealtimeSubscription } from '../types';

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

    // 10초 후 Realtime으로 문제를 받지 못하면 폴링 시작
    const pollingTimeout = setTimeout(async () => {
      if (receivedProblems.length >= totalExpected || !isGenerating) {
        console.log('[Polling] Skipping polling - problems already received or generation stopped');
        return;
      }

      if (receivedProblems.length === 0 && realtimeSubscription) {
        console.warn('[Polling] No problems received via Realtime after 10 seconds - switching to polling mode');
        
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
              const { data: problems, error: pollError } = await supabase
                .from('generated_problems')
                .select('id, stem, choices, correct_answer_index, problem_type, classification, correct_answer, guidelines, is_correct, explanation, is_editable, created_at')
                .eq('user_id', userId)
                .gte('created_at', new Date(startTime - 1000).toISOString())
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
          
          setTimeout(() => {
            if (pollIntervalRef.current) {
              pollingActiveRef.current = false;
              clearInterval(pollIntervalRef.current);
              pollIntervalRef.current = null;
            }
            if (isGenerating) {
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
  }, [isGenerating, realtimeSubscription, language, receivedProblems.length, expectedProblemCounts, userId, handleGenerationComplete, setErrorAndNotify]);

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
      const functionUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-problems-by-type`;
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

      // RPM 제한을 피하기 위해 각 호출 사이에 딜레이 추가
      let isFirstRequest = true;

      for (const problemType of problemTypes) {
        const count = problemCounts[problemType];
        if (count <= 0) continue;

        if (!isFirstRequest) {
          const delayMs = 7000;
          console.log(`Waiting ${delayMs/1000} seconds before generating ${problemType} problems...`);
          await new Promise(resolve => setTimeout(resolve, delayMs));
        }
        isFirstRequest = false;

        try {
          const { data: { session } } = await supabase.auth.getSession();
          const response = await fetch(functionUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${session?.access_token}`,
            },
            body: JSON.stringify({
              problemType: problemType,
              problemCount: count,
              userId: userId,
              language: language,
              classification: classificationToUse,
            }),
          });

          if (!response.ok) {
            const errorText = await response.text();
            console.error(`[${problemType}] Error response:`, errorText);
            let errorMessage = '';

            try {
              const errorJson = JSON.parse(errorText);
              console.error(`[${problemType}] Parsed error JSON:`, errorJson);

              if (errorJson.error) {
                if (typeof errorJson.error === 'string') {
                  try {
                    const nestedError = JSON.parse(errorJson.error);
                    console.error(`[${problemType}] Nested error:`, nestedError);
                    if (nestedError.error?.message) {
                      errorMessage = nestedError.error.message;
                    } else if (nestedError.message) {
                      errorMessage = nestedError.message;
                    } else {
                      errorMessage = errorJson.error;
                    }
                  } catch {
                    errorMessage = errorJson.error;
                  }
                } else if (errorJson.error?.message) {
                  errorMessage = errorJson.error.message;
                } else if (errorJson.error?.error?.message) {
                  errorMessage = errorJson.error.error.message;
                } else {
                  errorMessage = errorText;
                }
              } else if (errorJson.message) {
                errorMessage = errorJson.message;
              } else {
                errorMessage = errorText;
              }

              if (errorJson.errorDetails) {
                console.error(`[${problemType}] Error details:`, errorJson.errorDetails);
                const detailsStr = String(errorJson.errorDetails);
                if (detailsStr.includes('Error:')) {
                  const match = detailsStr.match(/Error: (.+?)(?:\n|$)/);
                  if (match && match[1]) {
                    errorMessage = match[1].trim();
                  }
                } else if (detailsStr.length < 200) {
                  errorMessage = detailsStr;
                }
              }
            } catch {
              errorMessage = errorText || `HTTP ${response.status} error`;
            }

            const lowerErrorMessage = errorMessage.toLowerCase();
            if (lowerErrorMessage.includes('overloaded') || lowerErrorMessage.includes('unavailable') || response.status === 503) {
              throw new Error(language === 'ko' 
                ? 'AI 서버가 일시적으로 과부하 상태입니다. 잠시 후 다시 시도해주세요.' 
                : 'AI server is temporarily overloaded. Please try again later.');
            } else if (lowerErrorMessage.includes('quota') || lowerErrorMessage.includes('quota_exceeded')) {
              throw new Error(language === 'ko'
                ? 'AI 서비스 사용량 한도를 초과했습니다. 나중에 다시 시도해주세요.'
                : 'AI service quota exceeded. Please try again later.');
            } else if (errorMessage && errorMessage !== 'Unknown error') {
              throw new Error(language === 'ko'
                ? `문제 생성 중 오류가 발생했습니다: ${errorMessage}`
                : `An error occurred while generating problems: ${errorMessage}`);
            } else {
              throw new Error(language === 'ko'
                ? `문제 생성 중 오류가 발생했습니다. (HTTP ${response.status})`
                : `An error occurred while generating problems. (HTTP ${response.status})`);
            }
          }

          const result = await response.json();

          if (!result.success) {
            let errorMsg = result.error || (language === 'ko' ? '문제 생성에 실패했습니다.' : 'Failed to generate problems.');
            throw new Error(errorMsg);
          }

          console.log(`[${problemType}] Problem generation started in background`);
        } catch (innerError) {
          console.error(`Error generating ${problemType} problems:`, innerError);

          const problemTypeName = language === 'ko' 
            ? (problemType === 'multiple_choice' ? '객관식' : 
               problemType === 'short_answer' ? '단답형' : 
               problemType === 'essay' ? '서술형' : 'O/X')
            : (problemType === 'multiple_choice' ? 'Multiple Choice' : 
               problemType === 'short_answer' ? 'Short Answer' : 
               problemType === 'essay' ? 'Essay' : 'True/False');

          const errorMsg = innerError instanceof Error ? innerError.message : String(innerError);
          setErrorAndNotify(language === 'ko' 
            ? `${problemTypeName} 문제 생성 중 오류가 발생했습니다: ${errorMsg}`
            : `Error generating ${problemTypeName} problems: ${errorMsg}`);

          if (realtimeSubscription) {
            await supabase.removeChannel(realtimeSubscription);
            setRealtimeSubscription(null);
          }
          setIsGenerating(false);
          generationStartTimeRef.current = null;
        }
      }
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : (language === 'ko' ? '문제 생성 중 오류가 발생했습니다.' : 'An error occurred while generating problems.');
      setErrorAndNotify(errorMessage);
      setIsGenerating(false);

      if (realtimeSubscription) {
        await supabase.removeChannel(realtimeSubscription);
        setRealtimeSubscription(null);
      }
      generationStartTimeRef.current = null;
    }
  }, [userId, language, problemCounts, classifications, realtimeSubscription, expectedProblemCounts, handleGenerationComplete, setErrorAndNotify]);

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

