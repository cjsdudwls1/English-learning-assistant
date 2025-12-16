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
  const stage = session.failure_stage ? String(session.failure_stage) : (language === 'ko' ? '알 수 없음' : 'Unknown');

  return (
    <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-lg p-6 md:p-8 border border-red-200 dark:border-red-800 mb-6">
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
          <div className="mt-2 text-sm text-slate-500 dark:text-slate-400">
            <span className="font-medium">{language === 'ko' ? 'failure_stage' : 'failure_stage'}: </span>
            <span>{stage}</span>
            {isDev && (
              <>
                <span className="mx-2">|</span>
                <span className="font-medium">sessionId: </span>
                <span className="font-mono break-all">{session.id}</span>
              </>
            )}
          </div>
          {onDelete && (
            <div className="mt-4 flex gap-2 justify-end">
              <button
                onClick={() => onDelete(session.id)}
                className="px-4 py-2 bg-red-600 text-white text-sm rounded-lg hover:bg-red-700"
              >
                {language === 'ko' ? '삭제' : 'Delete'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

