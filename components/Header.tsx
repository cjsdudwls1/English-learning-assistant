
import React from 'react';
import { ThemeToggle } from './ThemeToggle';
import { LanguageToggle } from './LanguageToggle';
import { useLanguage } from '../contexts/LanguageContext';
import { getTranslation } from '../utils/translations';

export const Header: React.FC = () => {
  const { language } = useLanguage();
  const t = getTranslation(language);
  
  return (
    <header className="bg-white dark:bg-slate-800 shadow-sm">
      <div className="container mx-auto px-4 md:px-8 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-indigo-600 dark:text-indigo-400 whitespace-nowrap">{t.app.title}</h1>
          <p className="text-slate-600 dark:text-slate-300 mt-1">{t.app.description}</p>
        </div>
        <div className="flex items-center gap-3">
          <LanguageToggle />
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
};
