import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { GoogleGenAI } from "https://esm.sh/@google/genai@1.21.0";
import { createServiceSupabaseClient } from "../_shared/supabaseClient.ts";
import { handleOptions, jsonResponse, errorResponse } from "../_shared/http.ts";
import { generateWithRetry, extractTextFromResponse } from "../_shared/aiClient.ts";
import { summarizeError } from "../_shared/errors.ts";
import { logAiUsage } from "../_shared/usageLogger.ts";
import { createAIClient } from "../_shared/aiClientFactory.ts";
import { getActiveUserKey } from "../_shared/userApiKeys.ts";

// 프론트에서 조립해 보내는 오답 샘플 (fetchProblemsMetadataByCorrectness 절삭본)
interface WrongSample {
  stem?: string;
  choices?: string[];
  user_answer?: string;
  correct_answer?: string;
  analysis?: string;
  classification?: string; // "depth1 > depth2 > ..." 요약 문자열
  problem_type?: string;
  difficulty?: string;
}

interface ConsultingRequest {
  userId: string;
  language?: 'ko' | 'en';
  scopeLabel?: string;               // 예: "전체" 또는 "문법 > 시제 > 현재완료"
  stats?: { total?: number; correct?: number; incorrect?: number };
  byCategory?: Array<{ label: string; total: number; correct: number; incorrect: number }>;
  wrongSamples?: WrongSample[];
}

function fmtWrongSamples(samples: WrongSample[], isEnglish: boolean): string {
  if (!samples || samples.length === 0) {
    return isEnglish ? '(No incorrect items in the selected scope.)' : '(선택 범위에 오답 문항이 없습니다.)';
  }
  return samples.map((s, i) => {
    const lines: string[] = [];
    lines.push(`### ${isEnglish ? 'Item' : '문항'} ${i + 1}`);
    if (s.classification) lines.push(`- ${isEnglish ? 'Category' : '분류'}: ${s.classification}`);
    if (s.problem_type) lines.push(`- ${isEnglish ? 'Type' : '유형'}: ${s.problem_type}`);
    if (s.difficulty) lines.push(`- ${isEnglish ? 'Difficulty' : '난이도'}: ${s.difficulty}`);
    if (s.stem) lines.push(`- ${isEnglish ? 'Stem' : '문제'}: ${s.stem}`);
    if (s.choices && s.choices.length) lines.push(`- ${isEnglish ? 'Choices' : '선택지'}: ${s.choices.join(' / ')}`);
    lines.push(`- ${isEnglish ? "Student's answer" : '학생 답'}: ${s.user_answer ?? (isEnglish ? '(blank)' : '(무응답)')}`);
    lines.push(`- ${isEnglish ? 'Correct answer' : '정답'}: ${s.correct_answer ?? 'N/A'}`);
    if (s.analysis) lines.push(`- ${isEnglish ? 'Item note' : '문항 해설'}: ${s.analysis}`);
    return lines.join('\n');
  }).join('\n\n');
}

function fmtByCategory(rows: ConsultingRequest['byCategory'], isEnglish: boolean): string {
  if (!rows || rows.length === 0) return isEnglish ? '(No category breakdown.)' : '(카테고리별 내역 없음.)';
  return rows.map((r) => {
    const rate = r.total > 0 ? Math.round((r.correct / r.total) * 100) : 0;
    return isEnglish
      ? `- ${r.label}: ${r.total} items, ${r.correct} correct / ${r.incorrect} incorrect (accuracy ${rate}%)`
      : `- ${r.label}: 총 ${r.total}문항, 정답 ${r.correct} / 오답 ${r.incorrect} (정답률 ${rate}%)`;
  }).join('\n');
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return handleOptions();
  }

  if (req.method !== 'POST') {
    return errorResponse('Method not allowed', 405);
  }

  try {
    const body = await req.json() as ConsultingRequest;
    const { userId, language, scopeLabel, stats, byCategory, wrongSamples } = body;

    if (!userId) {
      return errorResponse('Missing required field: userId', 400);
    }

    const supabase = createServiceSupabaseClient();
    // 사용자 BYOK 키가 있으면 Claude/ChatGPT 사용, 없으면 시스템 Gemini로 폴백
    const userKey = await getActiveUserKey(supabase, userId);
    const { ai, provider } = createAIClient(GoogleGenAI, userKey);

    // 사용자 프로필(연령/학년)로 개인화
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('name, age, grade')
      .eq('user_id', userId)
      .single();
    if (profileError && profileError.code !== 'PGRST116') {
      throw profileError;
    }
    const userAge = profile?.age ? parseInt(profile.age) || 14 : 14;
    const userGrade = profile?.grade || '중학생';
    const userName = (profile?.name || '').trim();

    const isEnglish = language === 'en';
    const total = stats?.total ?? 0;
    const correct = stats?.correct ?? 0;
    const incorrect = stats?.incorrect ?? 0;
    const rate = total > 0 ? Math.round((correct / total) * 100) : 0;
    const scope = scopeLabel || (isEnglish ? 'All categories' : '전체 카테고리');

    console.log('Generating consulting report', { language, provider, scope, total, incorrect, samples: wrongSamples?.length ?? 0 });

    const sessionId = `gen-consult-${userId}-${Date.now()}`;

    // 이름이 있으면 실명으로 지칭, 없으면 'OOO' 같은 가짜 이름 생성 금지
    const nameLine = isEnglish
      ? (userName ? `- Name: ${userName}\n` : '')
      : (userName ? `- 이름: ${userName}\n` : '');
    const nameGuide = isEnglish
      ? (userName
          ? `Address the student naturally by name ("${userName}") where appropriate.`
          : `No student name is provided. Do NOT invent a placeholder name (e.g., "John Doe" or blanks); simply refer to "the student".`)
      : (userName
          ? `보고서에서 학생을 실명("${userName}")으로 자연스럽게 지칭하세요.`
          : `학생 이름 정보가 없습니다. 'OOO'나 'ㅇㅇㅇ' 같은 가짜 이름·빈 자리표시자를 절대 만들지 말고 그냥 "학생"으로 지칭하세요.`);

    const prompt = isEnglish
      ? `
You are a professional English education consultant writing a personalized diagnostic report for a student (or their parent/teacher). Maintain a professional, warm, and constructive tone. Write the entire report in English.

## Student
${nameLine}- Age: ${userAge}
- Grade: ${userGrade}
- Report scope: ${scope}

## Aggregate performance (source of truth for statistics)
- Total items: ${total}
- Correct: ${correct}
- Incorrect: ${incorrect}
- Accuracy: ${rate}%  (Incorrect rate: ${100 - rate}%)

## Accuracy by category
${fmtByCategory(byCategory, isEnglish)}

## Sampled incorrect items (evidence for weakness analysis; may be a subset)
${fmtWrongSamples(wrongSamples || [], isEnglish)}

## Instructions
Write a consulting report of about 1–2 A4 pages with these three sections (use Markdown headings):

# 1. Performance Summary
Restate the key numbers (total items, correct/incorrect, accuracy/incorrect rate) in prose. Note the strongest and weakest categories from the data.

# 2. Weakness Analysis
Identify the student's SPECIFIC weaknesses. Ground every claim ONLY in the provided incorrect items and category accuracy — do NOT invent weaknesses not supported by the data. Where possible, name the concrete grammatical/structural pattern behind the errors (e.g., misplacement of adjectives vs. adverbs, subject–verb agreement, 5-sentence-pattern object structure, tense selection). Cite the item numbers as evidence. If the data is insufficient or there are no incorrect items, say so honestly and focus on maintenance.

# 3. Improvement Plan & Study Guide
Give a concrete, actionable plan: prioritized focus areas, specific study/teaching methods for each weakness, and a short suggested weekly routine appropriate to the student's grade (${userGrade}). Be specific and practical, not generic.

Constraints:
- ${nameGuide}
- Base all statistics strictly on the numbers given above.
- Do NOT fabricate example items that were not provided; you may create illustrative practice sentences but label them as suggestions.
- Do not pad with filler; every sentence should carry information.
- Output ONLY the report in Markdown. Do not wrap it in JSON or code fences.
`
      : `
당신은 학생(또는 학부모·지도교사)에게 개인 맞춤 진단 보고서를 작성하는 영어 교육 전문 컨설턴트입니다. 전문적이면서 따뜻하고 건설적인 어조를 유지하세요. 보고서 전체를 한국어로 작성합니다.

## 학생 정보
${nameLine}- 연령: ${userAge}세
- 학년: ${userGrade}
- 보고서 범위: ${scope}

## 종합 성취도 (통계의 기준 값 — 반드시 이 수치 사용)
- 총 문항 수: ${total}
- 맞은 개수: ${correct}
- 틀린 개수: ${incorrect}
- 정답률: ${rate}%  (오답률: ${100 - rate}%)

## 카테고리별 정답률
${fmtByCategory(byCategory, isEnglish)}

## 오답 문항 표본 (취약점 분석 근거 — 일부 표본일 수 있음)
${fmtWrongSamples(wrongSamples || [], isEnglish)}

## 작성 지침
아래 3개 섹션으로 A4 약 1~2장 분량의 컨설팅 보고서를 작성하세요(마크다운 제목 사용):

# 1. 기본 통계 요약
핵심 수치(총 문항 수, 맞은/틀린 개수, 정답률/오답률)를 문장으로 다시 정리하고, 데이터상 가장 강한 영역과 가장 취약한 영역을 짚어주세요.

# 2. 취약점 분석
학생의 **구체적** 취약점을 진단하세요. 모든 진단은 오직 제공된 오답 문항과 카테고리별 정답률에만 근거해야 하며, 데이터로 뒷받침되지 않는 취약점을 지어내지 마세요. 가능하면 오류 뒤에 있는 구체적 문법·구조 패턴을 명명하세요(예: 형용사/부사의 자리 혼동, 주어-동사 수일치, 5형식 목적어 구조, 시제 선택 등). 근거로 문항 번호를 인용하세요. 데이터가 부족하거나 오답이 없다면 솔직히 밝히고 유지·심화에 초점을 두세요.

# 3. 해결 방안 및 학습 가이드
구체적이고 실행 가능한 계획을 제시하세요: 우선순위 학습 영역, 각 취약점에 대한 구체적 학습·지도 방법, 학년(${userGrade})에 맞는 짧은 주간 학습 루틴 제안. 일반론이 아니라 구체적·실용적으로.

제약:
- ${nameGuide}
- 모든 통계는 위에 주어진 수치를 엄격히 따를 것.
- 제공되지 않은 문항을 지어내지 말 것(연습용 예문은 만들 수 있으나 '제안'임을 명시).
- 군더더기 문장 패딩 금지 — 모든 문장이 정보를 담을 것.
- 출력은 오직 마크다운 보고서만. JSON이나 코드펜스로 감싸지 말 것.
`;

    // 비용 예측가능성을 위해 명시 버전으로 고정 — 'gemini-flash-latest' alias는
    // 상위 모델(3.5 Flash, 단가 입력 5배/출력 3.6배)로 조용히 승격될 수 있음
    const modelName = 'gemini-2.5-flash';
    const result = await generateWithRetry({
      ai,
      model: modelName,
      contents: { parts: [{ text: prompt }] },
      sessionId,
      maxRetries: 2,
      baseDelayMs: 2000,
      temperature: 0.6,
    });

    let report = (await extractTextFromResponse(result.response, modelName)).trim();
    // 모델이 실수로 코드펜스로 감싼 경우 벗겨내기
    report = report.replace(/^```(?:markdown|md)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();

    if (!report) {
      throw new Error('AI returned an empty report');
    }

    if (result.usageMetadata) {
      await logAiUsage({
        supabase,
        userId,
        functionName: 'generate-consulting',
        modelUsed: modelName,
        usageMetadata: result.usageMetadata,
        metadata: { scope, total, incorrect, sampleCount: wrongSamples?.length ?? 0 },
      });
    }

    return jsonResponse({ success: true, report });

  } catch (error: any) {
    console.error('Error in generate-consulting function:', error);
    return errorResponse(
      error.message || 'Internal server error',
      500,
      summarizeError(error)
    );
  }
});
