import { StageError } from './errors.ts';

export function normalizeMark(raw: unknown): 'O' | 'X' {
    if (raw === undefined || raw === null) return 'X';
    const value = String(raw).trim().toLowerCase();
    const truthy = new Set(['o', '✓', 'v', 'correct', 'true', '정답', '맞음', 'ok', '⭕', 'circle', 'check', 'checkmark']);
    if (truthy.has(value)) return 'O';
    return 'X';
}

// 검증: 필수 필드, 선택지 개수, 문제 번호 순서/중복, taxonomy 일관성
export function validateExtractedItems(params: {
    items: any[];
    taxonomyByDepthKey: Map<string, { code: string | null; cefr: string | null; difficulty: number | null }>;
    taxonomyByCode: Map<string, { depth1: string | null; depth2: string | null; depth3: string | null; depth4: string | null; code: string | null; cefr: string | null; difficulty: number | null }>;
}) {
    const { items, taxonomyByDepthKey, taxonomyByCode } = params;

    const seenNumbers = new Set<string>();
    let previousNumber: number | null = null;

    const clean = (v: unknown) => {
        if (v === undefined || v === null) return '';
        return String(v).trim();
    };

    const isPlaceholderChoice = (text: string) => {
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

    for (const item of items) {
        const numRaw = clean(item.problem_number || item.index);
        const stem = clean(item.question_text || item.stem);
        const choices = Array.isArray(item.choices) ? item.choices : [];

        // 선택지: 다지선다형은 5개, 주관식/서술형은 0개도 허용
        if (choices.length > 0 && choices.length !== 5) {
            throw new StageError('extract_validate', `Invalid choices count: expected 5 or 0, got ${choices.length}`, {
                problem_number: numRaw,
                choices_length: choices.length,
            });
        }

        // 선택지가 있으면 유효한 내용이 최소 1개 이상이어야 함 (placeholder 금지)
        if (choices.length > 0) {
            const hasRealChoice = choices.some((c: any) => {
                const text = typeof c === 'string' ? c : (c?.text ?? '');
                return !isPlaceholderChoice(String(text));
            });
            if (!hasRealChoice) {
                throw new StageError('extract_validate', 'Invalid choices content: all placeholders/empty', {
                    problem_number: numRaw,
                    choices_length: choices.length,
                    choices_sample: choices.slice(0, 3),
                });
            }
        }

        // 문제 번호 중복/역순 검사 (숫자로 파싱 가능한 경우)
        const numVal = parseInt(numRaw, 10);
        if (!Number.isNaN(numVal)) {
            const numKey = String(numVal);
            if (seenNumbers.has(numKey)) {
                throw new StageError('extract_validate', `Duplicate problem number detected: ${numKey}`, {
                    problem_number: numKey,
                });
            }
            if (previousNumber !== null && numVal < previousNumber) {
                throw new StageError('extract_validate', `Problem numbers out of order (descending): prev=${previousNumber}, current=${numVal}`, {
                    previous: previousNumber,
                    current: numVal,
                });
            }
            seenNumbers.add(numKey);
            previousNumber = numVal;
        }

        // taxonomy depth1~4 필수 및 유효성 검사
        const classification = item.classification || {};
        const depth1 = clean(classification.depth1 ?? classification['depth1']);
        const depth2 = clean(classification.depth2 ?? classification['depth2']);
        const depth3 = clean(classification.depth3 ?? classification['depth3']);
        const depth4 = clean(classification.depth4 ?? classification['depth4']);
        const code = clean(classification.code ?? classification['code']);

        const hasAllDepth = !!(depth1 && depth2 && depth3 && depth4);
        const depthKey = `${depth1}␟${depth2}␟${depth3}␟${depth4}`;

        const depthValid = hasAllDepth && taxonomyByDepthKey.has(depthKey);
        const codeValid = code && taxonomyByCode.has(code);

        if (!depthValid && !codeValid) {
            throw new StageError('extract_validate', 'Invalid taxonomy classification', {
                problem_number: numRaw,
                depth1,
                depth2,
                depth3,
                depth4,
                code: code || null,
                stemPreview: stem.substring(0, 120),
            });
        }
    }

    return true;
}

// 문제 번호 범위를 감지하고 분리하는 함수
export function validateAndSplitProblems(items: any[]): any[] {
    const validatedItems: any[] = [];
    // 중복 체크를 위한 Set: 문제 내용의 해시를 저장
    const seenProblemHashes = new Set<string>();

    // 문제 내용에서 핵심 텍스트 추출하여 해시 생성 (중복 체크용)
    function getProblemHash(item: any): string {
        const stem = String(item.question_text || item.stem || '').trim();
        const choices = (item.choices || []).map((c: any) => {
            const text = typeof c === 'string' ? c : (c.text || c);
            return String(text).trim();
        }).join('|');
        return `${stem}||${choices}`;
    }

    for (const item of items) {
        const problemNumber = String(item.problem_number || item.index || '').trim();
        const problemText = String(item.question_text || item.stem || '').trim();

        // 중복 체크: 같은 문제 내용이 이미 처리되었는지 확인
        const problemHash = getProblemHash(item);
        if (seenProblemHashes.has(problemHash)) {
            console.warn(`Skipping duplicate problem: problem_number=${problemNumber}, hash=${problemHash.substring(0, 50)}...`);
            continue;
        }

        // 1. problem_number에서 범위 패턴 확인 (N~M 또는 N-M)
        // 단, problem_number가 단일 숫자(예: "1", "2")인 경우 범위로 처리하지 않음
        let rangeMatch = problemNumber.match(/^(\d+)[~-](\d+)$/);

        // 2. problem_number에 범위가 없고, 문제 번호가 단일 숫자가 아닌 경우에만
        //    문제 내용의 시작 부분에서 범위 패턴 확인
        //    (AI가 이미 분리한 문제에서는 problem_number가 단일 숫자일 것이므로 이 로직은 실행되지 않음)
        if (!rangeMatch && problemText && !/^\d+$/.test(problemNumber)) {
            // 문제 내용의 시작 부분(첫 100자)에서만 범위 패턴 찾기
            const textStart = problemText.substring(0, 100);
            const textRangeMatch = textStart.match(/\[(\d+)[~-](\d+)\]/);
            if (textRangeMatch) {
                rangeMatch = textRangeMatch;
                console.log(`Found problem number range in problem text start: ${textRangeMatch[0]}`);
            }
        }

        if (rangeMatch) {
            // 범위로 표시된 경우 분리
            const startNum = parseInt(rangeMatch[1], 10);
            const endNum = parseInt(rangeMatch[2], 10);

            if (startNum < endNum && endNum - startNum <= 10) {
                // 합리적인 범위인 경우에만 분리 (최대 10개까지)
                console.warn(`Detected problem number range: ${rangeMatch[0]}. Splitting into ${endNum - startNum + 1} separate problems.`);

                // 각 문제 번호에 대해 별도 항목 생성
                // 주의: 문제 내용은 그대로 유지 (범위 표시가 포함된 지시문일 수 있음)
                for (let num = startNum; num <= endNum; num++) {
                    const newItem = {
                        ...item,
                        index: validatedItems.length,
                        problem_number: num.toString(),
                    };
                    validatedItems.push(newItem);
                    seenProblemHashes.add(getProblemHash(newItem));
                }
            } else {
                // 잘못된 범위이거나 너무 큰 범위인 경우 원본 그대로 추가
                console.warn(`Invalid or too large problem number range: ${rangeMatch[0]}. Keeping as single item.`);
                validatedItems.push({
                    ...item,
                    index: validatedItems.length,
                    problem_number: problemNumber || validatedItems.length.toString(),
                });
                seenProblemHashes.add(problemHash);
            }
        } else {
            // 단일 문제 번호인 경우 그대로 추가
            validatedItems.push({
                ...item,
                index: validatedItems.length,
                problem_number: problemNumber || validatedItems.length.toString(),
            });
            seenProblemHashes.add(problemHash);
        }
    }

    return validatedItems;
}
