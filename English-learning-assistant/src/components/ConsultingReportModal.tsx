import React, { useState } from 'react';
import { renderMarkdown } from '../utils/markdown';

interface ConsultingReportModalProps {
  language: 'ko' | 'en';
  report: string;
  scopeLabel?: string;
  isOpen: boolean;
  onClose: () => void;
}

export const ConsultingReportModal: React.FC<ConsultingReportModalProps> = ({
  language,
  report,
  scopeLabel,
  isOpen,
  onClose,
}) => {
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(report);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // 클립보드 실패는 조용히 무시
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-0 sm:p-4">
      <div className="bg-white dark:bg-slate-800 rounded-none sm:rounded-lg shadow-xl max-w-3xl w-full h-full sm:h-auto max-h-[100dvh] sm:max-h-[88vh] flex flex-col">
        <div className="shrink-0 flex items-start justify-between gap-2 p-3 sm:p-5 border-b border-slate-200 dark:border-slate-700">
          <div className="min-w-0">
            <h3 className="text-base sm:text-xl font-bold text-slate-800 dark:text-slate-200">
              {language === 'ko' ? '📋 학습 컨설팅 보고서' : '📋 Learning Consulting Report'}
            </h3>
            {scopeLabel && (
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                {language === 'ko' ? '범위' : 'Scope'}: {scopeLabel}
              </p>
            )}
          </div>
          <div className="shrink-0 flex items-center gap-2">
            <button
              onClick={handleCopy}
              className="relative px-3 py-1.5 text-sm bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 rounded hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors before:absolute before:content-[''] before:-inset-x-1 before:-inset-y-1"
            >
              {copied ? (language === 'ko' ? '복사됨' : 'Copied') : (language === 'ko' ? '복사' : 'Copy')}
            </button>
            <button
              onClick={onClose}
              className="relative px-3 py-1.5 text-sm bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 rounded hover:bg-slate-300 dark:hover:bg-slate-600 transition-colors before:absolute before:content-[''] before:-inset-x-1 before:-inset-y-1"
            >
              {language === 'ko' ? '닫기' : 'Close'}
            </button>
          </div>
        </div>
        <div className="flex-1 p-4 sm:p-6 overflow-y-auto">
          {report ? (
            <article className="max-w-none text-[15px] text-slate-700 dark:text-slate-300 break-keep">{renderMarkdown(report)}</article>
          ) : (
            <p className="text-slate-500 dark:text-slate-400">
              {language === 'ko' ? '생성된 보고서가 없습니다.' : 'No report generated.'}
            </p>
          )}
        </div>
      </div>
    </div>
  );
};
