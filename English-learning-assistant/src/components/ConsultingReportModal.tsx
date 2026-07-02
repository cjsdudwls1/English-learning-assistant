import React, { useState } from 'react';

interface ConsultingReportModalProps {
  language: 'ko' | 'en';
  report: string;
  scopeLabel?: string;
  isOpen: boolean;
  onClose: () => void;
}

/** 인라인 마크다운 처리: 굵게(**..**), 기울임(*..* / _.._), 인라인 코드(`..`). */
function renderInline(text: string, keyPrefix: string): React.ReactNode[] {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|_[^_]+_)/g);
  return parts.map((p, i) => {
    const key = `${keyPrefix}-${i}`;
    if (!p) return null;
    if (/^`[^`]+`$/.test(p)) {
      return <code key={key} className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-700/70 text-[0.88em] font-mono text-rose-600 dark:text-rose-300">{p.slice(1, -1)}</code>;
    }
    if (/^\*\*[^*]+\*\*$/.test(p)) {
      return <strong key={key} className="font-semibold text-slate-900 dark:text-slate-100">{p.slice(2, -2)}</strong>;
    }
    if (/^\*[^*]+\*$/.test(p) || /^_[^_]+_$/.test(p)) {
      return <em key={key} className="italic">{p.slice(1, -1)}</em>;
    }
    return <React.Fragment key={key}>{p}</React.Fragment>;
  });
}

type ListState = { type: 'ul' | 'ol'; items: string[] } | null;

/** 프롬프트 마크다운(제목 #~######, 순서/비순서 목록, 구분선 ---, 문단, 인라인)을 가독성 좋은 JSX로 변환. */
function renderMarkdown(md: string): React.ReactNode {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const blocks: React.ReactNode[] = [];
  let list: ListState = null;
  let key = 0;

  const flushList = () => {
    if (!list || list.items.length === 0) { list = null; return; }
    const { type, items } = list;
    const liNodes = items.map((li, i) => (
      <li key={i} className="pl-1 leading-relaxed">{renderInline(li, `li-${key}-${i}`)}</li>
    ));
    if (type === 'ol') {
      blocks.push(
        <ol key={`ol-${key++}`} className="list-decimal pl-6 space-y-1.5 my-3 marker:font-medium marker:text-slate-400 dark:marker:text-slate-500">{liNodes}</ol>
      );
    } else {
      blocks.push(
        <ul key={`ul-${key++}`} className="list-disc pl-6 space-y-1.5 my-3 marker:text-violet-400 dark:marker:text-violet-400">{liNodes}</ul>
      );
    }
    list = null;
  };

  for (const raw of lines) {
    const trimmed = raw.trim();

    if (trimmed === '') { flushList(); continue; }

    // 수평 구분선 (---, ***, ___)
    if (/^([-*_])\1{2,}$/.test(trimmed)) {
      flushList();
      blocks.push(<hr key={`hr-${key++}`} className="my-5 border-t border-slate-200 dark:border-slate-700" />);
      continue;
    }

    // 순서 목록 (1. / 1) )
    const ol = trimmed.match(/^(\d+)[.)]\s+(.*)$/);
    if (ol) {
      if (!list || list.type !== 'ol') { flushList(); list = { type: 'ol', items: [] }; }
      list.items.push(ol[2]);
      continue;
    }

    // 비순서 목록 (-, *, •)
    const ul = trimmed.match(/^[-*•]\s+(.*)$/);
    if (ul) {
      if (!list || list.type !== 'ul') { flushList(); list = { type: 'ul', items: [] }; }
      list.items.push(ul[1]);
      continue;
    }

    flushList();

    const h = trimmed.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      const level = h[1].length;
      const content = renderInline(h[2], `h-${key}`);
      if (level === 1) {
        blocks.push(
          <h2 key={`h-${key++}`} className="text-lg md:text-xl font-bold mt-6 mb-3 first:mt-0 pl-3 border-l-4 border-violet-500 dark:border-violet-400 text-slate-900 dark:text-slate-100">{content}</h2>
        );
      } else if (level === 2) {
        blocks.push(
          <h3 key={`h-${key++}`} className="text-base md:text-lg font-semibold mt-5 mb-2 text-slate-800 dark:text-slate-200">{content}</h3>
        );
      } else {
        blocks.push(
          <h4 key={`h-${key++}`} className="text-sm md:text-base font-semibold mt-4 mb-1.5 text-violet-700 dark:text-violet-300">{content}</h4>
        );
      }
      continue;
    }

    blocks.push(
      <p key={`p-${key++}`} className="my-2.5 leading-7 text-slate-700 dark:text-slate-300">
        {renderInline(trimmed, `p-${key}`)}
      </p>
    );
  }
  flushList();

  return <>{blocks}</>;
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
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-slate-800 rounded-lg shadow-xl max-w-3xl w-full max-h-[88vh] flex flex-col">
        <div className="flex items-start justify-between p-5 border-b border-slate-200 dark:border-slate-700">
          <div>
            <h3 className="text-xl font-bold text-slate-800 dark:text-slate-200">
              {language === 'ko' ? '📋 학습 컨설팅 보고서' : '📋 Learning Consulting Report'}
            </h3>
            {scopeLabel && (
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                {language === 'ko' ? '범위' : 'Scope'}: {scopeLabel}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleCopy}
              className="px-3 py-1.5 text-sm bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 rounded hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors"
            >
              {copied ? (language === 'ko' ? '복사됨' : 'Copied') : (language === 'ko' ? '복사' : 'Copy')}
            </button>
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-sm bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 rounded hover:bg-slate-300 dark:hover:bg-slate-600 transition-colors"
            >
              {language === 'ko' ? '닫기' : 'Close'}
            </button>
          </div>
        </div>
        <div className="p-6 overflow-y-auto">
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
