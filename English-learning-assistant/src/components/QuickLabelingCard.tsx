import React, { useState, useEffect } from 'react';
import { ImageLightbox } from './ImageLightbox';
import { useNavigate } from 'react-router-dom';
import { fetchSessionProblems, updateProblemLabels, deleteProblems } from '../services/db';
import type { ProblemItem, QuestionType } from '../types';
import { useLanguage } from '../contexts/LanguageContext';
import { getTranslation } from '../utils/translations';
import { getManualReviewReason, eqSet } from '../utils/gradingSafety';
import { toCardinality } from '../utils/answerShape';

interface QuickLabelingCardProps {
  sessionId: string;
  imageUrl: string;
  imageUrls?: string[];
  analysisModel?: string | null;
  modelsUsed?: { ocr?: string; analysis?: string } | null;
  onSave?: () => void;
  onDelete?: (sessionId: string) => void;
}

/**
 * 채점 비교용 정규화 — 백엔드 computeIsCorrect(dbOperations.js)의 서술형 정규화와 정합.
 * 대소문자·구두점(.,?!;:"/)·공백(한글 띄어쓰기 포함) 무시, 어포스트로피(')·하이픈(-)은 보존(can't≠cant).
 * 기존 autoJudge는 trim+소문자만 해서 "학교 미술" vs "학교미술" 같은 표면차이를 오답 처리 → 정답을 오답으로(confident-wrong) 표시하던 문제.
 */
function normalizeForCompare(s: string): string {
  return s
    .toLowerCase()
    .replace(/[.,?!;:"/]/g, '')
    .replace(/\s+/g, '');
}

/** 사용자 답안과 정답을 비교하여 자동 판정 */
function autoJudge(userAnswer: string, correctAnswer: string): 'O' | 'X' | null {
  const ua = normalizeForCompare(userAnswer);
  const ca = normalizeForCompare(correctAnswer);
  if (!ua || !ca) return null; // 둘 중 하나라도 (정규화 후) 비어있으면 자동 판정 불가
  return ua === ca ? 'O' : 'X';
}

/** 문제 유형 판별 헬퍼 */
function inferQuestionType(problem: ProblemItem): QuestionType {
  if (problem.question_type && problem.question_type !== 'unknown') {
    return problem.question_type;
  }
  if (problem.문제_보기 && problem.문제_보기.length > 0) {
    return 'multiple_choice';
  }
  const ca = problem.correct_answer?.trim()?.toUpperCase();
  if (ca === 'O' || ca === 'X' || ca === 'TRUE' || ca === 'FALSE') {
    return 'ox';
  }
  return 'short_answer';
}

/** 서버에서 받은 문제 배열로부터 편집 UI의 초기 상태를 만든다 (순수 함수 — 캐시 시드와 재검증이 같은 코드를 쓴다) */
interface EditorSeed {
  labels: Record<string, 'O' | 'X'>;
  answers: Record<string, string>;
  correctAnswers: Record<string, string>;
  multiUser: Record<string, number[]>;
  multiCorrect: Record<string, number[]>;
  blankUser: Record<string, string[]>;
  blankCorrect: Record<string, string[]>;
}

function deriveEditorSeed(data: ProblemItem[]): EditorSeed {
  const seed: EditorSeed = {
    labels: {}, answers: {}, correctAnswers: {},
    multiUser: {}, multiCorrect: {}, blankUser: {}, blankCorrect: {},
  };
  data.forEach(p => {
    const mark = p.사용자가_직접_채점한_정오답;
    // 복수답안·형식불일치는 저장된 구(舊) AI 판정을 신뢰하지 않음 — O/X 시드 안 함(수동 확인 유도)
    // 단, 백엔드가 번호 집합을 확신 추출한 multi(correctAnswers/userAnswers)는 자동판정 신뢰
    const reviewReason = getManualReviewReason({
      instruction: p.instruction,
      correctAnswer: p.correct_answer,
      userAnswer: p.사용자가_기술한_정답?.text,
      hasChoices: (p.문제_보기?.length ?? 0) > 0,
      answerFormat: p.answerFormat,
      correctAnswers: p.correctAnswers,
      userAnswers: p.userAnswers,
    });
    if (mark === 'O' || mark === 'X') {
      seed.labels[`${p.index}`] = mark; // 사용자 수동 채점은 항상 우선
    } else if (!reviewReason && p.AI가_판단한_정오답 === '정답') {
      seed.labels[`${p.index}`] = 'O';
    } else if (!reviewReason && p.AI가_판단한_정오답 === '오답') {
      seed.labels[`${p.index}`] = 'X';
    }
    seed.answers[`${p.index}`] = p.사용자가_기술한_정답?.text || '';
    seed.correctAnswers[`${p.index}`] = p.correct_answer || '';
    if (p.answerFormat === 'multi') {
      seed.multiUser[`${p.index}`] = p.userAnswers ?? [];
      seed.multiCorrect[`${p.index}`] = p.correctAnswers ?? [];
    }
    if (toCardinality(p.answerFormat) === 'list') {
      const bu = p.blankUserAnswers ?? [];
      const bc = p.blankCorrectAnswers ?? [];
      const n = Math.max(bu.length, bc.length);
      seed.blankUser[`${p.index}`] = Array.from({ length: n }, (_, i) => bu[i] == null ? '' : String(bu[i]));
      seed.blankCorrect[`${p.index}`] = Array.from({ length: n }, (_, i) => bc[i] == null ? '' : String(bc[i]));
    }
  });
  return seed;
}

// ─────────────────────────────────────────────────────────────────────────────
// 세션 문제 캐시 (stale-while-revalidate)
//
// 부모(useStatsData)는 세션 목록을 캐시하는데 이 카드는 자기 문제 목록을 따로 가져온다.
// 그래서 /stats → 다른 화면 → /stats 로 돌아오면 목록은 즉시 뜨는데 카드만 다시
// "문제 불러오는 중..."으로 덮였다 — e2e/role-stats.spec.ts가 잡은 게 정확히 이 증상이다.
// 부모와 같은 전략을 쓴다: 직전 응답을 즉시 그리고 같은 질의를 백그라운드로 돌린다.
//
// 수명: 부모 캐시와 같은 모듈 스코프. 로그아웃은 window.location.reload()를 부르므로
// (LoginButton.tsx) 계정 경계에서 통째로 사라진다 — 별도 무효화가 필요 없다.
// 무효화: 서버 상태를 바꾸는 지점(저장·문제 삭제)에서만 지운다.
// ─────────────────────────────────────────────────────────────────────────────
const problemsCache = new Map<string, ProblemItem[]>();
// 세션을 여럿 오가면 엔트리가 쌓이므로 상한을 둔다(Map은 삽입 순서 보존 → 오래된 것부터).
const PROBLEMS_CACHE_MAX_ENTRIES = 12;

function writeProblemsCache(sessionId: string, data: ProblemItem[]): void {
  problemsCache.delete(sessionId); // 재삽입해서 최근 사용 순서를 유지
  problemsCache.set(sessionId, data);
  while (problemsCache.size > PROBLEMS_CACHE_MAX_ENTRIES) {
    const oldest = problemsCache.keys().next();
    if (oldest.done) break;
    problemsCache.delete(oldest.value);
  }
}

export const QuickLabelingCard: React.FC<QuickLabelingCardProps> = ({
  sessionId,
  imageUrl,
  imageUrls,
  analysisModel,
  modelsUsed,
  onSave,
  onDelete,
}) => {
  const { language } = useLanguage();
  const t = getTranslation(language);
  const navigate = useNavigate();
  // 렌더 중에 캐시를 읽는다. effect에서 읽으면 페인트가 한 번 지나간 뒤라 스피너가 깜빡인다.
  // 두 마운트 지점 모두 key={session.id}라 인스턴스당 sessionId가 고정된다 —
  // 아래 지연 초기화가 첫 렌더에서만 돌아도 세션이 뒤바뀔 일이 없다.
  const cachedOnMount = problemsCache.get(sessionId);
  const [seed] = useState<EditorSeed>(() => deriveEditorSeed(cachedOnMount ?? []));

  const [problems, setProblems] = useState<ProblemItem[]>(() => cachedOnMount ?? []);
  const [labels, setLabels] = useState<Record<string, 'O' | 'X'>>(() => seed.labels);
  const [editableAnswers, setEditableAnswers] = useState<Record<string, string>>(() => seed.answers);
  const [editableCorrectAnswers, setEditableCorrectAnswers] = useState<Record<string, string>>(() => seed.correctAnswers);
  // 다중정답 객관식(multi_answer_contract v1) — 정답/사용자답을 번호 집합으로 편집
  const [multiUserAnswers, setMultiUserAnswers] = useState<Record<string, number[]>>(() => seed.multiUser);
  const [multiCorrectAnswers, setMultiCorrectAnswers] = useState<Record<string, number[]>>(() => seed.multiCorrect);
  // 다중빈칸 서술형(multi_blank) — 빈칸별 사용자답/정답을 문자열 배열로 편집(빈 문자열='')
  const [editableBlankUser, setEditableBlankUser] = useState<Record<string, string[]>>(() => seed.blankUser);
  const [editableBlankCorrect, setEditableBlankCorrect] = useState<Record<string, string[]>>(() => seed.blankCorrect);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(() => !cachedOnMount);
  const [lightboxImageUrl, setLightboxImageUrl] = useState<string | null>(null);

  // 실제 표시할 이미지 목록 결정
  const displayImageUrls = (imageUrls && imageUrls.length > 0) ? imageUrls : (imageUrl ? [imageUrl] : []);

  useEffect(() => {
    // 캐시가 있으면 스피너 없이 조용히 재검증한다(stale-while-revalidate).
    loadProblems(!problemsCache.has(sessionId));
  }, [sessionId]);

  const loadProblems = async (showLoading: boolean) => {
    try {
      if (showLoading) setLoading(true);
      const cached = problemsCache.get(sessionId);
      const data = await fetchSessionProblems(sessionId);
      writeProblemsCache(sessionId, data);

      // 캐시 히트로 조용히 재검증한 경우, 화면은 이미 상호작용 가능한 상태다.
      // 서버 응답이 캐시와 같으면 파생 상태를 다시 시드하지 않는다 — 사용자가 방금 누른
      // O/X나 고쳐 쓴 답을 응답 도착 시점에 되돌려 버리는 사고를 막는다.
      // 실제로 달라졌다면 서버가 정답이므로 그때는 다시 시드한다.
      if (cached && JSON.stringify(cached) === JSON.stringify(data)) return;

      setProblems(data);
      const next = deriveEditorSeed(data);
      setLabels(next.labels);
      setEditableAnswers(next.answers);
      setEditableCorrectAnswers(next.correctAnswers);
      setMultiUserAnswers(next.multiUser);
      setMultiCorrectAnswers(next.multiCorrect);
      setEditableBlankUser(next.blankUser);
      setEditableBlankCorrect(next.blankCorrect);
    } catch (error) {
      console.error('Failed to load problems:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleMarkChange = (index: number, mark: 'O' | 'X') => {
    setLabels(prev => ({
      ...prev,
      [`${index}`]: mark
    }));
  };

  // 복수답안·형식불일치 문항은 단일값 비교로 채점 불가 → 편집 시 자동판정 스킵(수동 O/X만 허용)
  const shouldSkipAutoJudge = (index: number, userAnswer: string, correctAnswer: string): boolean => {
    const problem = problems.find(p => p.index === index);
    return getManualReviewReason({
      instruction: problem?.instruction,
      correctAnswer,
      userAnswer,
      hasChoices: (problem?.문제_보기?.length ?? 0) > 0,
    }) !== null;
  };

  const handleAnswerChange = (index: number, value: string) => {
    setEditableAnswers(prev => ({ ...prev, [`${index}`]: value }));
    // 사용자 답안 변경 시 자동 재판정
    const correctAnswer = editableCorrectAnswers[`${index}`] ?? '';
    if (shouldSkipAutoJudge(index, value, correctAnswer)) return;
    const result = autoJudge(value, correctAnswer);
    if (result !== null) {
      setLabels(prev => ({ ...prev, [`${index}`]: result }));
    }
  };

  const handleCorrectAnswerChange = (index: number, value: string) => {
    setEditableCorrectAnswers(prev => ({ ...prev, [`${index}`]: value }));
    // 정답 변경 시 자동 재판정
    const userAnswer = editableAnswers[`${index}`] ?? '';
    if (shouldSkipAutoJudge(index, userAnswer, value)) return;
    const result = autoJudge(userAnswer, value);
    if (result !== null) {
      setLabels(prev => ({ ...prev, [`${index}`]: result }));
    }
  };

  // 다중정답 객관식 — 정답/사용자답 번호 칩 토글 + 집합 완전일치로 자동 재판정
  const handleMultiToggle = (index: number, kind: 'user' | 'correct', num: number) => {
    const key = `${index}`;
    const source = kind === 'user' ? multiUserAnswers : multiCorrectAnswers;
    const setSource = kind === 'user' ? setMultiUserAnswers : setMultiCorrectAnswers;
    const cur = new Set(source[key] ?? []);
    if (cur.has(num)) cur.delete(num); else cur.add(num);
    const nextArr = Array.from(cur).sort((a, b) => a - b);
    setSource(prev => ({ ...prev, [key]: nextArr }));

    const otherArr = kind === 'user' ? (multiCorrectAnswers[key] ?? []) : (multiUserAnswers[key] ?? []);
    const userArr = kind === 'user' ? nextArr : otherArr;
    const correctArr = kind === 'correct' ? nextArr : otherArr;
    // 양쪽 다 비어있지 않을 때만 자동 재판정(백엔드 computeIsCorrect 조건과 동일)
    if (userArr.length > 0 && correctArr.length > 0) {
      const result = eqSet(new Set(userArr), new Set(correctArr)) ? 'O' : 'X';
      setLabels(prev => ({ ...prev, [key]: result }));
    }
  };

  // 다중빈칸 서술형 — 빈칸별 사용자답/정답 텍스트 편집(자동 채점은 하지 않음, 수동 O/X만)
  const handleBlankChange = (index: number, kind: 'user' | 'correct', bi: number, value: string) => {
    const setSource = kind === 'user' ? setEditableBlankUser : setEditableBlankCorrect;
    setSource(prev => {
      const key = `${index}`;
      const arr = [...(prev[key] ?? [])];
      arr[bi] = value;
      return { ...prev, [key]: arr };
    });
  };

  const handleDeleteProblem = async (problem: ProblemItem) => {
    if (!problem.id) return;
    try {
      await deleteProblems([problem.id]);
      problemsCache.delete(sessionId); // 서버가 바뀌었다 — 다음 마운트는 새로 받는다
      const key = `${problem.index}`;
      setProblems(prev => prev.filter(p => p.index !== problem.index));
      setLabels(prev => { const next = { ...prev }; delete next[key]; return next; });
      setEditableAnswers(prev => { const next = { ...prev }; delete next[key]; return next; });
      setEditableCorrectAnswers(prev => { const next = { ...prev }; delete next[key]; return next; });
      setMultiUserAnswers(prev => { const next = { ...prev }; delete next[key]; return next; });
      setMultiCorrectAnswers(prev => { const next = { ...prev }; delete next[key]; return next; });
      setEditableBlankUser(prev => { const next = { ...prev }; delete next[key]; return next; });
      setEditableBlankCorrect(prev => { const next = { ...prev }; delete next[key]; return next; });
    } catch (err) {
      console.error('Failed to delete problem:', err);
      alert(language === 'ko' ? '문제 삭제 중 오류가 발생했습니다.' : 'Error deleting problem.');
    }
  };

  const handleSave = async () => {
    if (problems.length === 0) {
      alert(language === 'ko' ? '저장할 문제가 없습니다.' : 'No problems to save.');
      return;
    }

    const itemsToSave: ProblemItem[] = problems.map(p => {
      const isMulti = p.answerFormat === 'multi';
      const isMultiBlank = toCardinality(p.answerFormat) === 'list';
      const userArr = multiUserAnswers[`${p.index}`] ?? p.userAnswers ?? [];
      const correctArr = multiCorrectAnswers[`${p.index}`] ?? p.correctAnswers ?? [];

      if (isMultiBlank) {
        // 빈칸별 편집값 → (string|null)[] 로 정규화(빈 문자열=null) + flat 표시문자열 재조립.
        // 채점은 여전히 수동(자동 O/X 없음) — 사용자 O/X 마크만 존중.
        const bu = editableBlankUser[`${p.index}`] ?? (p.blankUserAnswers ?? []).map(x => x == null ? '' : String(x));
        const bc = editableBlankCorrect[`${p.index}`] ?? (p.blankCorrectAnswers ?? []).map(x => x == null ? '' : String(x));
        const toNullable = (v: string) => (v == null || String(v).trim() === '') ? null : String(v);
        const buN = bu.map(toNullable);
        const bcN = bc.map(toNullable);
        const flatUser = buN.map((v, i) => `(${i + 1}) ${v == null ? '[빈칸]' : v}`).join(' ');
        const flatCorrect = bcN.map((v, i) => `(${i + 1}) ${v == null ? '' : v}`).join(' ');
        return {
          ...p,
          사용자가_직접_채점한_정오답: labels[`${p.index}`] || p.사용자가_직접_채점한_정오답,
          사용자가_기술한_정답: { ...p.사용자가_기술한_정답, text: flatUser },
          correct_answer: flatCorrect,
          blankUserAnswers: buN,
          blankCorrectAnswers: bcN,
        };
      }

      return {
        ...p,
        사용자가_직접_채점한_정오답: labels[`${p.index}`] || p.사용자가_직접_채점한_정오답,
        사용자가_기술한_정답: {
          ...p.사용자가_기술한_정답,
          text: isMulti ? userArr.join(', ') : (editableAnswers[`${p.index}`] ?? p.사용자가_기술한_정답?.text ?? ''),
        },
        correct_answer: isMulti ? correctArr.join(', ') : (editableCorrectAnswers[`${p.index}`] ?? p.correct_answer ?? ''),
        userAnswers: isMulti ? userArr : p.userAnswers,
        correctAnswers: isMulti ? correctArr : p.correctAnswers,
      };
    });

    try {
      setSaving(true);
      await updateProblemLabels(sessionId, itemsToSave);
      problemsCache.delete(sessionId); // 채점이 저장됐다 — 캐시된 미채점 스냅샷은 이제 거짓이다
      alert(language === 'ko' ? '저장 완료! 통계에 반영되었습니다.' : 'Saved! Stats updated.');
      onSave?.();
    } catch (error) {
      console.error('Failed to save labels:', error);
      alert(language === 'ko' ? '저장 중 오류가 발생했습니다.' : 'Error while saving.');
    } finally {
      setSaving(false);
    }
  };

  const getTypeLabel = (type: QuestionType): string => {
    const map: Record<QuestionType, { ko: string; en: string }> = {
      multiple_choice: { ko: '객관식', en: 'Multiple Choice' },
      short_answer: { ko: '주관식', en: 'Short Answer' },
      essay: { ko: '서술형', en: 'Essay' },
      ox: { ko: 'O/X', en: 'True/False' },
      unknown: { ko: '기타', en: 'Other' },
    };
    return language === 'ko' ? map[type].ko : map[type].en;
  };

  if (loading) {
    return (
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-lg p-3 sm:p-6 md:p-8 border border-slate-200 dark:border-slate-700 mb-4 sm:mb-6">
        <div className="text-center py-6 sm:py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600 dark:border-indigo-400 mx-auto"></div>
          <p className="mt-4 text-slate-600 dark:text-slate-400">
            {language === 'ko' ? '문제 불러오는 중...' : 'Loading problems...'}
          </p>
        </div>
      </div>
    );
  }

  const isMany = displayImageUrls.length > 4;

  const thumbnails = (
    <div className={`flex flex-wrap gap-1.5 sm:gap-2 ${isMany ? 'w-full mb-3 sm:mb-4' : 'flex-shrink-0'}`}>
      {displayImageUrls.map((url, idx) => (
        <img
          key={`${idx}-${url}`}
          src={url}
          alt={language === 'ko' ? `문제 이미지 ${idx + 1}` : `Problem Image ${idx + 1}`}
          className={`${isMany ? 'w-12 h-12 sm:w-16 sm:h-16' : 'w-16 h-16 sm:w-24 sm:h-24'} object-cover rounded border border-slate-300 dark:border-slate-600 cursor-pointer hover:opacity-80 hover:ring-2 hover:ring-indigo-400 transition-all`}
          onClick={() => setLightboxImageUrl(url)}
          title={language === 'ko' ? '클릭하여 원본 보기' : 'Click to view original'}
        />
      ))}
    </div>
  );

  const headerContent = (
    <div className="flex-1 min-w-0">
      <div className="flex flex-wrap items-center gap-1.5 sm:gap-2 mb-1.5 sm:mb-2">
        <h3 className="text-base sm:text-xl font-bold text-slate-800 dark:text-slate-200">
          {language === 'ko' ? 'AI 분석 완료' : 'AI Analysis Complete'}
        </h3>
        {modelsUsed ? (
          <div className="flex flex-wrap gap-1">
            <span className="text-xs px-2 py-0.5 rounded bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-700">
              OCR: {modelsUsed.ocr || '?'}
            </span>
            <span className="text-xs px-2 py-0.5 rounded bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-700">
              {language === 'ko' ? '분석' : 'Analysis'}: {modelsUsed.analysis || '?'}
            </span>
          </div>
        ) : analysisModel ? (
          <span className="text-xs px-2 py-1 rounded bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-600">
            Model: {analysisModel}
          </span>
        ) : null}
      </div>
      <p className="text-xs sm:text-base text-slate-600 dark:text-slate-400">
        {language === 'ko'
          ? `AI가 분석한 문제 ${problems.length}개를 확인하고 검수해주세요.`
          : `Please review and verify ${problems.length} problem(s) analyzed by AI.`}
      </p>
      {displayImageUrls.length > 1 && (
        <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
          {language === 'ko'
            ? `이미지 ${displayImageUrls.length}장 (클릭하여 확대)`
            : `${displayImageUrls.length} images (click to enlarge)`}
        </p>
      )}
    </div>
  );

  return (
    <div className="relative bg-white dark:bg-slate-800 rounded-2xl shadow-lg p-3 sm:p-6 md:p-8 border border-slate-200 dark:border-slate-700 mb-4 sm:mb-6 overflow-hidden">
      {onDelete && (
        <button
          type="button"
          onClick={() => onDelete(sessionId)}
          aria-label={language === 'ko' ? '세션 삭제' : 'Delete session'}
          title={language === 'ko' ? '삭제' : 'Delete'}
          className="absolute right-2 top-2 sm:right-3 sm:top-3 z-10 inline-flex h-10 w-10 sm:h-9 sm:w-9 items-center justify-center rounded-full bg-red-50 text-red-700 hover:bg-red-100 dark:bg-red-900/20 dark:text-red-200 dark:hover:bg-red-900/40"
        >
          <span className="text-xl leading-none">&times;</span>
        </button>
      )}
      {isMany ? (
        <div className={`mb-4 sm:mb-6 ${onDelete ? 'pr-9 sm:pr-0' : ''}`}>
          {thumbnails}
          {headerContent}
        </div>
      ) : (
        // 모바일은 세로로 쌓는다. 360px에서 가로 배치하면 썸네일 3장(64px×3 + 여백)이
        // 220px 넘게 먹고 카드 패딩·삭제버튼 여백까지 빼면 텍스트 칼럼에 90px도 안 남는다.
        // 실제로 'AI 분석 완 / 료'로 제목이 쪼개지고 모델 배지가 세로로 늘어졌다.
        <div className={`flex flex-col sm:flex-row sm:items-start gap-3 sm:gap-6 mb-4 sm:mb-6 ${onDelete ? 'pr-9 sm:pr-0' : ''}`}>
          {thumbnails}
          {headerContent}
        </div>
      )}

      {/* 문제 목록 */}
      <div className="space-y-2 sm:space-y-4 mb-4 sm:mb-6">
        {problems.map((problem) => {
          // 라벨 없으면 undefined 유지 — O/X 어느 버튼도 강조 안 함. (기존 `|| 'O'`는 미채점/빈답 문항의 O 버튼을 파랗게 켜서 '정답'처럼 보이게 하던 문제)
          const currentMark = labels[`${problem.index}`];
          // 복수답안·형식불일치 감지(편집 중 값 반영) → AI 판정 배지 숨기고 '수동 확인' 안내
          // multi는 correctAnswers/userAnswers가 확신 추출된 경우 null(자동채점 신뢰)
          const isMulti = problem.answerFormat === 'multi';
          // 다중빈칸 서술형(multi_blank): 빈칸별 사용자답/정답을 N행으로 분리, 각 칸 편집 가능. 채점은 수동 O/X만.
          const isMultiBlank = toCardinality(problem.answerFormat) === 'list';
          const blankUser = editableBlankUser[`${problem.index}`] ?? (problem.blankUserAnswers ?? []).map(x => x == null ? '' : String(x));
          const blankCorrect = editableBlankCorrect[`${problem.index}`] ?? (problem.blankCorrectAnswers ?? []).map(x => x == null ? '' : String(x));
          const blankCount = Math.max(blankUser.length, blankCorrect.length);
          const currentCorrectAnswers = multiCorrectAnswers[`${problem.index}`] ?? problem.correctAnswers;
          const currentUserAnswers = multiUserAnswers[`${problem.index}`] ?? problem.userAnswers;
          const reviewReason = getManualReviewReason({
            instruction: problem.instruction,
            correctAnswer: editableCorrectAnswers[`${problem.index}`] ?? problem.correct_answer,
            userAnswer: editableAnswers[`${problem.index}`] ?? problem.사용자가_기술한_정답?.text,
            hasChoices: (problem.문제_보기?.length ?? 0) > 0,
            answerFormat: problem.answerFormat,
            correctAnswers: currentCorrectAnswers,
            userAnswers: currentUserAnswers,
          });
          const aiMark = reviewReason ? undefined : problem.AI가_판단한_정오답;
          const qType = inferQuestionType(problem);

          return (
            <div key={problem.index} className="relative border border-slate-200 dark:border-slate-700 rounded-lg p-2.5 sm:p-4 bg-slate-50 dark:bg-slate-900/50">
              <div className="flex flex-col xl:flex-row items-start justify-between gap-2 sm:gap-4">
                <div className="flex-1 w-full min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5 sm:gap-3 mb-1.5 sm:mb-2">
                    <span className="font-bold text-base sm:text-lg text-slate-700 dark:text-slate-300">Q{problem.index + 1}</span>
                    <span className="text-xs px-2 py-0.5 rounded bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-700">
                      {getTypeLabel(qType)}
                    </span>
                    {aiMark && (
                      <span className="text-xs px-2 py-1 rounded bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300">
                        AI: {aiMark}
                      </span>
                    )}
                    {isMulti && !reviewReason && (
                      <span className="text-xs px-2 py-1 rounded bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-700">
                        {t.labeling.multiAnswerAuto}
                      </span>
                    )}
                    {reviewReason && (
                      <span
                        className="text-xs px-2 py-1 rounded bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 border border-amber-300 dark:border-amber-700"
                        title={language === 'ko'
                          ? (reviewReason === '복수정답'
                              ? '정답이 여러 개인 문항입니다. 답안을 구분해 확인 후 직접 채점하세요.'
                              : '숫자/단어 형식이 맞지 않아 자동 채점을 보류했습니다. 직접 확인하세요.')
                          : 'Auto-grading withheld — please review manually.'}
                      >
                        {language === 'ko'
                          ? (reviewReason === '복수정답' ? '복수 정답 · 수동 확인' : '형식 확인 · 수동 확인')
                          : (reviewReason === '복수정답' ? 'Multiple answers · review' : 'Check format · review')}
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => handleDeleteProblem(problem)}
                      aria-label={language === 'ko' ? '문제 삭제' : 'Delete problem'}
                      title={language === 'ko' ? '이 문제 삭제' : 'Delete this problem'}
                      className="ml-auto inline-flex h-10 w-10 sm:h-7 sm:w-7 items-center justify-center rounded-full bg-slate-200 text-slate-600 hover:bg-red-100 hover:text-red-600 dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-red-900/40 dark:hover:text-red-400 transition-colors shadow-sm"
                    >
                      <span className="text-lg leading-none">&times;</span>
                    </button>
                  </div>

                  {/* 문제 내용 — 분리 표시 (지문/시각자료/지시문/본문/보기) */}
                  <div className="mb-3 space-y-2">
                    {problem.passage && (
                      <div className="rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/40 p-2">
                        <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400 mb-1">
                          {language === 'ko' ? '지문' : 'Passage'}
                        </div>
                        <p className="text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap break-words leading-relaxed">{problem.passage}</p>
                      </div>
                    )}
                    {problem.visual_context && (problem.visual_context.title || problem.visual_context.content) && (
                      <div className="rounded border border-amber-200 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 p-2">
                        <div className="text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400 mb-1">
                          {problem.visual_context.type || (language === 'ko' ? '자료' : 'Visual')}
                          {problem.visual_context.title ? ` — ${problem.visual_context.title}` : ''}
                        </div>
                        {problem.visual_context.content && (
                          <p className="text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap break-words">{problem.visual_context.content}</p>
                        )}
                      </div>
                    )}
                    {problem.instruction && (
                      <div>
                        <div className="text-[10px] font-semibold uppercase tracking-wide text-indigo-600 dark:text-indigo-400 mb-1">
                          {language === 'ko' ? '지시문' : 'Instruction'}
                        </div>
                        <p className="text-sm sm:text-base text-slate-800 dark:text-slate-200 font-semibold">{problem.instruction}</p>
                      </div>
                    )}
                    {problem.question_body && (
                      <div>
                        <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400 mb-1">
                          {language === 'ko' ? '문제 본문' : 'Question'}
                        </div>
                        <p className="text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap break-words">{problem.question_body}</p>
                      </div>
                    )}
                    {/* 분리 필드가 하나도 없을 때만 stem 폴백 표시 */}
                    {!problem.passage && !problem.instruction && !problem.question_body && !problem.visual_context && (
                      <p className="text-sm sm:text-base text-slate-700 dark:text-slate-300 font-medium whitespace-pre-wrap break-words">{problem.문제내용.text}</p>
                    )}
                    {qType === 'multiple_choice' && problem.문제_보기 && problem.문제_보기.length > 0 && (
                      <div>
                        <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400 mb-1">
                          {language === 'ko' ? '보기' : 'Choices'}
                        </div>
                        <ol className="list-decimal list-inside text-sm text-slate-600 dark:text-slate-400 space-y-1">
                          {problem.문제_보기.map((choice, idx) => (
                            <li key={idx}>{choice.text}</li>
                          ))}
                        </ol>
                      </div>
                    )}
                    {qType === 'ox' && (
                      <p className="text-sm text-slate-500 dark:text-slate-400 italic">
                        {language === 'ko' ? 'O/X 판별 문제' : 'True/False question'}
                      </p>
                    )}
                    {(qType === 'essay' || qType === 'short_answer') && (!problem.문제_보기 || problem.문제_보기.length === 0) && (
                      <p className="text-sm text-slate-500 dark:text-slate-400 italic">
                        {qType === 'essay'
                          ? (language === 'ko' ? '서술형 문제' : 'Essay question')
                          : (language === 'ko' ? '주관식 문제' : 'Short answer question')}
                      </p>
                    )}
                  </div>

                  {/* 사용자 답안 + 정답 */}
                  {isMultiBlank ? (
                    // 다중빈칸 서술형 — 한 문항의 (1)(2)(3) 빈칸을 행별로 분리, 각 칸 편집 가능. 채점은 수동 O/X만.
                    <div className="mb-3 space-y-2">
                      <div className="text-sm text-slate-500 dark:text-slate-400 mb-1">
                        {language === 'ko' ? `빈칸 ${blankCount}개 (빈칸별 답안)` : `${blankCount} blanks (per-blank answers)`}
                      </div>
                      <div className="space-y-2">
                        {Array.from({ length: blankCount }).map((_, bi) => (
                          <div key={bi} className="flex items-start gap-2 text-sm">
                            <span className="mt-1.5 inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-slate-200 dark:bg-slate-700 px-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300 flex-shrink-0">
                              {bi + 1}
                            </span>
                            <div className="flex-1 min-w-0 space-y-1">
                              <div className="flex items-center gap-1.5">
                                <span className="text-slate-500 dark:text-slate-400 whitespace-nowrap min-w-[44px] sm:min-w-[52px]">{language === 'ko' ? '사용자:' : 'User:'}</span>
                                <input
                                  type="text"
                                  value={blankUser[bi] ?? ''}
                                  onChange={(e) => handleBlankChange(problem.index, 'user', bi, e.target.value)}
                                  placeholder={language === 'ko' ? '미작성' : 'blank'}
                                  className="flex-1 px-2 py-2 text-base sm:py-1 sm:text-sm border border-slate-300 dark:border-slate-600 rounded bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-200 focus:ring-1 focus:ring-indigo-500"
                                />
                              </div>
                              <div className="flex items-center gap-1.5">
                                <span className="text-slate-500 dark:text-slate-400 whitespace-nowrap min-w-[44px] sm:min-w-[52px]">{language === 'ko' ? '정답:' : 'Answer:'}</span>
                                <input
                                  type="text"
                                  value={blankCorrect[bi] ?? ''}
                                  onChange={(e) => handleBlankChange(problem.index, 'correct', bi, e.target.value)}
                                  placeholder={language === 'ko' ? '정답 입력' : 'Enter answer'}
                                  className="flex-1 px-2 py-2 text-base sm:py-1 sm:text-sm border border-slate-300 dark:border-slate-600 rounded bg-white dark:bg-slate-700 text-green-700 dark:text-green-400 font-medium focus:ring-1 focus:ring-green-500"
                                />
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                      <div className="text-xs text-amber-700 dark:text-amber-400">
                        {language === 'ko' ? '※ 빈칸별 서술형 — 자동 채점 대신 수동 확인' : '※ Per-blank essay — manual review (no auto-grading)'}
                      </div>
                    </div>
                  ) : isMulti ? (
                    // 다중정답 객관식 — 번호 칩 다중 선택(정답=초록, 사용자 오선택=빨강)
                    <div className="mb-3 space-y-2">
                      <div>
                        <div className="text-sm text-slate-500 dark:text-slate-400 mb-1">{t.labeling.multiUserPicks}</div>
                        <div className="flex flex-wrap gap-1.5">
                          {problem.문제_보기.map((choice, idx) => {
                            const num = idx + 1;
                            const userSet = new Set(currentUserAnswers ?? []);
                            const correctSet = new Set(currentCorrectAnswers ?? []);
                            const selected = userSet.has(num);
                            const wrong = selected && !correctSet.has(num);
                            return (
                              <button
                                key={num}
                                type="button"
                                title={choice.text}
                                onClick={() => handleMultiToggle(problem.index, 'user', num)}
                                className={`w-10 h-10 sm:w-8 sm:h-8 rounded-full text-sm font-semibold border transition-colors ${
                                  selected
                                    ? (wrong
                                        ? 'bg-red-600 text-white border-red-600'
                                        : 'bg-blue-600 text-white border-blue-600')
                                    : 'bg-white dark:bg-slate-700 text-slate-600 dark:text-slate-300 border-slate-300 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-600'
                                }`}
                              >
                                {num}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                      <div>
                        <div className="text-sm text-slate-500 dark:text-slate-400 mb-1">{t.labeling.multiCorrectPicks}</div>
                        <div className="flex flex-wrap gap-1.5">
                          {problem.문제_보기.map((choice, idx) => {
                            const num = idx + 1;
                            const selected = new Set(currentCorrectAnswers ?? []).has(num);
                            return (
                              <button
                                key={num}
                                type="button"
                                title={choice.text}
                                onClick={() => handleMultiToggle(problem.index, 'correct', num)}
                                className={`w-10 h-10 sm:w-8 sm:h-8 rounded-full text-sm font-semibold border transition-colors ${
                                  selected
                                    ? 'bg-emerald-600 text-white border-emerald-600'
                                    : 'bg-white dark:bg-slate-700 text-slate-600 dark:text-slate-300 border-slate-300 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-600'
                                }`}
                              >
                                {num}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  ) : (
                    // 단일답/주관식 (편집 가능 텍스트 입력) — 기존 UI 불변
                    <div className="mb-3 space-y-2">
                      <div className="flex items-center gap-2">
                        <span className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 whitespace-nowrap min-w-[62px] sm:min-w-[70px]">
                          {language === 'ko' ? '사용자 답안:' : 'User answer:'}
                        </span>
                        <input
                          type="text"
                          value={editableAnswers[`${problem.index}`] ?? ''}
                          onChange={(e) => handleAnswerChange(problem.index, e.target.value)}
                          placeholder={language === 'ko' ? '답안 입력' : 'Enter answer'}
                          className="flex-1 px-2 py-2 text-base sm:py-1 sm:text-sm border border-slate-300 dark:border-slate-600 rounded bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-200 focus:ring-1 focus:ring-indigo-500"
                        />
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 whitespace-nowrap min-w-[62px] sm:min-w-[70px]">
                          {language === 'ko' ? '실제 정답:' : 'Correct answer:'}
                        </span>
                        <input
                          type="text"
                          value={editableCorrectAnswers[`${problem.index}`] ?? ''}
                          onChange={(e) => handleCorrectAnswerChange(problem.index, e.target.value)}
                          placeholder={language === 'ko' ? '정답 입력' : 'Enter correct answer'}
                          className="flex-1 px-2 py-2 text-base sm:py-1 sm:text-sm border border-slate-300 dark:border-slate-600 rounded bg-white dark:bg-slate-700 text-green-700 dark:text-green-400 font-medium focus:ring-1 focus:ring-green-500"
                        />
                      </div>
                    </div>
                  )}

                  {/* 문제 유형 분류 */}
                  {problem.문제_유형_분류 && (
                    <div className="text-xs text-slate-500 dark:text-slate-400">
                      {[
                        problem.문제_유형_분류.depth1,
                        problem.문제_유형_분류.depth2,
                        problem.문제_유형_분류.depth3,
                        problem.문제_유형_분류.depth4,
                      ].filter(Boolean).join(' > ')}
                    </div>
                  )}
                </div>

                {/* 정답/오답 버튼 */}
                <div className="flex w-full gap-2 xl:w-auto xl:flex-shrink-0">
                  <button
                    onClick={() => handleMarkChange(problem.index, 'O')}
                    className={`flex-1 xl:flex-none px-4 py-2.5 sm:py-2 rounded-lg font-medium transition-colors ${currentMark === 'O'
                      ? 'bg-blue-600 dark:bg-blue-500 text-white'
                      : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600'
                      }`}
                  >
                    {t.labeling.correct}
                  </button>
                  <button
                    onClick={() => handleMarkChange(problem.index, 'X')}
                    className={`flex-1 xl:flex-none px-4 py-2.5 sm:py-2 rounded-lg font-medium transition-colors ${currentMark === 'X'
                      ? 'bg-red-600 dark:bg-red-500 text-white'
                      : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600'
                      }`}
                  >
                    {t.labeling.incorrect}
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* 저장 및 상세보기 버튼 */}
      <div className="flex gap-2 sm:gap-3 justify-end">
        <button
          onClick={() => navigate(`/session/${sessionId}`)}
          className="flex-1 sm:flex-none px-4 sm:px-6 py-2.5 sm:py-2 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg font-semibold hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
        >
          {t.labeling.viewDetails}
        </button>
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex-1 sm:flex-none px-4 sm:px-6 py-2.5 sm:py-2 bg-indigo-600 dark:bg-indigo-500 text-white rounded-lg font-semibold hover:bg-indigo-700 dark:hover:bg-indigo-600 disabled:bg-gray-400 dark:disabled:bg-gray-600 disabled:cursor-not-allowed transition-colors"
        >
          {saving ? t.labeling.saving : t.labeling.finalSave}
        </button>
      </div>
      {lightboxImageUrl && (
        <ImageLightbox
          imageUrl={lightboxImageUrl}
          alt={language === 'ko' ? '문제 이미지' : 'Problem Image'}
          onClose={() => setLightboxImageUrl(null)}
        />
      )}
    </div>
  );
};
