// pageAnalyzer.ts — 단일 페이지 3-Pass 분석 오케스트레이터
// (Pass A + Pass B) 병렬 실행 → Pass C(분류/메타데이터) 순차 실행 후 결과 병합

import { buildPrompt, buildHandwritingDetectionPrompt, buildClassificationPrompt } from './prompts.ts';
import { analyzeImagesWithFailover, detectHandwritingMarks, classifyItems } from './analysisProcessor.ts';
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
 * - correct_answer도 함께 병합
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

  // problem_number → mark 데이터 매핑
  const markMap = new Map<string, {
    user_answer: string | null;
    correct_answer: string | null;
    user_marked_correctness: string | null;
  }>();
  for (const mark of marks) {
    markMap.set(String(mark.problem_number), {
      user_answer: mark.user_answer,
      correct_answer: mark.correct_answer || null,
      user_marked_correctness: mark.user_marked_correctness || null,
    });
  }

  for (const item of pageItems) {
    const pNum = String(item.problem_number || '');
    const match = markMap.get(pNum);
    if (match) {
      item.user_answer = match.user_answer;
      item.user_marked_correctness = match.user_marked_correctness;
      if (match.correct_answer) {
        item.correct_answer = match.correct_answer;
      }
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

  const classMap = new Map<string, { classification: any; metadata: any; correct_answer: string | null }>();
  for (const cls of classifications) {
    classMap.set(String(cls.problem_number), {
      classification: cls.classification,
      metadata: cls.metadata,
      correct_answer: cls.correct_answer || null,
    });
  }

  for (const item of pageItems) {
    const pNum = String(item.problem_number || '');
    const match = classMap.get(pNum);
    if (match) {
      item.classification = match.classification;
      item.metadata = match.metadata;
      item.correct_answer = match.correct_answer;
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

// ─── 메인 함수: 단일 페이지 3-Pass 분석 ────────────────────

/**
 * 단일 페이지에 대해 3-Pass 분석을 수행한다.
 *
 * 1. (Pass A + Pass B): 병렬 실행 — 구조 추출과 필기 감지를 동시에 수행
 * 2. Pass C: Pass A 결과를 입력으로 분류/메타데이터 생성 (순차)
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

    // ─── Pass B 준비: 이미지 기반 필기 감지 (사용자 답안 + 실제 정답) ───
    const handwritingPrompt = buildHandwritingDetectionPrompt(totalPages);
    const imagePart = { inlineData: { data: imageData.imageBase64, mimeType: imageData.mimeType } };

    console.log(`[Background] Step 3 Pass A+B: Page ${pageNum}/${totalPages} - parallel execution start`, { sessionId, promptLength: pagePrompt.length });

    // ─── Pass A + Pass B: 병렬 실행 ───
    const [pageAnalysisResult, handwritingResult] = await Promise.all([
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
      detectHandwritingMarks({
        ai,
        sessionId,
        prompt: handwritingPrompt,
        imageParts: [imagePart],
      }),
    ]);

    const { usedModel: pageModel, result: pageResult, validatedItems: pageItems, usageMetadata: pageUsage } = pageAnalysisResult;

    console.log(`[Background] Step 3 Pass A: Page ${pageNum} done with ${pageModel}, items: ${pageItems.length}`, { sessionId });
    console.log(`[Background] Step 3 Pass B: Page ${pageNum} done, marks: ${handwritingResult.marks.length}`, { sessionId });

    // ─── Pass C: 분류/메타데이터 (Pass A 결과 필요, 순차 실행) ───
    const itemsSummary = buildItemsSummary(pageItems);
    const classificationPrompt = buildClassificationPrompt(taxonomyData, itemsSummary);
    const hasVisualItems = pageItems.some((it: any) => it.visual_context);
    const classifyImageParts = hasVisualItems
      ? [{ inlineData: { data: imageData.imageBase64, mimeType: imageData.mimeType } }]
      : undefined;

    const classificationResult = await classifyItems({
      ai,
      sessionId,
      prompt: classificationPrompt,
      imageParts: classifyImageParts,
    });

    // ─── 결과 병합 ───
    // Pass A의 user 필드를 null로 초기화 (안전 장치)
    for (const item of pageItems) {
      item.user_answer = null;
      item.user_marked_correctness = null;
    }

    mergeHandwritingMarks(pageItems, handwritingResult.marks, sessionId);
    mergeClassifications(pageItems, classificationResult.classifications, sessionId);

    // 토큰 사용량 합산 (Pass A + B + C)
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
