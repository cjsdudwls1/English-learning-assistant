// pageAnalyzer.ts — 단일 페이지 분석 오케스트레이터
// Pass A + Pass 0 병렬 → 서버 크롭 → Pass B(크롭별) → Pass C

import { buildPrompt, buildBoundingBoxPrompt, buildCroppedUserAnswerPrompt, buildCroppedCorrectAnswerPrompt, buildHandwritingDetectionPrompt, buildClassificationPrompt } from './prompts.ts';
import { analyzeImagesWithFailover, detectBoundingBoxes, detectHandwritingFromCroppedImages, detectHandwritingMarks, classifyItems } from './analysisProcessor.ts';
import { cropDualRegions } from './imageCropper.ts';
import { StageError } from '../../_shared/errors.ts';
import type { TaxonomyByDepthKey, TaxonomyByCode } from './validation.ts';

// ─── 타입 정의 ─────────────────────────────────────────────

export interface PageAnalysisParams {
  ai: any;
  supabase: any;
  sessionId: string;
  imageData: { imageBase64: string; mimeType: string };
  pageNum: number;
  totalPages: number;
  taxonomyData: any;
  taxonomyByDepthKey: TaxonomyByDepthKey;
  taxonomyByCode: TaxonomyByCode;
  userLanguage: 'ko' | 'en';
  preferredModel?: string;
}

export interface PageAnalysisResult {
  pageItems: any[];
  pageResult: any;
  pageModel: string;
  pageUsage: any;
}

// ─── Pass B 결과 병합 (marks → items) ──────────────────────

/**
 * Pass B marks를 검증하고 pageItems에 병합한다.
 * - 객관식(선택지 1~5)의 경우 범위 밖이면 폐기
 * - 주관식/서술형/O/X는 자유 텍스트 허용
 * - user_answer 및 correct_answer 모두 병합
 */
function mergeHandwritingMarks(
  pageItems: any[],
  marks: any[],
  sessionId: string,
): void {
  if (marks.length === 0) return;

  // 진단 로그: 필터링 전 전체 marks 출력
  console.log(`[Pass B] Raw marks BEFORE filtering:`, {
    sessionId,
    marks: marks.map(m =>
      `Q${m.problem_number}: user_answer=${m.user_answer}, correct_answer=${m.correct_answer ?? 'N/A'}`
    ),
  });

  for (const mark of marks) {
    // 선택지 범위 초과 검증: 객관식인 경우만 유효한 선택지 번호(1~5) 체크
    if (mark.user_answer) {
      const ansNum = parseInt(mark.user_answer, 10);
      // 숫자 1~5가 아니지만 짧은 텍스트(주관식/서술형)일 수 있으므로,
      // 순수 숫자인데 범위 밖인 경우만 폐기
      if (!isNaN(ansNum) && String(ansNum) === String(mark.user_answer).trim() && (ansNum < 1 || ansNum > 5)) {
        console.log(`[Pass B] Q${mark.problem_number}: answer "${mark.user_answer}" is a number out of choice range (1-5) → discarded`);
        mark.user_answer = null;
        mark.ambiguous = true;
      }
    }
  }

  // problem_number → mark 데이터 매핑 (user_answer + correct_answer)
  const markMap = new Map<string, {
    user_answer: string | null;
    correct_answer: string | null;
    user_marked_correctness: string | null;
  }>();
  for (const mark of marks) {
    markMap.set(String(mark.problem_number), {
      user_answer: mark.user_answer,
      correct_answer: (mark as any).correct_answer || null,
      user_marked_correctness: mark.user_marked_correctness || null,
    });
  }

  for (const item of pageItems) {
    const pNum = String(item.problem_number || '');
    const match = markMap.get(pNum);
    if (match) {
      item.user_answer = match.user_answer;
      item.correct_answer = match.correct_answer;
      item.user_marked_correctness = match.user_marked_correctness;
    }
  }

  console.log(`[Background] Step 3 Merge B: ${marks.length} mark(s) processed`, {
    sessionId,
    mergeDetails: marks.map(m =>
      `Q${m.problem_number}: user=${m.user_answer ?? 'null'}, correct=${m.correct_answer ?? 'null'}`
    ),
  });
}

// ─── Pass C 결과 병합 (classification → items) ─────────────

function mergeClassifications(
  pageItems: any[],
  classifications: any[],
  sessionId: string,
): void {
  if (classifications.length === 0) return;

  // Pass C는 classification + metadata만 반환 (correct_answer는 Pass B에서 설정됨)
  const classMap = new Map<string, { classification: any; metadata: any }>();
  for (const cls of classifications) {
    classMap.set(String(cls.problem_number), {
      classification: cls.classification,
      metadata: cls.metadata,
    });
  }

  for (const item of pageItems) {
    const pNum = String(item.problem_number || '');
    const match = classMap.get(pNum);
    if (match) {
      item.classification = match.classification;
      item.metadata = match.metadata;
      // correct_answer는 Pass B에서 설정된 값을 보존 (Pass C는 해당 필드를 반환하지 않음)
    }
  }

  console.log(`[Background] Step 3 Merge C: ${classifications.length} classification(s) merged`, { sessionId });
}


// ─── Pass C용 itemsSummary 생성 ────────────────────────────

function buildItemsSummary(pageItems: any[]): string {
  return pageItems.map((it: any) => {
    const instruction = it.instruction || it.question_text || it.stem || '';
    const passage = (it._resolved_passage || it.passage || '').substring(0, 1500);
    const choicesText = (it.choices || []).map((c: any) => {
      const text = typeof c === 'string' ? c : (c?.text || '');
      return text.substring(0, 200);
    }).join(' / ');
    // visual_context 정보도 포함 (그래프/도표/안내문 등)
    let visualInfo = '';
    if (it.visual_context) {
      const vc = it.visual_context;
      visualInfo = `\nVisual context [${vc.type || 'visual'}]: ${vc.title || ''}\n${(vc.content || '').substring(0, 500)}`;
    }
    return `### Problem ${it.problem_number}\nInstruction: ${instruction}\nPassage: ${passage}${visualInfo}\nChoices: ${choicesText}`;
  }).join('\n\n');
}

// ─── 토큰 사용량 합산 ──────────────────────────────────────

function sumUsage(base: any, ...extras: (any | undefined)[]): any {
  const result = base ? { ...base } : {};
  for (const usage of extras) {
    if (!usage) continue;
    (result as any).promptTokenCount = ((result as any).promptTokenCount || 0) + (usage.promptTokenCount || 0);
    (result as any).candidatesTokenCount = ((result as any).candidatesTokenCount || 0) + (usage.candidatesTokenCount || 0);
    (result as any).totalTokenCount = ((result as any).totalTokenCount || 0) + (usage.totalTokenCount || 0);
  }
  return result;
}

// ─── 분리 함수 1: 구조 + 좌표 추출 전용 (mode: extract) ─────

export interface ExtractResult {
  pageItems: any[];
  pageResult: any;
  pageModel: string;
  pageUsage: any;
  bboxes: any[] | null;
}

/**
 * Pass A (구조 추출) + Pass 0 (좌표 추출)만 수행하고 결과를 반환한다.
 * 크롭은 하지 않으므로 CPU 부담이 없다.
 */
export async function extractStructureAndBboxes(params: PageAnalysisParams): Promise<ExtractResult | null> {
  const {
    ai, supabase, sessionId,
    imageData, pageNum, totalPages,
    taxonomyData, taxonomyByDepthKey, taxonomyByCode,
    userLanguage, preferredModel,
  } = params;

  if (!imageData?.imageBase64 || imageData.imageBase64.length === 0) {
    console.warn(`[Extract] Page ${pageNum} has no image data, skipping`, { sessionId });
    return null;
  }

  try {
    const pagePrompt = buildPrompt(taxonomyData, userLanguage, 1);
    const pageParts: any[] = [
      { text: pagePrompt },
      { text: `Page ${pageNum} of ${totalPages}. Extract all printed text and structure from this exam page image.` },
      { inlineData: { data: imageData.imageBase64, mimeType: imageData.mimeType } },
    ];

    const bboxPrompt = buildBoundingBoxPrompt();
    const imagePart = { inlineData: { data: imageData.imageBase64, mimeType: imageData.mimeType } };

    console.log(`[Extract] Pass A+Pass0: Page ${pageNum}/${totalPages} - parallel execution start`, { sessionId });

    const [pageAnalysisResult, bboxResult] = await Promise.all([
      analyzeImagesWithFailover({
        ai, supabase, sessionId,
        parts: pageParts,
        imageCount: 1,
        taxonomyByDepthKey, taxonomyByCode, preferredModel,
      }),
      detectBoundingBoxes({
        ai, sessionId,
        prompt: bboxPrompt,
        imageParts: [imagePart],
      }),
    ]);

    const { usedModel: pageModel, result: pageResult, validatedItems: pageItems, usageMetadata: pageUsage } = pageAnalysisResult;
    console.log(`[Extract] Pass A: Page ${pageNum} done with ${pageModel}, items: ${pageItems.length}`, { sessionId });
    console.log(`[Extract] Pass 0: Page ${pageNum} done, bboxes: ${bboxResult?.problems?.length ?? 0}`, { sessionId });

    return {
      pageItems,
      pageResult,
      pageModel,
      pageUsage,
      bboxes: bboxResult?.problems ?? null,
    };
  } catch (err: any) {
    console.error(`[Extract] Page ${pageNum} FAILED`, {
      sessionId,
      error: err?.message || String(err),
    });
    return null;
  }
}

// ─── 분리 함수 2: 크롭된 이미지로 Pass B + C (mode: analyze) ──

export interface AnalyzeWithCropsParams {
  ai: any;
  supabase: any;
  sessionId: string;
  pageItems: any[];
  answerAreaCrops: Array<{ problem_number: string; croppedBase64: string; mimeType: string }>;
  fullCrops: Array<{ problem_number: string; croppedBase64: string; mimeType: string }>;
  taxonomyData: any;
  userLanguage: 'ko' | 'en';
  imageBase64ForClassification?: string;
  imageMimeType?: string;
}

/**
 * 클라이언트에서 크롭된 이미지를 받아 Pass B (필기 인식) + Pass C (분류) 수행.
 * 이미지 크롭을 하지 않으므로 CPU 부담이 없다.
 */
export async function analyzeWithCroppedImages(params: AnalyzeWithCropsParams): Promise<{
  marks: any[];
  classifications: any[];
  usageMetadata: any;
} | null> {
  const {
    ai, sessionId,
    pageItems, answerAreaCrops, fullCrops,
    taxonomyData, userLanguage,
    imageBase64ForClassification, imageMimeType,
  } = params;

  try {
    // ─── Pass B: 크롭된 이미지별 필기 인식 (병렬) ───
    console.log(`[Analyze] Pass B: Processing ${answerAreaCrops.length} answer + ${fullCrops.length} full crops`, { sessionId });

    const [userAnswerResult, correctAnswerResult] = await Promise.all([
      detectHandwritingFromCroppedImages({
        ai, sessionId,
        croppedImages: answerAreaCrops,
        buildPromptFn: buildCroppedUserAnswerPrompt,
      }),
      fullCrops.length > 0
        ? detectHandwritingFromCroppedImages({
            ai, sessionId,
            croppedImages: fullCrops,
            buildPromptFn: buildCroppedCorrectAnswerPrompt,
          })
        : Promise.resolve({ marks: [], usageMetadata: undefined }),
    ]);

    // user_answer + correct_answer 병합
    const mergedMarks: any[] = userAnswerResult.marks.map(ua => {
      const ca = correctAnswerResult.marks.find(m => m.problem_number === ua.problem_number);
      return {
        problem_number: ua.problem_number,
        user_answer: ua.user_answer,
        correct_answer: ca?.correct_answer ?? null,
      };
    });

    for (const ca of correctAnswerResult.marks) {
      if (!mergedMarks.find(m => m.problem_number === ca.problem_number)) {
        mergedMarks.push({
          problem_number: ca.problem_number,
          user_answer: null,
          correct_answer: ca.correct_answer,
        });
      }
    }

    console.log(`[Analyze] Pass B merged: ${mergedMarks.length} marks`, { sessionId });

    // ─── Pass C: 분류/메타데이터 추론 ───
    const itemsSummary = buildItemsSummary(pageItems);
    const classificationPrompt = buildClassificationPrompt(taxonomyData, itemsSummary, userLanguage);
    const hasVisualItems = pageItems.some((it: any) => it.visual_context);
    const classifyImageParts = hasVisualItems && imageBase64ForClassification
      ? [{ inlineData: { data: imageBase64ForClassification, mimeType: imageMimeType || 'image/jpeg' } }]
      : undefined;

    console.log(`[Analyze] Pass C: Classifying ${pageItems.length} items`, { sessionId });

    const classificationResult = await classifyItems({
      ai, sessionId,
      prompt: classificationPrompt,
      imageParts: classifyImageParts,
    });

    console.log(`[Analyze] Pass C done: ${classificationResult.classifications.length} classifications`, { sessionId });

    const combinedUsage = sumUsage(
      userAnswerResult.usageMetadata,
      correctAnswerResult.usageMetadata,
      classificationResult.usageMetadata,
    );

    return {
      marks: mergedMarks,
      classifications: classificationResult.classifications,
      usageMetadata: combinedUsage,
    };
  } catch (err: any) {
    console.error(`[Analyze] Pass B+C FAILED`, {
      sessionId,
      error: err?.message || String(err),
    });
    return null;
  }
}

// ─── 메인 함수: 단일 페이지 4-Pass 분석 (하위 호환) ─────────

/**
 * 단일 페이지에 대해 3-Pass 분석을 수행한다.
 *
 * 1. (Pass A + Pass B): 병렬 실행 — 구조 추출과 필기 감지/문제 풀이를 동시에 수행
 * 2. Pass C: Pass A 결과 기반으로 분류/메타데이터 생성
 *
 * 각 Pass 결과를 problem_number 기준으로 병합하여 반환한다.
 * 실패 시 null을 반환하여 전체 파이프라인을 중단하지 않는다.
 */
export async function analyzeOnePage(params: PageAnalysisParams): Promise<PageAnalysisResult | null> {
  const {
    ai, supabase, sessionId,
    imageData, pageNum, totalPages,
    taxonomyData, taxonomyByDepthKey, taxonomyByCode,
    userLanguage, preferredModel,
  } = params;

  if (!imageData?.imageBase64 || imageData.imageBase64.length === 0) {
    console.warn(`[Background] Step 3: Page ${pageNum} has no image data, skipping`, { sessionId });
    return null;
  }

  try {
    // ─── Pass A 준비: 구조 추출 전용 ───
    const pagePrompt = buildPrompt(taxonomyData, userLanguage, 1);
    const pageParts: any[] = [
      { text: pagePrompt },
      { text: `Page ${pageNum} of ${totalPages}. Extract all printed text and structure from this exam page image.` },
      { inlineData: { data: imageData.imageBase64, mimeType: imageData.mimeType } },
    ];

    // ─── Pass 0 준비: 바운딩 박스 검출 ───
    const bboxPrompt = buildBoundingBoxPrompt();
    const imagePart = { inlineData: { data: imageData.imageBase64, mimeType: imageData.mimeType } };

    console.log(`[Background] Step 3 Pass A+Pass0: Page ${pageNum}/${totalPages} - parallel execution start`, { sessionId });

    // ─── Pass A + Pass 0: 병렬 실행 ───
    const [pageAnalysisResult, bboxResult] = await Promise.all([
      analyzeImagesWithFailover({
        ai,
        supabase,
        sessionId,
        parts: pageParts,
        imageCount: 1,
        taxonomyByDepthKey,
        taxonomyByCode,
        preferredModel,
      }),
      detectBoundingBoxes({
        ai,
        sessionId,
        prompt: bboxPrompt,
        imageParts: [imagePart],
      }),
    ]);

    const { usedModel: pageModel, result: pageResult, validatedItems: pageItems, usageMetadata: pageUsage } = pageAnalysisResult;
    console.log(`[Background] Step 3 Pass A: Page ${pageNum} done with ${pageModel}, items: ${pageItems.length}`, { sessionId });

    // ─── Pass B: 두 종류 크롭(답안 영역 + 전체 문제) 병렬 수행 ───
    let handwritingResult: { marks: any[]; usageMetadata?: any };

    if (bboxResult && bboxResult.problems.length > 0) {
      console.log(`[Background] Step 3 Pass 0: Page ${pageNum} done, bboxes: ${bboxResult.problems.length}`, { sessionId });

      try {
        // 두 종류 크롭 1회 수행: 답안 영역 + 전체 문제
        const { answerAreaCrops, fullCrops } = await cropDualRegions(
          imageData.imageBase64,
          imageData.mimeType,
          bboxResult.problems,
        );
        console.log(`[Background] Step 3 Crop: Page ${pageNum} - answer: ${answerAreaCrops.length}, full: ${fullCrops.length}`, { sessionId });

        // 병렬 처리: 답안 영역 → user_answer, 전체 문제 → correct_answer
        const [userAnswerResult, correctAnswerResult] = await Promise.all([
          detectHandwritingFromCroppedImages({
            ai,
            sessionId,
            croppedImages: answerAreaCrops,
            buildPromptFn: buildCroppedUserAnswerPrompt,
          }),
          fullCrops.length > 0
            ? detectHandwritingFromCroppedImages({
                ai,
                sessionId,
                croppedImages: fullCrops,
                buildPromptFn: buildCroppedCorrectAnswerPrompt,
              })
            : Promise.resolve({ marks: [], usageMetadata: undefined }),
        ]);

        // 결과 병합: user_answer + correct_answer를 problem_number로 매칭
        const mergedMarks: any[] = userAnswerResult.marks.map(ua => {
          const ca = correctAnswerResult.marks.find(m => m.problem_number === ua.problem_number);
          return {
            problem_number: ua.problem_number,
            user_answer: ua.user_answer,
            correct_answer: ca?.correct_answer ?? null,
          };
        });

        // correct_answer만 있고 user_answer 결과가 없는 문제 추가
        for (const ca of correctAnswerResult.marks) {
          if (!mergedMarks.find(m => m.problem_number === ca.problem_number)) {
            mergedMarks.push({
              problem_number: ca.problem_number,
              user_answer: null,
              correct_answer: ca.correct_answer,
            });
          }
        }

        console.log(`[Background] Step 3 Pass B merged: ${mergedMarks.length} marks (user: ${userAnswerResult.marks.length}, correct: ${correctAnswerResult.marks.length})`, { sessionId });

        handwritingResult = {
          marks: mergedMarks,
          usageMetadata: userAnswerResult.usageMetadata || correctAnswerResult.usageMetadata,
        };
      } catch (cropError) {
        console.error(`[Background] Step 3 Crop failed, falling back to full image:`, (cropError as Error).message, { sessionId });
        const handwritingPrompt = buildHandwritingDetectionPrompt(totalPages);
        handwritingResult = await detectHandwritingMarks({
          ai,
          sessionId,
          prompt: handwritingPrompt,
          imageParts: [imagePart],
        });
      }
    } else {
      // 바운딩 박스 실패 → 기존 코드 실행 방식으로 폴백
      console.log(`[Background] Step 3 Pass 0: No bboxes found, falling back to full image analysis`, { sessionId });
      const handwritingPrompt = buildHandwritingDetectionPrompt(totalPages);
      handwritingResult = await detectHandwritingMarks({
        ai,
        sessionId,
        prompt: handwritingPrompt,
        imageParts: [imagePart],
      });
    }

    console.log(`[Background] Step 3 Pass B: Page ${pageNum} done, marks: ${handwritingResult.marks.length}`, { sessionId });

    // ─── Pass C: Pass A 텍스트 기반 분류 ───
    const itemsSummary = buildItemsSummary(pageItems);
    const classificationPrompt = buildClassificationPrompt(taxonomyData, itemsSummary, userLanguage);
    const hasVisualItems = pageItems.some((it: any) => it.visual_context);
    const classifyImageParts = hasVisualItems
      ? [{ inlineData: { data: imageData.imageBase64, mimeType: imageData.mimeType } }]
      : undefined;

    console.log(`[Background] Step 3 Pass C: Page ${pageNum} - execution start`, { sessionId });

    const classificationResult = await classifyItems({
      ai,
      sessionId,
      prompt: classificationPrompt,
      imageParts: classifyImageParts,
    });

    console.log(`[Background] Step 3 Pass C: Page ${pageNum} done, classifications: ${classificationResult.classifications.length}`, { sessionId });

    // ─── 결과 병합 ───
    for (const item of pageItems) {
      item.user_answer = null;
      item.user_marked_correctness = null;
      item.correct_answer = null;
    }

    mergeHandwritingMarks(pageItems, handwritingResult.marks, sessionId);
    mergeClassifications(pageItems, classificationResult.classifications, sessionId);

    // 토큰 사용량 합산 (Pass A + 0 + B + C)
    const combinedUsage = sumUsage(pageUsage, handwritingResult.usageMetadata, classificationResult.usageMetadata);

    return { pageItems, pageResult, pageModel, pageUsage: combinedUsage };
  } catch (pageErr: any) {
    console.error(`[Background] Step 3: Page ${pageNum} analysis FAILED`, {
      sessionId,
      error: pageErr?.message || String(pageErr),
      stage: pageErr instanceof StageError ? pageErr.stage : 'unknown',
      details: pageErr instanceof StageError ? pageErr.details : undefined,
    });
    return null;
  }
}
