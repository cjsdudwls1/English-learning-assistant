import { supabase } from './supabaseClient';
import type { ProblemItem, SessionWithProblems } from '../types';
import { isCorrectFromMark, normalizeMark } from './marks';

export async function getCurrentUserId(): Promise<string> {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    throw new Error('로그인이 필요합니다.');
  }
  return data.user.id;
}

export async function uploadProblemImage(file: File): Promise<string> {
  const userId = await getCurrentUserId();
  const timestamp = Date.now();
  const safeName = file.name.replace(/[^a-zA-Z0-9_.-]/g, '_');
  
  // 사용자 이메일 가져오기
  const { data: userData } = await supabase.auth.getUser();
  const email = userData.user?.email || userId; // 이메일이 없으면 fallback to userId
  const emailLocal = email.split('@')[0].replace(/[^a-zA-Z0-9_-]/g, '_'); // @ 앞부분 추출 및 sanitize
  const path = `${emailLocal}/${timestamp}_${safeName}`;
  
  const { data, error } = await supabase.storage.from('problem-images').upload(path, file, {
    cacheControl: '3600',
    upsert: false,
  });
  if (error) throw error;
  const { data: urlData } = supabase.storage.from('problem-images').getPublicUrl(data.path);
  return urlData.publicUrl;
}

export async function createSession(imageUrl: string): Promise<string> {
  const userId = await getCurrentUserId();
  const { data, error } = await supabase.from('sessions').insert({ user_id: userId, image_url: imageUrl }).select('id').single();
  if (error) throw error;
  return data.id as string;
}

// 사용자의 세션 목록 조회 (최근순)
export async function fetchUserSessions(): Promise<SessionWithProblems[]> {
  const userId = await getCurrentUserId();
  
  // sessions와 problems, labels를 조인하여 통계 계산
  const { data, error } = await supabase
    .from('sessions')
    .select(`
      id,
      created_at,
      image_url,
      problems (
        id,
        labels (
          user_mark
        )
      )
    `)
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  
  if (error) throw error;
  
  // 통계 계산
  const sessions: SessionWithProblems[] = (data || []).map((session: any) => {
    const problems = session.problems || [];
    const problem_count = problems.length;
    let correct_count = 0;
    let incorrect_count = 0;
    
    problems.forEach((problem: any) => {
      const labels = problem.labels || [];
      if (labels.length > 0) {
        const mark = normalizeMark(labels[0].user_mark);
        if (isCorrectFromMark(mark)) correct_count++; else incorrect_count++;
      }
    });
    
    return {
      id: session.id,
      created_at: session.created_at,
      image_url: session.image_url,
      problem_count,
      correct_count,
      incorrect_count,
    };
  });
  
  return sessions;
}

// 특정 세션의 문제 조회
export async function fetchSessionProblems(sessionId: string): Promise<ProblemItem[]> {
  // problems와 labels 조회
  const { data: problems, error: problemsError } = await supabase
    .from('problems')
    .select(`
      id,
      index_in_image,
      stem,
      choices,
      labels (
        user_answer,
        user_mark,
        classification
      )
    `)
    .eq('session_id', sessionId)
    .order('index_in_image', { ascending: true });
  
  if (problemsError) throw problemsError;
  
  // ProblemItem 형식으로 변환
  const items: ProblemItem[] = (problems || []).map((p: any) => {
    const label = p.labels?.[0] || {};
    const classification = label.classification || {};
    
    return {
      index: p.index_in_image,
      사용자가_직접_채점한_정오답: normalizeMark(label.user_mark),
      문제내용: {
        text: p.stem || '',
        confidence_score: 1.0,
      },
      문제_보기: (p.choices || []).map((c: any) => ({
        text: c.text || '',
        confidence_score: c.confidence || 1.0,
      })),
      사용자가_기술한_정답: {
        text: label.user_answer || '',
        confidence_score: 1.0,
        auto_corrected: false,
        alternate_interpretations: [],
      },
      문제_유형_분류: {
        '1Depth': classification['1Depth'] || '',
        '2Depth': classification['2Depth'] || '',
        '3Depth': classification['3Depth'] || '',
        '4Depth': classification['4Depth'] || '',
        '분류_신뢰도': classification['분류_신뢰도'] || '보통',
      },
      분류_근거: '',
    };
  });
  
  return items;
}

// 문제 수정
export async function updateProblemLabels(sessionId: string, items: ProblemItem[]): Promise<void> {
  // 먼저 해당 세션의 문제 ID들을 가져옴
  const { data: problems, error: fetchError } = await supabase
    .from('problems')
    .select('id, index_in_image')
    .eq('session_id', sessionId);
  
  if (fetchError) throw fetchError;
  
  const idByIndex = new Map<number, string>();
  for (const row of problems || []) {
    idByIndex.set(row.index_in_image, row.id);
  }
  
  // 각 문제에 대해 업데이트
  for (const item of items) {
    const problemId = idByIndex.get(item.index);
    if (!problemId) continue;
    
    // problems 테이블 업데이트
    const { error: problemUpdateError } = await supabase
      .from('problems')
      .update({
        stem: item.문제내용.text,
        choices: item.문제_보기.map(c => ({ text: c.text, confidence: c.confidence_score })),
      })
      .eq('id', problemId);
    
    if (problemUpdateError) throw problemUpdateError;
    
    // labels 테이블 업데이트
    const { error: labelUpdateError } = await supabase
      .from('labels')
      .update({
        user_answer: item.사용자가_기술한_정답.text,
        user_mark: normalizeMark(item.사용자가_직접_채점한_정오답),
        is_correct: isCorrectFromMark(item.사용자가_직접_채점한_정오답),
        classification: item.문제_유형_분류,
      })
      .eq('problem_id', problemId);
    
    if (labelUpdateError) throw labelUpdateError;
  }
}

// 세션 삭제
export async function deleteSession(sessionId: string): Promise<void> {
  // Supabase에서 cascade delete가 설정되어 있다면 세션만 삭제하면 됨
  const { error } = await supabase
    .from('sessions')
    .delete()
    .eq('id', sessionId);
  
  if (error) throw error;
}


