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
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-slate-800 rounded-lg shadow-xl max-w-2xl w-full max-h-[80vh] overflow-y-auto">
        <div className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-xl font-bold text-slate-800 dark:text-slate-200">
              {t.example.generate}
            </h3>
            <button
              onClick={onClose}
              className="text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
            >
              {t.common.close}
            </button>
          </div>
          <div className="space-y-4">
            {exampleSentences.length > 0 ? (
              exampleSentences.map((example, idx) => (
                <div key={idx} className="p-4 bg-slate-50 dark:bg-slate-900/50 rounded-lg">
                  <p className="text-slate-700 dark:text-slate-300 whitespace-pre-wrap">{example}</p>
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

