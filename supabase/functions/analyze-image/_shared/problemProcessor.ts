// 문제 데이터 처리 및 저장 관련 유틸리티
import type { ExtractedItem, SharedPassage } from './validation.ts';

// 정규화된 선택지 타입
export interface NormalizedChoice {
    label?: string;
    text: string;
}

// 문제 내용 JSONB 구조
export interface ProblemContent {
    problem_number: string | null;
    shared_passage_ref: string | null;
    passage: string | null;
    visual_context: {
        type?: string;
        title?: string;
        content?: string;
    } | null;
    instruction: string | null;
    question_body: string | null;
    choices: NormalizedChoice[];
    user_answer: string | null;
    user_marked_correctness: string | null;
    correct_answer: string | null;
}

// 문제 메타데이터 구조
export interface ProblemMetadata {
    difficulty: string;
    word_difficulty: number;
    problem_type: string;
    analysis: string;
}

// DB에 저장할 문제 페이로드
export interface ProblemPayload {
    session_id: string;
    index_in_image: number;
    stem: string;
    choices: NormalizedChoice[];
    content: ProblemContent;
    problem_metadata: ProblemMetadata;
}

// 선택지 정규화
export function normalizeChoices(choices: ExtractedItem['choices']): NormalizedChoice[] {
    if (!choices || !Array.isArray(choices)) return [];

    return choices.map((c) => {
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

// stem 텍스트 생성 (새 구조와 레거시 구조 모두 지원)
export function buildStemText(item: ExtractedItem): string {
    // 기존 question_text가 있으면 그것을 사용 (하위 호환성)
    if (item.question_text) {
        return item.question_text;
    }

    if (!item.instruction) {
        return item.stem || '';
    }

    // 새로운 구조: instruction을 기본으로 하고, passage가 있으면 앞에 추가
    const passageText = item._resolved_passage || item.passage || '';
    const questionBody = item.question_body || '';

    const parts: string[] = [];

    if (passageText) {
        parts.push(`[지문]\n${passageText}`);
    }

    if (item.visual_context) {
        const ctx = item.visual_context;
        parts.push(`[${ctx.type || '자료'}] ${ctx.title || ''}\n${ctx.content || ''}`);
    }

    parts.push(`[문제] ${item.instruction}`);

    if (questionBody) {
        parts.push(questionBody);
    }

    return parts.filter(Boolean).join('\n\n');
}

// 문제 내용 JSONB 생성
export function buildProblemContent(item: ExtractedItem, normalizedChoices: NormalizedChoice[]): ProblemContent {
    return {
        problem_number: item.problem_number || null,
        shared_passage_ref: item.shared_passage_ref || null,
        passage: item._resolved_passage || item.passage || null,
        visual_context: item.visual_context || null,
        instruction: item.instruction || null,
        question_body: item.question_body || null,
        choices: normalizedChoices,
        user_answer: item.user_answer || null,
        user_marked_correctness: item.user_marked_correctness || null,
        correct_answer: (item as any).correct_answer || null,
    };
}

// 기본 메타데이터 생성
export function getDefaultMetadata(): ProblemMetadata {
    return {
        difficulty: '중',
        word_difficulty: 5,
        problem_type: '분석 대기',
        analysis: '분석 정보 없음',
    };
}

// 추출된 아이템들을 DB 저장용 페이로드로 변환
export function buildProblemsPayload(
    items: ExtractedItem[],
    sessionId: string
): ProblemPayload[] {
    return items.map((item, idx) => {
        const normalizedChoices = normalizeChoices(item.choices);
        const stemText = buildStemText(item);
        const contentJson = buildProblemContent(item, normalizedChoices);

        return {
            session_id: sessionId,
            index_in_image: idx,
            stem: stemText,
            choices: normalizedChoices,
            content: contentJson,
            problem_metadata: item.metadata ? {
                difficulty: item.metadata.difficulty || '중',
                word_difficulty: item.metadata.word_difficulty || 5,
                problem_type: item.metadata.problem_type || '분석 대기',
                analysis: item.metadata.analysis || '분석 정보 없음',
            } : getDefaultMetadata(),
        };
    });
}

// 분류 정보 보강 (taxonomy 매핑)
export interface EnrichedClassification {
    depth1: string | null;
    depth2: string | null;
    depth3: string | null;
    depth4: string | null;
    code: string | null;
    CEFR: string | null;
    난이도: number | null;
}

export function enrichClassification(
    classification: ExtractedItem['classification'],
    taxonomyByDepthKey: Map<string, { code: string | null; cefr: string | null; difficulty: number | null }>,
    taxonomyByCode: Map<string, { depth1: string | null; depth2: string | null; depth3: string | null; depth4: string | null; code: string | null; cefr: string | null; difficulty: number | null }>,
    makeDepthKey: (d1: string, d2: string, d3: string, d4: string) => string,
    cleanOrNull: (v: unknown) => string | null
): EnrichedClassification {
    const rawDepth1 = cleanOrNull(classification?.depth1);
    const rawDepth2 = cleanOrNull(classification?.depth2);
    const rawDepth3 = cleanOrNull(classification?.depth3);
    const rawDepth4 = cleanOrNull(classification?.depth4);
    const rawCode = cleanOrNull(classification?.code);

    let depth1: string | null = rawDepth1;
    let depth2: string | null = rawDepth2;
    let depth3: string | null = rawDepth3;
    let depth4: string | null = rawDepth4;
    let taxonomyCode: string | null = null;
    let taxonomyCefr: string | null = null;
    let taxonomyDifficulty: number | null = null;

    const hasAnyDepth = !!(depth1 || depth2 || depth3 || depth4);
    const hasAllDepth = !!(depth1 && depth2 && depth3 && depth4);

    // depth1~4가 모두 있으면 → depth로 code/cefr/difficulty 조회
    if (hasAllDepth) {
        const mapped = taxonomyByDepthKey.get(makeDepthKey(depth1!, depth2!, depth3!, depth4!));
        taxonomyCode = mapped?.code ?? null;
        taxonomyCefr = mapped?.cefr ?? null;
        taxonomyDifficulty = mapped?.difficulty ?? null;
        if (!taxonomyCode) {
            console.warn(`Taxonomy mapping failed for depth: ${depth1}/${depth2}/${depth3}/${depth4}`);
            depth1 = depth2 = depth3 = depth4 = null;
        }
    } else if (hasAnyDepth) {
        console.warn(`Partial depth provided. Invalid taxonomy depth path: ${depth1}/${depth2}/${depth3}/${depth4}`);
        depth1 = depth2 = depth3 = depth4 = null;
    }

    // (호환) depth가 없고 code만 있으면 → code로 depth를 복원
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
            console.warn(`Invalid taxonomy code: "${rawCode}" (not found)`);
        }
    }

    return {
        depth1,
        depth2,
        depth3,
        depth4,
        code: taxonomyCode,
        CEFR: taxonomyCefr,
        난이도: taxonomyDifficulty,
    };
}
