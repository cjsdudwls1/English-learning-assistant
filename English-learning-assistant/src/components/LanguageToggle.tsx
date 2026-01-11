import React from 'react';
import { useLanguage } from '../contexts/LanguageContext';

export const LanguageToggle: React.FC = () => {
  const { language, toggleLanguage } = useLanguage();

  return (
    <button
      onClick={toggleLanguage}
      className="px-4 py-2 rounded-lg bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors font-medium"
      aria-label="Toggle language"
    >
      {language === 'ko' ? '한국어' : 'English'}
    </button>
  );
};

