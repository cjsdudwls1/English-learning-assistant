import { supabase } from '../supabaseClient';
import { getCurrentUserId } from './auth';
import { resolveImageUrls } from '../../utils/imageUrl';

export interface ProblemMetadataItem {
  problem_id: string;
  content: {
    stem?: string;
    choices?: Array<string | { text?: string; label?: string; [key: string]: any }>;
    [key: string]: any;
  } | null;
  correct_answer: string | null;
  user_answer: string | null;
  metadata: {
    difficulty: '상' | '중' | '하' | 'high' | 'medium' | 'low';
    word_difficulty: number;
    problem_type: string;
    analysis: string;
  } | null;
  session: {
    id: string;
    created_at: string;
    image_url: string;
    image_urls: string[];
  };
  classification: any;
  is_correct: boolean;
}

const ID_CHUNK = 500;

export async function fetchProblemsMetadataByCorrectness(
  depth1?: string,
  depth2?: string,
  depth3?: string,
  depth4?: string,
  isCorrect: boolean | null = null,
  unclassified: boolean = false
): Promise<ProblemMetadataItem[]> {
  const userId = await getCurrentUserId();

  // 1) 사용자의 sessions (id, created_at, image_urls)
  const { data: sessions, error: sErr } = await supabase
    .from('sessions')
    .select('id, created_at, image_urls')
    .eq('user_id', userId);
  if (sErr) throw sErr;
  if (!sessions || sessions.length === 0) return [];
  const sessionMap = new Map<string, { id: string; created_at: string; image_urls: string[] | null }>();
  await Promise.all(sessions.map(async (s) => {
    const urls = await resolveImageUrls(s.image_urls);
    sessionMap.set(s.id, { id: s.id, created_at: s.created_at, image_urls: urls });
  }));

  // 2) sessions의 problems (id, session_id, content, problem_metadata)
  const sessionIds = sessions.map((s) => s.id);
  const problemsRows: any[] = [];
  for (let i = 0; i < sessionIds.length; i += ID_CHUNK) {
    const chunk = sessionIds.slice(i, i + ID_CHUNK);
    const { data, error } = await supabase
      .from('problems')
      .select('id, session_id, content, problem_metadata')
      .in('session_id', chunk);
    if (error) throw error;
    problemsRows.push(...(data || []));
  }
  if (problemsRows.length === 0) return [];
  const problemMap = new Map<string, any>();
  for (const p of problemsRows) problemMap.set(p.id, p);
  const problemIds = problemsRows.map((p) => p.id);

  // 3) problems의 labels (classification/is_correct 필터)
  const labelsRows: any[] = [];
  for (let i = 0; i < problemIds.length; i += ID_CHUNK) {
    const chunk = problemIds.slice(i, i + ID_CHUNK);
    let q = supabase
      .from('labels')
      .select('problem_id, is_correct, correct_answer, user_answer, classification')
      .in('problem_id', chunk);
    // 미분류 노드: classification.depth1이 ''(빈문자열)이라 eq('...depth1','미분류')로는 0건이 되어
    // "분석 정보가 없습니다"가 뜨던 버그. depth 필터를 걸지 않고 전체를 가져와 아래 루프에서 미분류만 선별.
    if (!unclassified) {
      if (depth1) q = q.eq('classification->>depth1', depth1);
      if (depth2) q = q.eq('classification->>depth2', depth2);
      if (depth3) q = q.eq('classification->>depth3', depth3);
      if (depth4) q = q.eq('classification->>depth4', depth4);
    }
    if (isCorrect !== null) q = q.eq('is_correct', isCorrect);
    const { data, error } = await q;
    if (error) throw error;
    labelsRows.push(...(data || []));
  }

  const items: ProblemMetadataItem[] = [];
  for (const l of labelsRows) {
    // 미분류 조회 시: 분류된 항목(depth1 존재)은 제외 → depth1이 ''/null/미존재인 것만
    if (unclassified && l.classification && l.classification.depth1) continue;
    const problem = problemMap.get(l.problem_id);
    if (!problem) continue;
    const session = sessionMap.get(problem.session_id);
    items.push({
      problem_id: l.problem_id,
      content: problem.content || null,
      correct_answer: l.correct_answer || null,
      user_answer: l.user_answer || null,
      metadata: problem.problem_metadata || null,
      session: {
        id: problem.session_id,
        created_at: session?.created_at || '',
        image_url: session?.image_urls?.[0] || '',
        image_urls: session?.image_urls || [],
      },
      classification: l.classification || {},
      is_correct: l.is_correct,
    });
  }

  return items.sort((a, b) => {
    const dateA = new Date(a.session.created_at).getTime();
    const dateB = new Date(b.session.created_at).getTime();
    return dateB - dateA;
  });
}
