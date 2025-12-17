import React from 'react';
import type { SessionWithProblems } from '../types';
import { useLanguage } from '../contexts/LanguageContext';

interface FailedAnalysisCardProps {
  session: SessionWithProblems;
  onDelete?: (sessionId: string) => void;
}

export const FailedAnalysisCard: React.FC<FailedAnalysisCardProps> = ({ session, onDelete }) => {
  const { language } = useLanguage();
  const isDev = (import.meta as any).env?.DEV === true;
  const rawStage = session.failure_stage ? String(session.failure_stage) : '';
  const stageLabel = rawStage
    ? (language === 'ko' ? rawStage : rawStage)
    : (language === 'ko' ? '알 수 없음' : 'Unknown');

  const failureDetails = (() => {
    if (!session.failure_message) return null;
    try {
      return JSON.parse(String(session.failure_message));
    } catch {
      return { message: String(session.failure_message) };
    }
  })();

  const reasonText = (() => {
    const msg = failureDetails?.message ? String(failureDetails.message) : '';
    const code = failureDetails?.extra?.errorCode ?? failureDetails?.code ?? null;
    const status = failureDetails?.extra?.errorStatus ?? failureDetails?.status ?? null;
    const extraMsg = failureDetails?.extra?.errorMessage ? String(failureDetails.extra.errorMessage) : '';

    if (language === 'ko') {
      const parts: string[] = [];
      if (msg) parts.push(msg);
      if (code || status) parts.push(`(${[code && `code=${code}`, status && `status=${status}`].filter(Boolean).join(', ')})`);
      if (extraMsg && extraMsg.toLowerCase().includes('overloaded')) parts.push('※ 모델 과부하(overloaded)로 인한 일시적 실패');
      return parts.join(' ').trim();
    }

    const parts: string[] = [];
    if (msg) parts.push(msg);
    if (code || status) parts.push(`(${[code && `code=${code}`, status && `status=${status}`].filter(Boolean).join(', ')})`);
    return parts.join(' ').trim();
  })();

  return (
    <div className="relative bg-white dark:bg-slate-800 rounded-2xl shadow-lg p-6 md:p-8 border border-red-200 dark:border-red-800 mb-6">
      {onDelete && (
        <button
          type="button"
          onClick={() => onDelete(session.id)}
          aria-label={language === 'ko' ? '실패 세션 삭제' : 'Delete failed session'}
          title={language === 'ko' ? '삭제' : 'Delete'}
          className="absolute right-3 top-3 inline-flex h-9 w-9 items-center justify-center rounded-full bg-red-50 text-red-700 hover:bg-red-100 dark:bg-red-900/20 dark:text-red-200 dark:hover:bg-red-900/40"
        >
          <span className="text-xl leading-none">×</span>
        </button>
      )}
      <div className="flex items-start gap-6">
        <img
          src={session.image_url}
          alt={language === 'ko' ? '문제 이미지' : 'Problem Image'}
          className="w-24 h-24 object-cover rounded border border-slate-300 dark:border-slate-600 flex-shrink-0"
        />
        <div className="flex-1">
          <h3 className="text-xl font-bold text-red-700 dark:text-red-300 mb-2">
            {language === 'ko' ? '분석 실패(0문항)' : 'Analysis Failed (0 items)'}
          </h3>
          <p className="text-slate-600 dark:text-slate-400">
            {language === 'ko'
              ? '이미지에서 문제를 추출하지 못했습니다. 이미지 다시 업로드를 권장합니다.'
              : 'Failed to extract problems from the image. Please re-upload a clearer image.'}
          </p>
          {reasonText ? (
            <p className="mt-2 text-sm text-red-700/90 dark:text-red-200/90 break-words">
              {reasonText}
            </p>
          ) : null}
          <div className="mt-2 text-sm text-slate-500 dark:text-slate-400">
            <span className="font-medium">{language === 'ko' ? 'failure_stage' : 'failure_stage'}: </span>
            <span>{stageLabel}</span>
            {isDev && (
              <>
                <span className="mx-2">|</span>
                <span className="font-medium">sessionId: </span>
                <span className="font-mono break-all">{session.id}</span>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

