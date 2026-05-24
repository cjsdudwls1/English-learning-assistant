/**
 * DB 작업 모듈
 * - 이미지 업로드 (Supabase Storage)
 * - 세션 생성 (image_urls 검증/정리 포함)
 * - 문제(problems) 저장 (content JSONB 상세 필드 + stem 합성 + choices 정규화)
 * - 라벨(labels) 저장 (O/X 마크 판정 + taxonomy 보강)
 * - 메타데이터 업데이트 (난이도 양방향 정규화)
 * - 세션 완료 (labeled 상태 가드)
 *
 * 원본: sessionManager.ts, problemSaver.ts, labelProcessor.ts (Edge Function b6fd71be)
 */

import { StageError } from './errors.js';
import { cleanOrNull, makeDepthKey } from './taxonomy.js';

// ─── O/X 마크 정규화 ────────────────────────────────────────
// 원본: validation.ts#normalizeMark

/**
 * 다양한 O/X 표기를 'O' | 'X' | 'Unknown'으로 정규화한다.
 */
function normalizeMark(raw) {
  if (raw === undefined || raw === null) return 'Unknown';
  const value = String(raw).trim().toLowerCase();

  if (value === 'unknown') return 'Unknown';

  const truthy = new Set(['o', '✓', 'v', 'correct', 'true', '정답', '맞음', 'ok', '⭕', 'circle', 'check', 'checkmark', 'yes', 'pass']);
  if (truthy.has(value)) return 'O';

  const falsy = new Set(['x', '✗', 'incorrect', 'false', '오답', '틀림', 'no', 'fail', '❌']);
  if (falsy.has(value)) return 'X';

  return 'Unknown';
}

// ─── 답안 번호 파싱 ─────────────────────────────────────────

/**
 * 답안 번호를 정규화하여 숫자로 파싱
 * 원(①②③④⑤), "4번", "4." 등 다양한 형식 처리
 */
function parseAnswerNumber(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  const circled = '①②③④⑤';
  const circledIdx = circled.indexOf(s);
  if (circledIdx !== -1) return circledIdx + 1;
  // 순수 숫자 또는 '4번', '4.' 형식만 매칭 (단어 안의 숫자는 제외)
  // 예: "appear" → null, "3" → 3, "4번" → 4
  if (/^[0-9]+$/.test(s)) return parseInt(s, 10);
  const numMatch = s.match(/^(\d+)[번.)\s]?$/);
  return numMatch ? parseInt(numMatch[1], 10) : null;
}

// ─── 단어→번호 매핑 (객관식 채점 fallback) ──────────────────

/**
 * 객관식 문제에서 correct_answer가 단어/구문으로 들어왔을 때
 * choices 배열에서 그 단어를 포함하는 항목을 찾아 1-based 번호로 변환.
 * - 정확 일치 우선, 그 다음 부분 일치(단어 포함)
 * - 매칭 실패 시 null
 *
 * 예: choices=[{text:"appear"}, {text:"rise"}, {text:"reach"}], correct="rise" → 2
 */
function mapWordToChoiceNumber(rawAnswer, choices) {
  if (!rawAnswer || !Array.isArray(choices) || choices.length === 0) return null;
  const answer = String(rawAnswer).trim().toLowerCase();
  if (!answer) return null;

  const normalize = (s) => String(s || '').trim().toLowerCase().replace(/[^a-z0-9가-힣\s]/gi, '').replace(/\s+/g, ' ');
  const normAnswer = normalize(answer);

  // 1단계: 정확 일치 (text 또는 label)
  for (let i = 0; i < choices.length; i++) {
    const c = choices[i];
    const text = typeof c === 'string' ? c : (c?.text || '');
    const label = typeof c === 'string' ? '' : (c?.label || '');
    if (normalize(text) === normAnswer || normalize(label) === normAnswer) {
      return i + 1;
    }
  }

  // 2단계: 부분 일치 (choice 텍스트가 answer를 단어 단위로 포함하거나, answer가 choice를 단어 단위로 포함)
  for (let i = 0; i < choices.length; i++) {
    const c = choices[i];
    const text = typeof c === 'string' ? c : (c?.text || '');
    const normText = normalize(text);
    if (!normText) continue;

    // 단어 경계 매칭: " word " 형태로 둘러싸서 부분 단어 매칭 방지
    const paddedText = ` ${normText} `;
    const paddedAnswer = ` ${normAnswer} `;
    if (paddedText.includes(paddedAnswer) || paddedAnswer.includes(paddedText)) {
      return i + 1;
    }
  }

  return null;
}

// ─── choices 정규화 ─────────────────────────────────────────
// 원본: problemSaver.ts#normalizeChoices

/**
 * 문자열/객체 배열 모두 { label?, text } 구조로 정규화
 */
function normalizeChoices(choices) {
  return (choices || []).map((c) => {
    if (typeof c === 'string') {
      return { text: c };
    }
    // 새 구조: { label: "①", text: "..." }
    if (c.label && c.text) {
      return { label: c.label, text: c.text };
    }
    return { text: c.text || String(c) };
  });
}

// ─── stem 텍스트 생성 ───────────────────────────────────────
// 원본: problemSaver.ts#buildStemFromItem

/**
 * instruction + passage + question_body + visual_context 조합 stem 텍스트 생성
 */
function buildStemFromItem(item) {
  // 기존 question_text가 있으면 그것을 사용 (하위 호환성)
  let stemText = item.question_text || '';
  if (!stemText && item.instruction) {
    // 새로운 구조: instruction을 기본으로 하고, passage가 있으면 앞에 추가
    const passageText = item._resolved_passage || item.passage || '';
    const questionBody = item.question_body || '';
    stemText = [
      passageText ? `[지문]\n${passageText}` : '',
      item.visual_context ? `[${item.visual_context.type || '자료'}] ${item.visual_context.title || ''}\n${item.visual_context.content || ''}` : '',
      `[문제] ${item.instruction}`,
      questionBody ? `\n${questionBody}` : ''
    ].filter(Boolean).join('\n\n');
  }
  return stemText;
}

// ─── content JSONB 구조 생성 ────────────────────────────────
// 원본: problemSaver.ts#buildContentJson

function buildContentJson(item, normalizedChoicesArr) {
  return {
    stem: buildStemFromItem(item),
    problem_number: item.problem_number || null,
    shared_passage_ref: item.shared_passage_ref || null,
    passage: item._resolved_passage || item.passage || null,
    visual_context: item.visual_context || null,
    instruction: item.instruction || null,
    question_body: item.question_body || null,
    choices: normalizedChoicesArr,
    user_answer: item.user_answer || null,
    user_marked_correctness: item.user_marked_correctness || null,
    correct_answer: item.correct_answer || null,
  };
}

// ─── 이미지 업로드 ──────────────────────────────────────────

/**
 * 이미지를 Supabase Storage에 업로드하고 URL 반환
 * @returns {string[]} 업로드된 이미지 URL 배열
 */
export async function uploadImages(supabase, images, userId) {
  const baseTs = Date.now();
  const results = await Promise.all(
    images.map(async (imageData, index) => {
      const fileName = `${userId}/${baseTs}_${index}_${imageData.fileName || 'image.jpg'}`;
      const buffer = Buffer.from(imageData.imageBase64, 'base64');

      const { error: uploadError } = await supabase.storage
        .from('uploaded-images')
        .upload(fileName, buffer, { contentType: imageData.mimeType || 'image/jpeg' });

      if (uploadError) {
        console.error(`[dbOperations] 이미지 ${index} 업로드 실패:`, uploadError);
      }

      const { data: urlData } = supabase.storage.from('uploaded-images').getPublicUrl(fileName);
      return { index, url: urlData?.publicUrl || fileName };
    })
  );

  results.sort((a, b) => a.index - b.index);
  return results.map((r) => r.url);
}

// ─── 세션 생성 (image_urls 검증/정리 포함) ──────────────────
// 원본: sessionManager.ts#createSession

/**
 * 분석 세션을 생성한다.
 * - image_urls를 검증/정리하여 저장
 * - 저장 후 데이터 정합성 검증 로그 출력
 * @returns {string} 생성된 세션 ID
 */
export async function createSession(supabase, userId, imageUrls) {
  console.log('[dbOperations:createSession] 세션 생성 시작', {
    imageUrlsCount: imageUrls.length,
  });

  // image_urls 배열 검증 및 정리
  const cleanedImageUrls = imageUrls.filter((url) => url && typeof url === 'string' && url.trim().length > 0);
  if (cleanedImageUrls.length !== imageUrls.length) {
    console.warn('[dbOperations:createSession] 유효하지 않은 URL 필터링됨', {
      originalCount: imageUrls.length,
      cleanedCount: cleanedImageUrls.length,
    });
  }

  const finalImageUrls = cleanedImageUrls.length > 0 ? cleanedImageUrls : imageUrls;

  const { data: sessionData, error: sessionError } = await supabase
    .from('sessions')
    .insert({
      user_id: userId,
      image_urls: finalImageUrls,
      status: 'pending', // worker가 lease 잡을 때 'processing'으로 전환 — C1 race 회피
    })
    .select('id, image_urls')
    .single();

  if (sessionError || !sessionData) {
    console.error('[dbOperations:createSession] 에러 상세:', JSON.stringify(sessionError));
    throw new StageError('session_create', '세션 생성 실패', { sessionError });
  }

  const sessionId = sessionData.id;

  // 저장된 데이터 검증
  if (!Array.isArray(sessionData.image_urls)) {
    console.error('[dbOperations:createSession] WARNING - image_urls가 배열이 아님!', {
      sessionId,
      type: typeof sessionData.image_urls,
      value: sessionData.image_urls,
    });
  } else if (sessionData.image_urls.length !== imageUrls.length) {
    console.warn('[dbOperations:createSession] WARNING - image_urls 갯수 불일치!', {
      sessionId,
      expected: imageUrls.length,
      actual: sessionData.image_urls.length,
    });
  }

  console.log('[dbOperations:createSession] 세션 생성 완료', { sessionId });
  return sessionId;
}

// ─── 문제(problems) 저장 ────────────────────────────────────
// 원본: problemSaver.ts#saveProblems

/**
 * 추출된 문제 데이터를 DB에 저장
 * - choices 정규화 (문자열/객체 배열 모두 지원)
 * - stem 텍스트 생성 (instruction + passage + question_body 조합)
 * - content JSONB 상세 필드 포함
 * - problem_metadata 기본값 제공
 *
 * @returns {Array} 저장된 problems 배열 (id, index_in_image)
 */
export async function saveProblems(supabase, sessionId, validatedItems) {
  console.log(`[dbOperations:saveProblems] 문제 저장 시작`, { sessionId, itemCount: validatedItems.length });

  const problemsPayload = validatedItems.map((it, idx) => {
    const normalizedChoicesArr = normalizeChoices(it.choices);
    const contentJson = buildContentJson(it, normalizedChoicesArr);

    return {
      session_id: sessionId,
      index_in_image: idx, // 항상 배열 인덱스 사용 (0부터 순차적으로 증가)
      content: contentJson,
      problem_metadata: it.metadata || {
        difficulty: '중',
        word_difficulty: 5,
        problem_type: '분석 대기',
        analysis: '분석 정보 없음',
      },
    };
  });

  const { data: savedProblems, error: insertError } = await supabase
    .from('problems')
    .insert(problemsPayload)
    .select('id, index_in_image');

  if (insertError) {
    console.error('[dbOperations:saveProblems] problems insert 에러:', JSON.stringify(insertError));
    throw new StageError('insert_problems', '문제 저장 실패', { insertError });
  }

  console.log(`[dbOperations:saveProblems] ${savedProblems?.length || 0}개 문제 저장 완료`, { sessionId });

  return savedProblems;
}

// ─── 라벨(labels) 저장 ──────────────────────────────────────
// 원본: labelProcessor.ts#buildLabelsPayload + index.ts Step 5

/**
 * AI 분석 결과를 labels 테이블에 저장
 *
 * - is_correct 2단계 판정: O/X 마크 우선 → 자동 비교 폴백
 * - taxonomy 보강: depth→code/CEFR/난이도 조회, 부분 depth 시 전체 null, code 역방향 복원
 * - 실패 시 StageError throw
 *
 * @param {object} supabase
 * @param {string} sessionId
 * @param {Array} savedProblems - { id, index_in_image }
 * @param {Array} validatedItems - AI 추출 아이템
 * @param {Map} taxonomyByDepthKey - depth1␟depth2␟depth3␟depth4 → { code, cefr, difficulty }
 * @param {Map} taxonomyByCode - code → { depth1~4, code, cefr, difficulty }
 */
export async function saveLabels(supabase, sessionId, savedProblems, validatedItems, taxonomyByDepthKey, taxonomyByCode) {
  const idByIndex = new Map();
  for (const row of savedProblems) {
    if (idByIndex.has(row.index_in_image)) {
      console.error(`[dbOperations:saveLabels] 중복 index_in_image 감지: ${row.index_in_image}`, { sessionId, problemId: row.id });
    }
    idByIndex.set(row.index_in_image, row.id);
  }

  const labelsPayload = [];

  for (let idx = 0; idx < validatedItems.length; idx++) {
    const it = validatedItems[idx];
    const problemId = idByIndex.get(idx);
    if (!problemId) {
      console.error(`[dbOperations:saveLabels] index ${idx}에 대한 problem_id 없음`, {
        sessionId,
        idByIndexSize: idByIndex.size,
        idByIndexKeys: Array.from(idByIndex.keys()),
        itemsLength: validatedItems.length,
      });
      continue;
    }

    // ─── is_correct 판정 ───
    // 1차: 시험지의 O/X 채점 마크 (user_marked_correctness) 기반
    // 2차: 마크 없으면 user_answer vs correct_answer 자동 비교
    const rawMark = it.user_marked_correctness;
    let isCorrect = null;

    if (rawMark != null && String(rawMark).trim() !== '') {
      // O/X 마크가 존재하는 경우
      const normalized = normalizeMark(rawMark);
      if (normalized === 'O') isCorrect = true;
      else if (normalized === 'X') isCorrect = false;
      // 'Unknown'이면 null 유지
    }

    // 자동 채점: O/X 마크가 없고, user_answer와 correct_answer가 모두 있으면 비교
    if (isCorrect === null) {
      const userAns = String(it.user_answer || '').trim();
      const correctAns = String(it.correct_answer || '').trim();
      const choices = Array.isArray(it.choices) ? it.choices : [];
      const isObjective = choices.length > 0;

      if (userAns && correctAns) {
        let userNum = parseAnswerNumber(userAns);
        let correctNum = parseAnswerNumber(correctAns);

        // 객관식 fallback: parseAnswerNumber 실패 시 choices에서 단어 매칭으로 번호 복원
        // 예: "다음 글의 밑줄 친 부분 중..." 문제에서 correct_answer가 "appear" 같은 단어로 들어온 경우
        if (isObjective) {
          if (userNum === null) {
            const mapped = mapWordToChoiceNumber(userAns, choices);
            if (mapped !== null) {
              userNum = mapped;
              console.log(`[dbOperations:saveLabels] Q${it.problem_number} user_answer "${userAns}" → choice #${mapped}`);
            }
          }
          if (correctNum === null) {
            const mapped = mapWordToChoiceNumber(correctAns, choices);
            if (mapped !== null) {
              correctNum = mapped;
              console.log(`[dbOperations:saveLabels] Q${it.problem_number} correct_answer "${correctAns}" → choice #${mapped}`);
            }
          }
        }

        if (userNum !== null && correctNum !== null) {
          isCorrect = userNum === correctNum;
        } else {
          // 숫자 파싱 불가 시 문자열 비교 (서술형 등)
          isCorrect = userAns.toLowerCase() === correctAns.toLowerCase();
        }
      }
    }

    // ─── taxonomy 보강 ───
    const classification = it.classification || {};

    const rawDepth1 = cleanOrNull(classification.depth1);
    const rawDepth2 = cleanOrNull(classification.depth2);
    const rawDepth3 = cleanOrNull(classification.depth3);
    const rawDepth4 = cleanOrNull(classification.depth4);
    const rawCode = cleanOrNull(classification.code);

    let depth1 = rawDepth1;
    let depth2 = rawDepth2;
    let depth3 = rawDepth3;
    let depth4 = rawDepth4;

    let taxonomyCode = null;
    let taxonomyCefr = null;
    let taxonomyDifficulty = null;

    // 1) depth1~4가 모두 있으면 → depth로 code/cefr/difficulty 조회
    const hasAnyDepth = !!(depth1 || depth2 || depth3 || depth4);
    const hasAllDepth = !!(depth1 && depth2 && depth3 && depth4);

    if (hasAllDepth) {
      const mapped = taxonomyByDepthKey.get(makeDepthKey(depth1, depth2, depth3, depth4));
      taxonomyCode = mapped?.code ?? null;
      taxonomyCefr = mapped?.cefr ?? null;
      taxonomyDifficulty = mapped?.difficulty ?? null;
      if (!taxonomyCode) {
        console.warn(`[dbOperations:saveLabels] Taxonomy mapping 실패: ${depth1}/${depth2}/${depth3}/${depth4}`);
        depth1 = depth2 = depth3 = depth4 = null;
      }
    } else if (hasAnyDepth) {
      console.warn(`[dbOperations:saveLabels] 부분 depth 제공, 전체 null 처리: ${depth1}/${depth2}/${depth3}/${depth4}`);
      depth1 = depth2 = depth3 = depth4 = null;
    }

    // 2) depth가 없고 code만 있으면 → code로 depth 역방향 복원
    if (!taxonomyCode && rawCode) {
      const mapped = taxonomyByCode.get(rawCode);
      if (mapped) {
        taxonomyCode = mapped.code ?? null;
        taxonomyCefr = mapped.cefr ?? null;
        taxonomyDifficulty = mapped.difficulty ?? null;
        depth1 = mapped.depth1 ?? null;
        depth2 = mapped.depth2 ?? null;
        depth3 = mapped.depth3 ?? null;
        depth4 = mapped.depth4 ?? null;
      } else {
        console.warn(`[dbOperations:saveLabels] 유효하지 않은 taxonomy code: "${rawCode}"`);
      }
    }

    const enrichedClassification = {
      depth1,
      depth2,
      depth3,
      depth4,
      code: taxonomyCode,
      CEFR: taxonomyCefr,
      난이도: taxonomyDifficulty,
    };

    labelsPayload.push({
      problem_id: problemId,
      user_answer: it.user_answer || null,
      user_mark: null,
      is_correct: isCorrect,
      correct_answer: it.correct_answer || null,
      classification: enrichedClassification,
    });
  }

  if (labelsPayload.length === 0) {
    console.warn('[dbOperations:saveLabels] 저장할 라벨이 없습니다', { sessionId });
  } else {
    console.log(`[dbOperations:saveLabels] ${labelsPayload.length}개 라벨 저장 시작`, { sessionId });
    const { error: labelsError } = await supabase.from('labels').insert(labelsPayload);
    if (labelsError) {
      console.error('[dbOperations:saveLabels] labels insert 실패:', JSON.stringify(labelsError), {
        sessionId,
        validLabelsPayloadCount: labelsPayload.length,
      });
      throw new StageError('insert_labels', 'Labels insert failed', { validLabelsPayloadCount: labelsPayload.length });
    }
    console.log(`[dbOperations:saveLabels] ${labelsPayload.length}개 라벨 저장 완료`, { sessionId });
  }
}

// ─── 메타데이터 업데이트 (난이도 양방향 정규화) ─────────────
// 원본: index.ts:261-279

/**
 * 문제별 메타데이터 업데이트 (난이도, 어휘 난이도, 분석)
 * 난이도를 영어↔한국어 양방향으로 정규화한다.
 */
function normalizeDifficulty(difficulty, userLanguage) {
  if (userLanguage === 'en') {
    const valid = ['high', 'medium', 'low'];
    if (valid.includes(difficulty || '')) return difficulty;
    if (difficulty === '상') return 'high';
    if (difficulty === '중') return 'medium';
    if (difficulty === '하') return 'low';
    return 'medium';
  } else {
    const valid = ['상', '중', '하'];
    if (valid.includes(difficulty || '')) return difficulty;
    if (difficulty === 'high') return '상';
    if (difficulty === 'medium') return '중';
    if (difficulty === 'low') return '하';
    return '중';
  }
}

/**
 * 메타데이터 N개 UPDATE + sessions.status='completed' 를 단일 RPC로 atomic 처리.
 * 기존 Promise.all 병렬 UPDATE는 PgBouncer transaction pooling 환경에서 한 UPDATE의
 * 실패가 같은 backend connection의 다른 transaction을 25P02 (current transaction is aborted)
 * cascade 시키는 문제가 있었음. 단일 PL/pgSQL 트랜잭션 RPC로 원천 차단.
 */
export async function finalizeAnalysisSession(supabase, sessionId, analysisModel, savedProblems, validatedItems, userLanguage) {
  const problemUpdates = [];
  for (const problem of savedProblems) {
    const originalItem = validatedItems[problem.index_in_image];
    if (!originalItem) continue;

    const meta = originalItem.metadata || {};
    const cls = originalItem.classification || {};

    const typeParts = [cls.depth1, cls.depth2, cls.depth3, cls.depth4]
      .filter((v) => typeof v === 'string' && v.trim().length > 0);
    const problemType = typeParts.length > 0
      ? typeParts.join(' - ')
      : (userLanguage === 'ko' ? '분류 없음' : 'Unclassified');

    const difficulty = normalizeDifficulty(meta.difficulty, userLanguage);
    const wdNum = Number(meta.word_difficulty);
    const wordDifficulty = (!isNaN(wdNum) && wdNum >= 1 && wdNum <= 9) ? Math.round(wdNum) : 5;

    problemUpdates.push({
      id: problem.id,
      metadata: {
        difficulty,
        word_difficulty: wordDifficulty,
        problem_type: problemType,
        analysis: meta.analysis || '',
      },
    });
  }

  console.log(`[dbOperations:finalizeAnalysisSession] RPC 호출`, { sessionId, problemCount: problemUpdates.length });

  const { data, error } = await supabase.rpc('finalize_analysis_session', {
    p_session_id: sessionId,
    p_analysis_model: analysisModel,
    p_problem_updates: problemUpdates,
  });

  if (error) {
    console.error(`[dbOperations:finalizeAnalysisSession] RPC 실패`, { sessionId, error });
    throw error;
  }

  // idempotency 분기 처리 (RPC가 already_finalized/session_not_found 반환 가능)
  if (data?.reason === 'session_not_found') {
    console.error(`[dbOperations:finalizeAnalysisSession] 세션 없음`, { sessionId });
    throw new Error(`finalize: session ${sessionId} not found`);
  }
  if (data?.reason === 'already_finalized') {
    console.warn(`[dbOperations:finalizeAnalysisSession] 중복 호출 감지 (no-op)`, { sessionId, current_status: data.current_status });
    return data;
  }

  console.log(`[dbOperations:finalizeAnalysisSession] 완료`, { sessionId, result: data });
  return data;
}
