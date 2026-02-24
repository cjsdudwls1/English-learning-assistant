// 메타데이터 생성 로직
import { MODEL_SEQUENCE, MODEL_RETRY_POLICY } from '../../_shared/models.ts';

// 메타데이터 입력 타입
export interface MetadataInput {
    problem_id: string;
    problem_type: string;
    stem: string;
    choices: string;
    user_answer: string;
    is_correct: boolean | null;
}

// 메타데이터 생성 파라미터
export interface GenerateMetadataParams {
    ai: any;
    supabase: any;
    batchInputs: MetadataInput[];
    problemTypeById: Map<string, string>;
    userLanguage: 'ko' | 'en';
    sessionId: string;
}

// 메타데이터 생성 결과
export interface GenerateMetadataResult {
    successCount: number;
    errorCount: number;
    usedModel: string | null;
}

/**
 * 문제 목록에 대한 메타데이터를 배치로 생성하고 DB에 저장합니다.
 * MODEL_SEQUENCE를 따라 순차적으로 모델을 시도합니다.
 */
export async function generateBatchMetadata(params: GenerateMetadataParams): Promise<GenerateMetadataResult> {
    const { ai, supabase, batchInputs, problemTypeById, userLanguage, sessionId } = params;

    let successCount = 0;
    let errorCount = 0;
    let usedModel: string | null = null;

    if (batchInputs.length === 0) {
        console.log(`[Background] Step 6 skipped: No valid problems to generate metadata`, { sessionId });
        return { successCount, errorCount, usedModel };
    }

    // 입력 데이터 포맷팅
    const formattedList = batchInputs.map((it, idx) => {
        const correctness = it.is_correct === null
            ? (userLanguage === 'ko' ? '미상' : 'Unknown')
            : (it.is_correct ? (userLanguage === 'ko' ? '정답' : 'Correct') : (userLanguage === 'ko' ? '오답' : 'Incorrect'));

        return userLanguage === 'ko'
            ? `#${idx + 1}\nproblem_id: ${it.problem_id}\n문제 유형: ${it.problem_type}\n문제 내용:\n${it.stem}\n선택지:\n${it.choices}\n사용자 답안: ${it.user_answer}\n정답 여부: ${correctness}\n`
            : `#${idx + 1}\nproblem_id: ${it.problem_id}\nProblem Type: ${it.problem_type}\nProblem:\n${it.stem}\nChoices:\n${it.choices}\nUser Answer: ${it.user_answer}\nIs Correct: ${correctness}\n`;
    }).join('\n');

    // 프롬프트 생성
    const metadataPrompt = userLanguage === 'ko'
        ? `아래 영어 문제 목록에 대해 메타데이터를 생성해주세요.\n\n- 반드시 **JSON 배열만** 응답하세요 (설명/마크다운/코드펜스 금지).\n- 각 항목은 반드시 입력의 problem_id를 그대로 포함해야 합니다.\n\n응답 형식:\n[\n  {\n    \"problem_id\": \"...\",\n    \"difficulty\": \"상\" | \"중\" | \"하\",\n    \"word_difficulty\": 1-9 사이의 숫자,\n    \"analysis\": \"문제에 대한 상세 분석 정보 (한국어)\"\n  }\n]\n\n난이도 기준:\n- 상: 고등학교 수준 이상의 어려운 문제\n- 중: 중학교 수준의 문제\n- 하: 초등학교 수준의 쉬운 문제\n\n단어 난이도 기준:\n- 1-3: 초등학교 수준의 쉬운 단어\n- 4-6: 중학교 수준의 보통 단어\n- 7-9: 고등학교 수준 이상의 어려운 단어\n\n문제 목록:\n${formattedList}`
        : `Generate metadata for the following English problems.\n\n- Respond with **JSON array only** (no explanations/markdown/code fences).\n- Each item must include the exact problem_id from the input.\n\nResponse format:\n[\n  {\n    \"problem_id\": \"...\",\n    \"difficulty\": \"high\" | \"medium\" | \"low\",\n    \"word_difficulty\": 1-9,\n    \"analysis\": \"Detailed analysis (English)\"\n  }\n]\n\nProblems:\n${formattedList}`;

    let metadataSuccess = false;
    let lastMetadataError: unknown = null;

    // 메타데이터 생성용 모델: thinking 모델과 gemini-2.5-pro 제외 (느림 + 시간 초과 위험)
    const metaModels = (MODEL_SEQUENCE as readonly string[]).filter(
        m => m !== 'gemini-3-flash-preview' && m !== 'gemini-2.5-pro'
    ) as string[];
    if (metaModels.length === 0) metaModels.push(...(MODEL_SEQUENCE as readonly string[]));

    for (let mIdx = 0; mIdx < metaModels.length; mIdx++) {
        const model = metaModels[mIdx];

        if (metadataSuccess) break;

        try {
            console.log(`[Background] Step 6: Calling Gemini for batch metadata (${batchInputs.length} problems) using ${model} (${mIdx + 1}/${metaModels.length})...`, { sessionId });

            const response = await Promise.race([
                ai.models.generateContent({
                    model,
                    contents: { parts: [{ text: metadataPrompt }] },
                    generationConfig: {
                        responseMimeType: "application/json",
                        temperature: 0.0,
                    },
                }),
                new Promise<never>((_, reject) =>
                    setTimeout(() => reject(new Error('Metadata API call timeout after 60s')), 60000)
                ),
            ]);

            // 텍스트 추출
            let metadataText: string = '';
            if (response?.text) {
                metadataText = typeof response.text === 'function'
                    ? await response.text()
                    : response.text;
            } else if (response?.response?.text) {
                metadataText = typeof response.response.text === 'function'
                    ? await response.response.text()
                    : response.response.text;
            } else if (response?.candidates?.[0]?.content?.parts?.[0]?.text) {
                metadataText = response.candidates[0].content.parts[0].text;
            }

            if (!metadataText || typeof metadataText !== 'string') {
                throw new Error(`Invalid metadata response text from ${model}`);
            }

            // JSON 파싱
            const jsonString = metadataText.replace(/```json/g, '').replace(/```/g, '').trim();
            let parsed: unknown[];
            try {
                parsed = JSON.parse(jsonString);
            } catch {
                const arrMatch = jsonString.match(/\[[\s\S]*\]/);
                if (!arrMatch) throw new Error('No JSON array found in metadata response');
                parsed = JSON.parse(arrMatch[0]);
            }

            if (!Array.isArray(parsed)) {
                throw new Error('Metadata response is not an array');
            }

            // 메타데이터 저장
            for (const row of parsed) {
                const rowData = row as { problem_id?: string; difficulty?: string; word_difficulty?: number; analysis?: string };
                const problemId = String(rowData?.problem_id || '').trim();
                if (!problemId) {
                    errorCount++;
                    continue;
                }

                const problemType = problemTypeById.get(problemId) || (userLanguage === 'ko' ? '분류 없음' : 'Unclassified');

                // 난이도 정규화
                let difficulty = rowData?.difficulty;
                if (userLanguage === 'en') {
                    const valid = ['high', 'medium', 'low'];
                    if (!valid.includes(difficulty || '')) {
                        if (difficulty === '상') difficulty = 'high';
                        else if (difficulty === '중') difficulty = 'medium';
                        else if (difficulty === '하') difficulty = 'low';
                        else difficulty = 'medium';
                    }
                } else {
                    const valid = ['상', '중', '하'];
                    if (!valid.includes(difficulty || '')) {
                        if (difficulty === 'high') difficulty = '상';
                        else if (difficulty === 'medium') difficulty = '중';
                        else if (difficulty === 'low') difficulty = '하';
                        else difficulty = '중';
                    }
                }

                // 단어 난이도 1-9
                const wdNum = Number(rowData?.word_difficulty);
                const wordDifficulty = (!isNaN(wdNum) && wdNum >= 1 && wdNum <= 9) ? Math.round(wdNum) : 5;

                const analysis = typeof rowData?.analysis === 'string' ? rowData.analysis : '';

                const { error: updateError } = await supabase
                    .from('problems')
                    .update({
                        problem_metadata: {
                            difficulty,
                            word_difficulty: wordDifficulty,
                            problem_type: problemType,
                            analysis,
                        }
                    })
                    .eq('id', problemId);

                if (updateError) {
                    console.error(`[Background] Step 6: Error updating metadata for problem ${problemId}:`, updateError, { sessionId });
                    errorCount++;
                    continue;
                }
                successCount++;
            }

            metadataSuccess = true;
            usedModel = model;
            console.log(`[Background] Step 6 completed: Batch metadata saved for ${successCount}/${batchInputs.length} problems using ${model}`, { sessionId });

        } catch (error) {
            lastMetadataError = error;
            console.warn(`[Background] Step 6: Metadata generation failed with ${model}:`, error, { sessionId });
        }
    }

    if (!metadataSuccess) {
        console.error(`[Background] Step 6: All metadata models failed.`, { sessionId, lastError: lastMetadataError });
        throw new Error(`Metadata generation failed for all models. Last error: ${(lastMetadataError as Error)?.message || 'Unknown'}`);
    }

    return { successCount, errorCount, usedModel };
}
