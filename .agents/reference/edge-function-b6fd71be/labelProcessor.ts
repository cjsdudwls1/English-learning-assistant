// Labels 생성 로직
import { normalizeMark, cleanOrNull, makeDepthKey, type TaxonomyByDepthKey, type TaxonomyByCode } from './validation.ts';

// Label 페이로드 타입
export interface LabelPayload {
    problem_id: string;
    user_answer: string;
    user_mark: null;
    is_correct: boolean | null;
    correct_answer: string | null;
    classification: {
        depth1: string | null;
        depth2: string | null;
        depth3: string | null;
        depth4: string | null;
        code: string | null;
        CEFR: string | null;
        난이도: number | null;
    };
}

// Labels 생성 파라미터
export interface BuildLabelsParams {
    items: any[];
    problems: Array<{ id: string; index_in_image: number }>;
    taxonomyByDepthKey: TaxonomyByDepthKey;
    taxonomyByCode: TaxonomyByCode;
    sessionId: string;
}

/**
 * 추출된 문제 아이템들로부터 labels 테이블에 저장할 페이로드를 생성합니다.
 */
export async function buildLabelsPayload(params: BuildLabelsParams): Promise<LabelPayload[]> {
    const { items, problems, taxonomyByDepthKey, taxonomyByCode, sessionId } = params;

    // index_in_image를 키로 problem_id 매핑
    const idByIndex = new Map<number, string>();
    for (const row of problems) {
        if (idByIndex.has(row.index_in_image)) {
            console.error(`[Background] Step 5: Duplicate index_in_image detected: ${row.index_in_image}. This should not happen!`, { sessionId, problemId: row.id });
        }
        idByIndex.set(row.index_in_image, row.id);
    }

    const labelsPayload = await Promise.all(items.map(async (it: any, idx: number) => {
        // ─── is_correct 판정 ───
        // 1차: 시험지의 O/X 채점 마크 (user_marked_correctness) 기반
        // 2차: 마크 없으면 user_answer vs correct_answer 자동 비교
        const rawMark = it.user_marked_correctness;
        let isCorrect: boolean | null = null;

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
            if (userAns && correctAns) {
                // 숫자 파싱 비교: "4" vs "④", "4번" vs "4" 등 표기 차이 처리
                const parseAnswerNumber = (s: string): number | null => {
                    // circled numbers: ①②③④⑤
                    const circled = '①②③④⑤';
                    const circledIdx = circled.indexOf(s);
                    if (circledIdx !== -1) return circledIdx + 1;
                    // "4번", "4." 등에서 숫자 추출
                    const numMatch = s.match(/(\d+)/);
                    return numMatch ? parseInt(numMatch[1], 10) : null;
                };
                const userNum = parseAnswerNumber(userAns);
                const correctNum = parseAnswerNumber(correctAns);
                if (userNum !== null && correctNum !== null) {
                    isCorrect = userNum === correctNum;
                } else {
                    // 숫자 파싱 불가 시 문자열 비교 (서술형 등)
                    isCorrect = userAns.toLowerCase() === correctAns.toLowerCase();
                }
            }
        }

        const classification = it.classification || {};

        // taxonomy 분류: AI는 depth1~4를 출력하고, 서버는 depth→code로 정규화/보강
        const rawDepth1 = cleanOrNull(classification.depth1 ?? classification['depth1']);
        const rawDepth2 = cleanOrNull(classification.depth2 ?? classification['depth2']);
        const rawDepth3 = cleanOrNull(classification.depth3 ?? classification['depth3']);
        const rawDepth4 = cleanOrNull(classification.depth4 ?? classification['depth4']);
        const rawCode = cleanOrNull(classification.code ?? classification['code']);

        let depth1: string | null = rawDepth1;
        let depth2: string | null = rawDepth2;
        let depth3: string | null = rawDepth3;
        let depth4: string | null = rawDepth4;

        let taxonomyCode: string | null = null;
        let taxonomyCefr: string | null = null;
        let taxonomyDifficulty: number | null = null;

        // 1) depth1~4가 모두 있으면 → depth로 code/cefr/difficulty 조회
        const hasAnyDepth = !!(depth1 || depth2 || depth3 || depth4);
        const hasAllDepth = !!(depth1 && depth2 && depth3 && depth4);

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

        // 2) (호환) depth가 없고 code만 있으면 → code로 depth를 복원
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

        const enrichedClassification = {
            depth1,
            depth2,
            depth3,
            depth4,
            code: taxonomyCode,
            CEFR: taxonomyCefr,
            난이도: taxonomyDifficulty,
        };

        const problemId = idByIndex.get(idx);
        if (!problemId) {
            console.error(`[Background] Step 5: Problem ID not found for array index ${idx}. This should not happen!`, {
                sessionId,
                idByIndexSize: idByIndex.size,
                idByIndexKeys: Array.from(idByIndex.keys()),
                itemsLength: items.length
            });
            return null;
        }

        return {
            problem_id: problemId,
            user_answer: it.user_answer || '',
            user_mark: null,
            is_correct: isCorrect,
            correct_answer: it.correct_answer || null,
            classification: enrichedClassification,
        };
    }));

    // null 값 필터링
    return labelsPayload.filter((label): label is LabelPayload => label !== null);
}
