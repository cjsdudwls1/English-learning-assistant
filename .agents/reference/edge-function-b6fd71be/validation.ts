// 검증 관련 유틸리티 함수들
import { StageError } from '../../_shared/errors.ts';

// 공유 지문 정보 인터페이스
export interface SharedPassage {
    id: string;
    text: string;
}

// 추출된 문제 아이템 인터페이스
export interface ExtractedItem {
    problem_number?: string;
    index?: number;
    question_text?: string;
    stem?: string;
    instruction?: string;
    passage?: string;
    visual_context?: {
        type?: string;
        title?: string;
        content?: string;
    } | null;
    question_body?: string;
    shared_passage_ref?: string | null;
    choices?: Array<{ label?: string; text?: string } | string>;
    user_answer?: string;
    user_marked_correctness?: string | null;
    classification?: {
        depth1?: string;
        depth2?: string;
        depth3?: string;
        depth4?: string;
        code?: string;
    };
    metadata?: {
        difficulty?: string;
        word_difficulty?: number;
        problem_type?: string;
        analysis?: string;
    };
    _resolved_passage?: string;
}

// Taxonomy 맵 타입
export type TaxonomyByDepthKey = Map<string, {
    code: string | null;
    cefr: string | null;
    difficulty: number | null;
}>;

export type TaxonomyByCode = Map<string, {
    depth1: string | null;
    depth2: string | null;
    depth3: string | null;
    depth4: string | null;
    code: string | null;
    cefr: string | null;
    difficulty: number | null;
}>;

// O/X 정규화: 다양한 표기를 O/X/Unknown으로 변환
export function normalizeMark(raw: unknown): 'O' | 'X' | 'Unknown' {
    if (raw === undefined || raw === null) return 'Unknown';
    const value = String(raw).trim().toLowerCase();

    if (value === 'unknown') return 'Unknown';

    const truthy = new Set(['o', '✓', 'v', 'correct', 'true', '정답', '맞음', 'ok', '⭕', 'circle', 'check', 'checkmark', 'yes', 'pass']);
    if (truthy.has(value)) return 'O';

    const falsy = new Set(['x', '✗', 'incorrect', 'false', '오답', '틀림', 'no', 'fail', '❌']);
    if (falsy.has(value)) return 'X';

    return 'Unknown';
}

// 문제 내용에서 핵심 텍스트 추출하여 해시 생성 (중복 체크용)
function getProblemHash(item: ExtractedItem): string {
    const stem = String(item.question_text || item.stem || item.instruction || '').trim();
    const choices = (item.choices || []).map((c) => {
        const text = typeof c === 'string' ? c : (c?.text || '');
        return String(text).trim();
    }).join('|');
    return `${stem}||${choices}`;
}

// 공유 지문 처리 및 문제 유효성 검증
export function validateAndSplitProblems(
    items: unknown[],
    sharedPassages?: SharedPassage[]
): ExtractedItem[] {
    if (!Array.isArray(items)) return [];

    // 공유 지문 맵 생성
    const passageMap = new Map<string, string>();
    if (Array.isArray(sharedPassages)) {
        for (const sp of sharedPassages) {
            if (sp.id && sp.text) {
                passageMap.set(sp.id, sp.text);
            }
        }
    }

    const validatedItems: ExtractedItem[] = [];
    const seenProblemHashes = new Set<string>();

    for (const rawItem of items) {
        const item = rawItem as ExtractedItem;

        // 새로운 구조: instruction, passage, visual_context 중 하나라도 있으면 유효
        const hasNewStructure = item.instruction || item.passage || item.visual_context;
        // 기존 구조와의 호환성: question_text 또는 stem이 있어도 유효
        const hasLegacyContent = item.question_text || item.stem;

        if (!hasNewStructure && !hasLegacyContent) {
            continue; // 유효하지 않은 항목 건너뛰기
        }

        // 중복 체크
        const problemHash = getProblemHash(item);
        if (seenProblemHashes.has(problemHash)) {
            console.warn(`Skipping duplicate problem: hash=${problemHash.substring(0, 50)}...`);
            continue;
        }

        // 공유 지문 참조가 있으면 passage 필드에 실제 텍스트 주입
        let processedItem: ExtractedItem = { ...item };
        if (item.shared_passage_ref && passageMap.has(item.shared_passage_ref)) {
            processedItem._resolved_passage = passageMap.get(item.shared_passage_ref);
        }

        // 문제 번호 범위 처리 (예: "43-45" → 개별 문제로 분리)
        const problemNumber = String(item.problem_number || item.index || '').trim();
        const rangeMatch = problemNumber.match(/^(\d+)[~-](\d+)$/);

        if (rangeMatch) {
            const startNum = parseInt(rangeMatch[1], 10);
            const endNum = parseInt(rangeMatch[2], 10);

            if (startNum < endNum && endNum - startNum <= 10) {
                console.warn(`Detected problem number range: ${rangeMatch[0]}. Splitting into ${endNum - startNum + 1} separate problems.`);
                for (let num = startNum; num <= endNum; num++) {
                    const newItem: ExtractedItem = {
                        ...processedItem,
                        index: validatedItems.length,
                        problem_number: num.toString(),
                    };
                    validatedItems.push(newItem);
                    seenProblemHashes.add(getProblemHash(newItem));
                }
                continue;
            }
        }

        // 단일 문제 추가
        processedItem.index = validatedItems.length;
        processedItem.problem_number = problemNumber || validatedItems.length.toString();
        validatedItems.push(processedItem);
        seenProblemHashes.add(problemHash);
    }

    return validatedItems;
}

// 추출된 항목의 taxonomy 유효성 검사
export interface ValidateExtractedItemsParams {
    items: ExtractedItem[];
    taxonomyByDepthKey: TaxonomyByDepthKey;
    taxonomyByCode: TaxonomyByCode;
}

export function validateExtractedItems(params: ValidateExtractedItemsParams): boolean {
    const { items, taxonomyByDepthKey, taxonomyByCode } = params;

    const clean = (v: unknown): string => {
        if (v === undefined || v === null) return '';
        return String(v).trim();
    };

    const isPlaceholderChoice = (text: string): boolean => {
        const t = text.trim().toLowerCase();
        return (
            t === '' ||
            t === 'null' ||
            t === 'none' ||
            t === 'n/a' ||
            t === 'placeholder' ||
            t === '-' ||
            t === '--' ||
            t === '없음' ||
            t === '빈칸'
        );
    };

    const skippedItems: string[] = []; // 건너뛴 문제 추적
    const seenNumbers = new Set<string>();

    for (const item of items) {
        const numRaw = clean(item.problem_number || item.index);
        const stem = clean(item.question_text || item.stem || item.instruction);
        const choices = Array.isArray(item.choices) ? item.choices : [];

        // 선택지 검증: 다지선다형은 5개, 주관식/서술형은 0개도 허용
        if (choices.length > 0 && choices.length !== 5) {
            console.warn(`[Validation] Skipping problem ${numRaw}: Invalid choices count (expected 5 or 0, got ${choices.length})`);
            skippedItems.push(numRaw);
            continue;
        }

        // 선택지가 있으면 유효한 내용이 최소 1개 이상이어야 함
        if (choices.length > 0) {
            const hasRealChoice = choices.some((c) => {
                const text = typeof c === 'string' ? c : (c?.text ?? '');
                return !isPlaceholderChoice(String(text));
            });
            if (!hasRealChoice) {
                console.warn(`[Validation] Skipping problem ${numRaw}: All choices are placeholders/empty`);
                skippedItems.push(numRaw);
                continue;
            }
        }

        // 문제 번호 중복 검사 (역순은 허용 - 페이지 간 순서가 다를 수 있음)
        const numVal = parseInt(numRaw, 10);
        if (!Number.isNaN(numVal)) {
            const numKey = String(numVal);
            if (seenNumbers.has(numKey)) {
                console.warn(`[Validation] Skipping duplicate problem number: ${numKey}`);
                skippedItems.push(numRaw);
                continue;
            }
            seenNumbers.add(numKey);
        }

        // taxonomy depth1~4 유효성 검사
        const classification = item.classification || {};
        const depth1 = clean(classification.depth1);
        const depth2 = clean(classification.depth2);
        const depth3 = clean(classification.depth3);
        const depth4 = clean(classification.depth4);
        const code = clean(classification.code);

        const hasAllDepth = !!(depth1 && depth2 && depth3 && depth4);
        const depthKey = `${depth1}␟${depth2}␟${depth3}␟${depth4}`;

        const depthValid = hasAllDepth && taxonomyByDepthKey.has(depthKey);
        const codeValid = code && taxonomyByCode.has(code);

        // taxonomy 검증 실패 시 경고만 출력 (서버 측에서 null로 처리됨)
        if (!depthValid && !codeValid) {
            console.warn(`[Validation] Invalid taxonomy classification - will be set to null`, {
                problem_number: numRaw,
                depth1,
                depth2,
                depth3,
                depth4,
                code: code || null,
                stemPreview: stem.substring(0, 80),
            });
            // 오류를 throw하지 않고 계속 진행 - 서버 측 enrichClassification에서 null 처리됨
        }
    }

    if (skippedItems.length > 0) {
        console.warn(`[Validation] ${skippedItems.length} problem(s) skipped during validation: [${skippedItems.join(', ')}]`);
    }

    return true;
}

// null 또는 빈 문자열을 null로 정규화
export function cleanOrNull(v: unknown): string | null {
    if (v === undefined || v === null) return null;
    const s = String(v).trim();
    return s ? s : null;
}

// depth1~4를 키로 변환
export function makeDepthKey(d1: string, d2: string, d3: string, d4: string): string {
    return `${d1}␟${d2}␟${d3}␟${d4}`;
}
