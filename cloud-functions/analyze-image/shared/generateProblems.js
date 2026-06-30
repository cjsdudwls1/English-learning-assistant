/**
 * 문제 생성 핸들러 (1+3 패턴)
 * - 지문 모드: 첫 유형으로 passage 추출 → 나머지 유형 병렬 호출
 * - 비지문 모드: 모든 유형 병렬 호출
 * - generated_problems 테이블에 INSERT
 */

import { generateWithRetry, extractTextFromResponse, parseJsonResponse } from './aiClient.js';
import { MODEL_SEQUENCE, MODEL_RETRY_POLICY } from './config.js';
import { buildProblemPrompt, PROBLEM_TYPES } from './problemPrompts.js';

const GENERATION_TEMPERATURE = 0.7;

/**
 * 단일 유형 문제 생성 (MODEL_SEQUENCE failover)
 */
async function generateSingleType(ai, request, sessionId) {
  const prompt = buildProblemPrompt(request);
  const contents = [{ role: 'user', parts: [{ text: prompt }] }];

  const lastErrors = [];
  for (const model of MODEL_SEQUENCE) {
    const policy = MODEL_RETRY_POLICY[model] || { maxRetries: 1, baseDelayMs: 3000 };
    try {
      const { response } = await generateWithRetry({
        ai,
        model,
        contents,
        sessionId,
        maxRetries: policy.maxRetries,
        baseDelayMs: policy.baseDelayMs,
        temperature: GENERATION_TEMPERATURE,
      });
      const text = extractTextFromResponse(response, model);
      const parsed = parseJsonResponse(text, model);
      let problems = Array.isArray(parsed) ? parsed : [parsed];

      if (request.sharedPassage) {
        problems.forEach(p => { p.passage = request.sharedPassage; });
      }

      return { model, problems };
    } catch (err) {
      lastErrors.push({ model, error: err?.message });
      console.warn(`[generateProblems] ${model} 실패, 다음 모델 시도:`, err?.message);
    }
  }

  throw new Error(`All models failed for ${request.problemType}: ${JSON.stringify(lastErrors)}`);
}

/**
 * 문제 유형별 필드 매퍼 디스패치 테이블
 * 새 유형 추가 시 이 테이블에 항목만 추가하면 됨
 */
const PROBLEM_TYPE_MAPPERS = {
  multiple_choice: (problem, base) => {
    const rawChoices = problem.choices || [];
    base.choices = rawChoices.map(c => ({
      text: c.text || '',
      is_correct: c.is_correct === true || c.is_correct === 'true' || c.isCorrect === true,
    }));
    base.correct_answer_index = base.choices.findIndex(c => c.is_correct);
    if (base.correct_answer_index === -1) {
      console.error(
        `[generateProblems] multiple_choice: 정답 선택지 없음 (stem: "${base.stem?.slice(0, 40)}") → 문제 skip`,
        { choices: base.choices }
      );
      return null;
    }
    base.explanation = problem.explanation || null;
    // 오답별 해설: AI가 wrong_explanation(단수, DB 컬럼) 또는 wrong_explanations(복수)로 반환 가능 → 정규화 후 단수 컬럼에 저장
    base.wrong_explanation = problem.wrong_explanation || problem.wrong_explanations || null;
    return base;
  },
  short_answer: (problem, base) => {
    base.correct_answer = problem.correct_answer || '';
    base.acceptable_answers = problem.acceptable_answers || [];
    base.explanation = problem.explanation || null;
    return base;
  },
  essay: (problem, base) => {
    base.guidelines = problem.guidelines || '';
    base.sample_answer = problem.sample_answer || '';
    base.grading_criteria = problem.grading_criteria || [];
    base.explanation = problem.explanation || null;
    return base;
  },
  ox: (problem, base) => {
    base.correct_answer = String(problem.correct_answer);
    base.explanation = problem.explanation || null;
    return base;
  },
};

/**
 * 문제 객체를 generated_problems 레코드로 매핑
 * 유형 매퍼가 없거나 null 반환 시 null 반환 (호출자가 필터링)
 */
function buildProblemRecord(problem, request) {
  const base = {
    user_id: request.userId,
    problem_type: request.problemType,
    stem: problem.stem || '',
    source_classification: request.classification || null,
    classification: request.classification || null,
    passage: problem.passage || null,
  };

  const mapper = PROBLEM_TYPE_MAPPERS[request.problemType];
  if (!mapper) {
    console.error(`[generateProblems] 알 수 없는 problem_type: ${request.problemType} → skip`);
    return null;
  }
  return mapper(problem, base);
}

/**
 * generated_problems 테이블에 일괄 INSERT
 */
async function saveProblems(supabase, problems, request) {
  const records = problems.map(p => buildProblemRecord(p, request)).filter(r => r !== null);
  if (records.length === 0) {
    console.warn(`[generateProblems] INSERT 건너뜀 — 유효 레코드 없음 (${request.problemType})`);
    return [];
  }
  const { data, error } = await supabase
    .from('generated_problems')
    .insert(records)
    .select('id');
  if (error) {
    console.error(`[generateProblems] INSERT 실패 (${request.problemType}):`, error.message);
    throw error;
  }
  return data || [];
}

/**
 * 진행 상태 마커 갱신 (Realtime 알림용)
 */
async function setStatus(supabase, userId, status, extra = {}) {
  try {
    await supabase
      .from('problem_generation_status')
      .upsert({
        user_id: userId,
        status,
        updated_at: new Date().toISOString(),
        ...extra,
      }, { onConflict: 'user_id' });
  } catch (e) {
    console.warn('[generateProblems] 상태 저장 실패:', e?.message);
  }
}

/**
 * 유형 배열을 병렬 생성 후 성공한 ID 반환
 */
async function runParallelTypes(ai, supabase, types, buildReq, sessionId, allInsertedIds) {
  const results = await Promise.allSettled(
    types.map(async t => {
      const req = buildReq(t);
      const result = await generateSingleType(ai, req, sessionId);
      const saved = await saveProblems(supabase, result.problems, req);
      return saved.map(r => r.id);
    })
  );
  results.forEach((r, idx) => {
    if (r.status === 'fulfilled') {
      allInsertedIds.push(...r.value);
    } else {
      console.error(`[generateProblems] ${types[idx].problemType} 실패:`, r.reason?.message);
    }
  });
}

/**
 * 전체 유형 문제 생성 (메인 엔트리)
 * @param {object} supabase - service role 클라이언트
 * @param {object} ai - GoogleGenAI 인스턴스
 * @param {object} request - { userId, language, classification, types: [{ problemType, problemCount }], ...aiOptions }
 * @param {string} sessionId - 로깅용
 */
export async function generateAllProblemTypes(supabase, ai, request, sessionId) {
  const { userId, language, classification, types, ...aiOptions } = request;

  if (!Array.isArray(types) || types.length === 0) {
    throw new Error('types 배열이 비어있습니다');
  }

  console.log(`[generateProblems] 시작: userId=${userId}, types=${types.map(t => t.problemType).join(',')}, sessionId=${sessionId}`);
  await setStatus(supabase, userId, 'generating', { error_message: null });

  const isPassageMode = aiOptions.includePassage === true && !aiOptions.sharedPassage;
  let sharedPassage = aiOptions.sharedPassage || null;

  const buildReq = (t, passage = sharedPassage) => ({
    problemType: t.problemType,
    problemCount: t.problemCount,
    userId,
    language,
    classification,
    ...aiOptions,
    ...(passage ? { sharedPassage: passage } : {}),
  });

  const allInsertedIds = [];

  try {
    if (isPassageMode) {
      // 1단계: 첫 유형으로 passage 추출
      const firstType = types[0];
      console.log(`[generateProblems] Pass 1: ${firstType.problemType}로 passage 추출`);
      const firstResult = await generateSingleType(ai, buildReq(firstType, null), sessionId);
      const firstSaved = await saveProblems(supabase, firstResult.problems, buildReq(firstType, null));
      allInsertedIds.push(...firstSaved.map(r => r.id));

      sharedPassage = firstResult.problems[0]?.passage || null;
      if (!sharedPassage) {
        console.warn('[generateProblems] passage 추출 실패, sharedPassage 없이 진행');
      } else {
        console.log(`[generateProblems] passage 추출 완료 (${sharedPassage.length}자)`);
      }

      // 2단계: 나머지 유형 병렬 처리
      const restTypes = types.slice(1);
      if (restTypes.length > 0) {
        console.log(`[generateProblems] Pass 2: ${restTypes.map(t => t.problemType).join(',')} 병렬 생성`);
        await runParallelTypes(ai, supabase, restTypes, t => buildReq(t, sharedPassage), sessionId, allInsertedIds);
      }
    } else {
      // 비지문 모드: 모든 유형 병렬
      console.log(`[generateProblems] 병렬 모드: ${types.length}개 유형`);
      await runParallelTypes(ai, supabase, types, t => buildReq(t, sharedPassage), sessionId, allInsertedIds);
    }

    const finalStatus = allInsertedIds.length > 0 ? 'completed' : 'error';
    await setStatus(supabase, userId, finalStatus, {
      error_message: allInsertedIds.length === 0 ? '모든 문제 유형 생성 실패' : null,
    });

    console.log(`[generateProblems] 완료: ${allInsertedIds.length}개 문제 저장`);
    return { count: allInsertedIds.length, problemIds: allInsertedIds, passage: sharedPassage };
  } catch (err) {
    console.error('[generateProblems] 치명적 오류:', err?.message);
    await setStatus(supabase, userId, 'error', { error_message: err?.message || 'Unknown error' });
    throw err;
  }
}
