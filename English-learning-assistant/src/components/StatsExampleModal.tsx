import React from 'react';
import { getTranslation } from '../utils/translations';

interface StatsExampleModalProps {
  language: 'ko' | 'en';
  exampleSentences: string[];
  isOpen: boolean;
  onClose: () => void;
}

export const StatsExampleModal: React.FC<StatsExampleModalProps> = ({
  language,
  exampleSentences,
  isOpen,
  onClose,
}) => {
  const t = getTranslation(language);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-2 sm:p-4">
      <div className="bg-white dark:bg-slate-800 rounded-lg shadow-xl max-w-2xl w-full max-h-[85vh] sm:max-h-[80vh] overflow-y-auto">
        <div className="p-4 sm:p-6">
          <div className="flex items-center justify-between gap-2 mb-3 sm:mb-4">
            <h3 className="text-base sm:text-xl font-bold text-slate-800 dark:text-slate-200 min-w-0 break-words">
              {t.example.generate}
            </h3>
            {/* 닫기 버튼은 글자만 있고 배경이 없다. min-h-[44px]를 걸면 헤더 행이 24px에서 44px로
                20px 두꺼워지는데(제목 h3보다 버튼이 커진다), 여기서는 그럴 이유가 없다.
                py-3 + -my-3: 탭 상자는 44px가 되고 음수 마진이 그만큼 되돌려 행 높이는 그대로다.
                배경이 없어 패딩이 눈에 보이지도 않는다. ::before를 안 쓰는 이유는
                e2e 과소탭 검사가 getBoundingClientRect로 재기 때문 — 의사요소는 안 잡힌다.
                sm: 리셋이 필요 없다. 음수 마진 덕에 어느 폭에서도 레이아웃 기여가 0이다. */}
            <button
              onClick={onClose}
              className="shrink-0 px-2 py-3 -my-3 text-sm sm:text-base text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
            >
              {t.common.close}
            </button>
          </div>
          <div className="space-y-3 sm:space-y-4">
            {exampleSentences.length > 0 ? (
              exampleSentences.map((example, idx) => (
                <div key={idx} className="p-3 sm:p-4 bg-slate-50 dark:bg-slate-900/50 rounded-lg">
                  <p className="text-sm sm:text-base text-slate-700 dark:text-slate-300 whitespace-pre-wrap break-words">{example}</p>
                </div>
              ))
            ) : (
              <p className="text-slate-500 dark:text-slate-400">
                {language === 'ko' ? '생성된 예시 문장이 없습니다.' : 'No example sentences generated.'}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

