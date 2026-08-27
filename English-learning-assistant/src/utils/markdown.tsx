/**
 * 모델이 쓴 마크다운 → JSX
 *
 * 프롬프트로 "마크다운 쓰지 마"라고 해도 모델은 쓴다. 안 그리면 화면에 `**약점**`이 그대로 뜬다.
 * 라이브러리를 넣지 않는 건 의도다 — 입력이 사용자 글이 아니라 우리 프롬프트가 부른 출력이라
 * 문법 범위가 좁고(제목·목록·구분선·인라인 강조), dangerouslySetInnerHTML 없이 JSX만 만든다.
 *
 * (원래 ConsultingReportModal 안에 있던 코드다. 학습플랜 모달이 같은 걸 필요로 하면서
 *  복사 대신 옮겼다 — 복사하면 한쪽만 고쳐지는 날이 반드시 온다.)
 */
import React from 'react';

/** 인라인 마크다운 처리: 굵게(**..**), 기울임(*..* / _.._), 인라인 코드(`..`). */
export function renderInline(text: string, keyPrefix: string): React.ReactNode[] {
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
export function renderMarkdown(md: string): React.ReactNode {
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
