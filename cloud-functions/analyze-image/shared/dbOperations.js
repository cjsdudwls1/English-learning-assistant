/**
 * DB 작업 모듈
 * - 이미지 업로드 (Supabase Storage)
 * - 세션 생성
 * - 문제(problems) 저장
 * - 라벨(labels) 저장
 * - 메타데이터 업데이트
 * - 세션 완료
 */

import { StageError } from './errors.js';

/**
 * 이미지를 Supabase Storage에 업로드하고 URL 반환
 * @returns {string[]} 업로드된 이미지 URL 배열
 */
export async function uploadImages(supabase, images, userId) {
  const imageUrls = [];

  for (let index = 0; index < images.length; index++) {
    const imageData = images[index];
    const fileName = `${userId}/${Date.now()}_${index}_${imageData.fileName || 'image.jpg'}`;
    const buffer = Buffer.from(imageData.imageBase64, 'base64');

    const { error: uploadError } = await supabase.storage
      .from('uploaded-images')
      .upload(fileName, buffer, { contentType: imageData.mimeType || 'image/jpeg' });

    if (uploadError) {
      console.error(`[dbOperations] 이미지 ${index} 업로드 실패:`, uploadError);
    }

    const { data: urlData } = supabase.storage.from('uploaded-images').getPublicUrl(fileName);
    imageUrls.push(urlData?.publicUrl || fileName);
  }

  return imageUrls;
}

/**
 * 분석 세션 생성
 * @returns {string} 생성된 세션 ID
 */
export async function createSession(supabase, userId, imageUrls) {
  const { data: session, error: sessionError } = await supabase
    .from('sessions')
    .insert({ user_id: userId, image_urls: imageUrls, status: 'processing' })
    .select('id')
    .single();

  if (sessionError || !session) {
    throw new StageError('session_create', '세션 생성 실패', { sessionError });
  }

  return session.id;
}

/**
 * 추출된 문제 데이터를 DB에 저장
 * problems 테이블 컬럼: id, session_id, index_in_image, created_at, content(jsonb), problem_metadata(jsonb)
 * @returns {Array} 저장된 problems 배열 (id, index_in_image)
 */
export async function saveProblems(supabase, sessionId, validatedItems) {
  const problemsPayload = validatedItems.map((problem, index) => ({
    session_id: sessionId,
    index_in_image: index,
    content: {
      problem_number: problem.problem_number || String(index + 1),
      question_text: problem.question_text || problem.instruction || problem.stem || '',
      choices: problem.choices || [],
      correct_answer: problem.correct_answer || null,
      user_answer: problem.user_answer || null,
      passage: problem.passage || problem._resolved_passage || null,
      instruction: problem.instruction || null,
      source_page: problem.source_page || 1,
    },
  }));

  const { data: savedProblems, error: insertError } = await supabase
    .from('problems')
    .insert(problemsPayload)
    .select('id, index_in_image');

  if (insertError) {
    console.error('[dbOperations] problems insert 상세 에러:', JSON.stringify(insertError));
    throw new StageError('insert_problems', '문제 저장 실패', { insertError });
  }

  return savedProblems;
}

/**
 * 분류 라벨을 DB에 저장
 */
export async function saveLabels(supabase, sessionId, savedProblems, validatedItems, taxonomyByDepthKey) {
  const labelsPayload = [];

  for (const problem of savedProblems) {
    const originalItem = validatedItems[problem.index_in_image];
    if (!originalItem?.classification) continue;

    const classification = originalItem.classification;
    const depthValues = [classification.depth1, classification.depth2, classification.depth3, classification.depth4]
      .filter(value => typeof value === 'string' && value.trim().length > 0);

    for (const labelText of depthValues) {
      // taxonomyByDepthKey에서 라벨 텍스트가 포함된 항목 검색
      for (const [lookupKey, node] of taxonomyByDepthKey) {
        if (lookupKey.includes(labelText)) {
          labelsPayload.push({ problem_id: problem.id, taxonomy_node_id: node.id });
          break;
        }
      }
    }
  }

  if (labelsPayload.length > 0) {
    const { error: labelsError } = await supabase.from('labels').insert(labelsPayload);
    if (labelsError) {
      console.error('[dbOperations] 라벨 저장 실패:', labelsError);
    } else {
      console.log(`[dbOperations] ${labelsPayload.length}개 라벨 저장 완료`, { sessionId });
    }
  }
}

/**
 * 문제별 메타데이터 업데이트 (난이도, 어휘 난이도, 분석)
 */
export async function updateProblemMetadata(supabase, savedProblems, validatedItems, userLanguage) {
  const VALID_KO_DIFFICULTIES = ['상', '중', '하'];
  const MIN_WORD_DIFFICULTY = 1;
  const MAX_WORD_DIFFICULTY = 9;
  const DEFAULT_WORD_DIFFICULTY = 5;

  for (const problem of savedProblems) {
    const originalItem = validatedItems[problem.index_in_image];
    if (!originalItem) continue;

    const metadata = originalItem.metadata || {};
    const classification = originalItem.classification || {};

    // problem_type 생성
    const typeParts = [classification.depth1, classification.depth2, classification.depth3, classification.depth4]
      .filter(value => typeof value === 'string' && value.trim().length > 0);
    const problemType = typeParts.length > 0
      ? typeParts.join(' - ')
      : (userLanguage === 'ko' ? '분류 없음' : 'Unclassified');

    // 난이도 정규화
    let difficulty = metadata.difficulty;
    if (userLanguage === 'ko' && !VALID_KO_DIFFICULTIES.includes(difficulty || '')) {
      const difficultyMap = { high: '상', medium: '중', low: '하' };
      difficulty = difficultyMap[difficulty] || '중';
    }

    // 어휘 난이도 유효성 검증
    const rawWordDifficulty = Number(metadata.word_difficulty);
    const isValid = !isNaN(rawWordDifficulty) && rawWordDifficulty >= MIN_WORD_DIFFICULTY && rawWordDifficulty <= MAX_WORD_DIFFICULTY;
    const wordDifficulty = isValid ? Math.round(rawWordDifficulty) : DEFAULT_WORD_DIFFICULTY;

    await supabase.from('problems').update({
      problem_metadata: {
        difficulty,
        word_difficulty: wordDifficulty,
        problem_type: problemType,
        analysis: metadata.analysis || '',
      },
    }).eq('id', problem.id);
  }
}

/**
 * 세션을 완료 상태로 업데이트
 */
export async function completeSession(supabase, sessionId, analysisModel) {
  await supabase.from('sessions').update({
    status: 'completed',
    analysis_model: analysisModel,
    models_used: { analysis: analysisModel },
  }).eq('id', sessionId);
}
