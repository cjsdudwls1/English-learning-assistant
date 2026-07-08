import { supabase } from './supabaseClient';

// 서술형 AI 보조 채점 — grade-essay Edge Function 호출.
// AI 판정은 제안일 뿐이며 저장하지 않는다. 교사가 [반영]을 눌러야 gradeAssignmentResponse로 확정.

export interface EssayGradingSuggestion {
  verdict: 'correct' | 'incorrect' | 'uncertain';
  feedback: string;
}

export async function requestEssayGrading(
  responseId: string,
  language: 'ko' | 'en'
): Promise<EssayGradingSuggestion> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');
  const { data: { session } } = await supabase.auth.getSession();

  const functionUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/grade-essay`;
  const response = await fetch(functionUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${session?.access_token}`,
    },
    body: JSON.stringify({ responseId, userId: user.id, language }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    let errorData: any;
    try {
      errorData = JSON.parse(errorText);
    } catch {
      errorData = { error: errorText };
    }
    throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
  }

  const result = await response.json();
  if (!result.success || !result.grading) {
    throw new Error(result.error || 'Failed to grade essay');
  }

  const verdict: EssayGradingSuggestion['verdict'] =
    ['correct', 'incorrect', 'uncertain'].includes(result.grading.verdict)
      ? result.grading.verdict
      : 'uncertain';
  return { verdict, feedback: String(result.grading.feedback || '') };
}
